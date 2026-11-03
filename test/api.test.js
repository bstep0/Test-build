'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { open } = require('../lib/db');
const { createApp } = require('../server');
const Dosing = require('../public/dosing');
const Geo = require('../public/geo');

let server, base, cookie = '';
const call = async (method, path, body, as = cookie) => {
  const r = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json', ...(as ? { Cookie: as } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const set = r.headers.get('set-cookie');
  if (set && as === cookie && /sd_session=[^;]+/.test(set) && path.startsWith('/api/auth/')) cookie = set.split(';')[0];
  return { status: r.status, body: await r.json().catch(() => ({})), headers: r.headers };
};
const cookieOf = (r) => r.headers.get('set-cookie').split(';')[0];
const nextWeekday = (wd) => { const d = new Date(); while (d.getUTCDay() !== wd) d.setUTCDate(d.getUTCDate() + 1); return d.toISOString().slice(0, 10); };

test.before(async () => {
  server = createApp(open(':memory:'), { geocode: async (q) => (q.includes('Nowhere') ? null : { lat: 37.4, lng: -122.1, display: q }) });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
  const me = (await call('GET', '/api/auth/me')).body;
  assert.equal(me.needsSetup, true);
  assert.equal((await call('POST', '/api/auth/setup', { name: 'Olivia Owner', email: 'owner@test.dev', password: 'correct horse', company: 'Test Pools' })).status, 200);
});
test.after(() => server.close());

test('full workflow: customer → pool → route → visit → invoice → paid', async () => {
  const tech = (await call('POST', '/api/techs', { name: 'Sam' })).body;
  const cust = (await call('POST', '/api/customers', { name: 'Acme Pools Co', rate: 100 })).body;
  const pool = (await call('POST', '/api/pools', { customer_id: cust.id, volume_gal: 20000 })).body;
  const stop = (await call('POST', '/api/stops', { pool_id: pool.id, tech_id: tech.id, weekday: 3, start_date: '2020-01-01' })).body;
  assert.equal(stop.frequency, 1);

  const date = nextWeekday(3);
  const day = (await call('GET', `/api/day/${date}`)).body;
  assert.equal(day.length, 1);
  assert.equal(day[0].price, 100);
  assert.equal(day[0].customer_name, 'Acme Pools Co');
  assert.equal((await call('GET', `/api/day/${date}`)).body.length, 1, 'idempotent');
  assert.equal((await call('GET', `/api/day/${nextWeekday(4)}`)).body.length, 0);

  const done = (await call('PUT', `/api/visits/${day[0].id}`, {
    status: 'done', ph: 8.0, fc: 1, tasks: ['Skim surface'], chemicals: [{ name: 'Chlorine', qty: 1, unit: 'gal', charge: 12.5 }],
  })).body;
  assert.equal(done.status, 'done');
  assert.ok(done.completed_at);
  assert.deepEqual(done.tasks, ['Skim surface']);

  const inv = (await call('POST', '/api/invoices/generate', { customer_id: cust.id })).body;
  assert.equal(inv.total, 112.5);
  assert.equal(inv.items.length, 2);
  assert.equal((await call('POST', '/api/invoices/generate', { customer_id: cust.id })).status, 400, 'nothing left to bill');
  assert.equal((await call('PUT', `/api/visits/${day[0].id}`, { price: 1 })).status, 400, 'invoiced visit is locked');

  const paid = (await call('POST', `/api/invoices/${inv.id}/pay`, { method: 'Check' })).body;
  assert.equal(paid.status, 'paid');

  const dash = (await call('GET', `/api/dashboard?date=${date}`)).body;
  assert.equal(dash.today.total, 1);
  assert.equal(dash.attention.length, 1, 'high pH / low chlorine flagged');

  assert.equal((await call('DELETE', `/api/invoices/${inv.id}`)).status, 200);
  assert.equal((await call('GET', `/api/customers/${cust.id}`)).body.unbilled, 112.5, 'void releases items');
});

test('changing a stop regenerates future visits', async () => {
  const cust = (await call('POST', '/api/customers', { name: 'Move Me', rate: 50 })).body;
  const pool = (await call('POST', '/api/pools', { customer_id: cust.id })).body;
  const stop = (await call('POST', '/api/stops', { pool_id: pool.id, weekday: 1, start_date: '2020-01-01' })).body;
  const mon = nextWeekday(1);
  assert.ok((await call('GET', `/api/day/${mon}`)).body.some((v) => v.pool_id === pool.id));
  await call('PUT', `/api/stops/${stop.id}`, { weekday: 2 });
  assert.ok(!(await call('GET', `/api/day/${mon}`)).body.some((v) => v.pool_id === pool.id));
  assert.ok((await call('GET', `/api/day/${nextWeekday(2)}`)).body.some((v) => v.pool_id === pool.id));
});

test('every-other-week stops skip alternate weeks', async () => {
  const cust = (await call('POST', '/api/customers', { name: 'Biweekly' })).body;
  const pool = (await call('POST', '/api/pools', { customer_id: cust.id })).body;
  await call('POST', '/api/stops', { pool_id: pool.id, weekday: 5, frequency: 2, start_date: '2024-01-05' }); // a Friday
  const has = async (d) => (await call('GET', `/api/day/${d}`)).body.some((v) => v.pool_id === pool.id);
  assert.equal(await has('2024-01-05'), true);
  assert.equal(await has('2024-01-12'), false);
  assert.equal(await has('2024-01-19'), true);
});

test('validation and errors', async () => {
  assert.equal((await call('POST', '/api/customers', {})).status, 400);
  assert.equal((await call('POST', '/api/pools', { customer_id: 9999 })).status, 400);
  assert.equal((await call('GET', '/api/day/not-a-date')).status, 400);
  assert.equal((await call('GET', '/api/customers/9999')).status, 404);
  assert.equal((await call('GET', '/api/nope')).status, 404);
  assert.equal((await call('PATCH', '/api/customers')).status, 405);
  const r = await fetch(base + '/api/customers', { method: 'POST', body: '{bad' });
  assert.equal(r.status, 400);
  assert.equal((await fetch(base + '/..%2fserver.js')).status, 404, 'no path traversal');
  assert.equal((await fetch(base + '/')).status, 200);
});

test('dosing analysis', () => {
  const r = Object.fromEntries(Dosing.analyze(10000, { fc: 1, ph: 8.1, ta: 90, cya: 100, ch: 300 }).map((x) => [x.key, x]));
  assert.equal(r.fc.status, 'low');
  assert.equal(r.fc.dose.text, '26 fl oz');       // 2 ppm × 13 oz
  assert.equal(r.ph.status, 'high');
  assert.equal(r.ph.dose.product, 'Muriatic acid 31%');
  assert.equal(r.ta.status, 'ok');
  assert.equal(r.cya.status, 'high');
  assert.match(r.cya.dose.text, /drain/i);
  assert.equal(Dosing.analyze(20000, { ph: 7.1 })[0].dose.text, '1.5 lb'); // 0.4 pH ÷ 0.2 × 6 oz × 2 = 24 oz
  assert.deepEqual(Dosing.analyze(10000, { fc: '', ph: null }), []);
});

test('optimizer untangles a zig-zag route', () => {
  const depot = { lat: 37.0, lng: -122.0 };
  const line = [1, 2, 3, 4, 5, 6].map((k) => ({ id: k, lat: 37.0 + k * 0.02, lng: -122.0 }));
  const scrambled = [line[3], line[0], line[5], line[1], line[4], line[2], { id: 99 /* no coordinates */ }];
  const r = Geo.optimizeItems(depot, scrambled);
  assert.deepEqual(r.ordered.map((x) => x.id), [1, 2, 3, 4, 5, 6, 99]);
  assert.ok(r.after < r.before * 0.6, `expected a big saving, got ${r.before} → ${r.after}`);
  assert.equal(r.missing, 1);
  const s = Geo.stats(depot, line, { speed: 30, serviceMin: 20 });
  assert.equal(s.workMin, 120);
  assert.ok(s.driveMin > 0 && s.totalMin === s.driveMin + 120);
});

test('route builder: settings, board and optimise endpoint', async () => {
  assert.equal((await call('PUT', '/api/settings', { depot_lat: 37.0, depot_lng: -122.0, speed_mph: 0 })).status, 400);
  const st = (await call('PUT', '/api/settings', { depot_lat: 37.0, depot_lng: -122.0, speed_mph: 30 })).body;
  assert.equal(st.speed_mph, 30);

  const tech = (await call('POST', '/api/techs', { name: 'Route Tech' })).body;
  const ids = [];
  for (const k of [4, 1, 6, 2, 5, 3]) {   // created out of geographic order on purpose
    const c = (await call('POST', '/api/customers', { name: 'Opt ' + k, lat: 37.0 + k * 0.02, lng: -122.0 })).body;
    const p = (await call('POST', '/api/pools', { customer_id: c.id })).body;
    ids.push((await call('POST', '/api/stops', { pool_id: p.id, tech_id: tech.id, weekday: 6, position: ids.length * 10 + 10, start_date: '2020-01-01' })).body.id);
  }
  const board = (await call('GET', `/api/board?tech_id=${tech.id}`)).body;
  assert.equal(board.stops.length, 6);
  assert.ok(Array.isArray(board.unassigned));

  const prev = (await call('POST', '/api/routes/optimize', { weekday: 6, tech_id: tech.id })).body;
  assert.equal(prev.applied, false);
  assert.ok(prev.after_miles < prev.before_miles);
  const unchanged = (await call('GET', `/api/board?tech_id=${tech.id}`)).body.stops.map((s) => s.customer_name);
  assert.equal(unchanged[0], 'Opt 4', 'preview must not save');

  await call('POST', '/api/routes/optimize', { weekday: 6, tech_id: tech.id, apply: true });
  const after = (await call('GET', `/api/board?tech_id=${tech.id}`)).body.stops.map((s) => s.customer_name);
  assert.deepEqual(after, ['Opt 1', 'Opt 2', 'Opt 3', 'Opt 4', 'Opt 5', 'Opt 6']);

  const sat = nextWeekday(6);
  const day = (await call('POST', '/api/routes/optimize', { date: sat, tech_id: tech.id, apply: true })).body;
  assert.equal(day.groups[0].count, 6);
  const visits = (await call('GET', `/api/day/${sat}?tech_id=${tech.id}`)).body.map((v) => v.customer_name);
  assert.deepEqual(visits, ['Opt 1', 'Opt 2', 'Opt 3', 'Opt 4', 'Opt 5', 'Opt 6']);
  assert.equal((await call('POST', '/api/routes/optimize', {})).status, 400);
});

test('geocoding endpoints use the injected geocoder', async () => {
  assert.equal((await call('POST', '/api/geocode', { query: '1 Main St' })).body.lat, 37.4);
  assert.equal((await call('POST', '/api/geocode', { query: 'Nowhere' })).status, 404);
  await call('POST', '/api/customers', { name: 'Needs Pin', address: '5 Elm St', city: 'Town' });
  const r = (await call('POST', '/api/geocode-missing')).body;
  assert.ok(r.updated >= 1);
});

test('auth: sign-in required, setup only once, throttling', async () => {
  assert.equal((await call('GET', '/api/customers', null, '')).status, 401);
  assert.equal((await call('POST', '/api/auth/setup', { name: 'X', email: 'x@y.zz', password: 'longenough' }, '')).status, 403);
  assert.equal((await call('POST', '/api/auth/login', { email: 'owner@test.dev', password: 'nope' }, '')).status, 401);
  const ok = await call('POST', '/api/auth/login', { email: 'OWNER@test.dev', password: 'correct horse' }, '');
  assert.equal(ok.status, 200);
  assert.match(ok.headers.get('set-cookie'), /HttpOnly; SameSite=Lax/);
  assert.equal((await call('GET', '/api/customers', null, cookieOf(ok))).status, 200);
  for (let i = 0; i < 8; i++) await call('POST', '/api/auth/login', { email: 'spray@test.dev', password: 'x' }, '');
  assert.equal((await call('POST', '/api/auth/login', { email: 'spray@test.dev', password: 'x' }, '')).status, 429);
  const out = await call('POST', '/api/auth/logout', {}, cookieOf(ok));
  assert.equal((await call('GET', '/api/customers', null, cookieOf(ok))).status, 401, 'session revoked');
});

test('cross-origin writes are refused', async () => {
  const r = await fetch(base + '/api/customers', { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie, Origin: 'https://evil.example' }, body: '{"name":"x"}' });
  assert.equal(r.status, 403);
});

test('roles: technicians only see and edit their own stops', async () => {
  const techA = (await call('POST', '/api/users', { name: 'Tina Tech', email: 'tina@test.dev', password: 'password1', role: 'tech' })).body;
  const techB = (await call('POST', '/api/users', { name: 'Bob Tech', email: 'bob@test.dev', password: 'password1', role: 'tech' })).body;
  assert.ok(techA.tech_id && techB.tech_id && techA.tech_id !== techB.tech_id, 'tech rows auto-created');
  const cust = (await call('POST', '/api/customers', { name: 'Role Test', rate: 90 })).body;
  const pool = (await call('POST', '/api/pools', { customer_id: cust.id })).body;
  await call('POST', '/api/stops', { pool_id: pool.id, tech_id: techA.tech_id, weekday: 2, start_date: '2020-01-01' });
  const date = nextWeekday(2);
  const tina = cookieOf(await call('POST', '/api/auth/login', { email: 'tina@test.dev', password: 'password1' }, ''));
  const bob = cookieOf(await call('POST', '/api/auth/login', { email: 'bob@test.dev', password: 'password1' }, ''));
  const mine = (await call('GET', `/api/day/${date}`, null, tina)).body;
  assert.equal(mine.length, 1);
  assert.equal((await call('GET', `/api/day/${date}?tech_id=${techB.tech_id}`, null, tina)).body.length, 1, 'tech_id query cannot widen scope');
  assert.equal((await call('GET', `/api/day/${date}`, null, bob)).body.length, 0);
  assert.equal((await call('GET', `/api/visits/${mine[0].id}`, null, bob)).status, 403);
  const put = await call('PUT', `/api/visits/${mine[0].id}`, { status: 'done', ph: 7.4, price: 1, tech_id: techB.tech_id }, tina);
  assert.equal(put.status, 200);
  assert.equal(put.body.price, 90, 'technicians cannot change price');
  assert.equal(put.body.tech_id, techA.tech_id);
  for (const [m, p] of [['GET', '/api/customers'], ['GET', '/api/invoices'], ['GET', '/api/users'], ['PUT', '/api/settings'], ['POST', '/api/routes/optimize']])
    assert.equal((await call(m, p, m === 'GET' ? null : {}, tina)).status, 403, `${m} ${p}`);
  assert.equal((await call('POST', '/api/dose', { volume: 10000, readings: { ph: 8 } }, tina)).status, 200);
  // office: no user management or settings writes, but can run the business
  await call('POST', '/api/users', { name: 'Ola Office', email: 'ola@test.dev', password: 'password1', role: 'office' });
  const ola = cookieOf(await call('POST', '/api/auth/login', { email: 'ola@test.dev', password: 'password1' }, ''));
  assert.equal((await call('GET', '/api/invoices', null, ola)).status, 200);
  assert.equal((await call('GET', '/api/users', null, ola)).status, 403);
  assert.equal((await call('PUT', '/api/settings', { speed_mph: 20 }, ola)).status, 403);
});

test('users: last owner is protected; deactivation signs people out', async () => {
  const users = (await call('GET', '/api/users')).body;
  const owner = users.find((u) => u.role === 'owner');
  assert.equal((await call('PUT', `/api/users/${owner.id}`, { role: 'office' })).status, 400);
  assert.equal((await call('DELETE', `/api/users/${owner.id}`)).status, 400);
  const bob = users.find((u) => u.email === 'bob@test.dev');
  const bobCookie = cookieOf(await call('POST', '/api/auth/login', { email: 'bob@test.dev', password: 'password1' }, ''));
  await call('PUT', `/api/users/${bob.id}`, { active: false });
  assert.equal((await call('GET', '/api/day/2030-01-01', null, bobCookie)).status, 401);
  assert.equal((await call('POST', '/api/auth/login', { email: 'bob@test.dev', password: 'password1' }, '')).status, 401);
  assert.equal((await call('POST', '/api/auth/password', { current: 'wrong', password: 'newpassword1' })).status, 403);
});

test('customers are archived, not destroyed; audit trail records changes', async () => {
  const c = (await call('POST', '/api/customers', { name: 'Archive Me', rate: 80 })).body;
  const p = (await call('POST', '/api/pools', { customer_id: c.id })).body;
  await call('POST', '/api/stops', { pool_id: p.id, weekday: 3, start_date: '2020-01-01' });
  assert.equal((await call('DELETE', `/api/customers/${c.id}`)).body.archived, true);
  assert.ok(!(await call('GET', '/api/customers')).body.some((x) => x.id === c.id));
  assert.ok((await call('GET', '/api/customers?archived=1')).body.some((x) => x.id === c.id));
  assert.ok(!(await call('GET', `/api/day/${nextWeekday(3)}`)).body.some((v) => v.pool_id === p.id), 'archived customers leave the route');
  assert.equal((await call('GET', `/api/customers/${c.id}`)).status, 200, 'history is still readable');
  await call('POST', `/api/customers/${c.id}/restore`);
  assert.ok((await call('GET', '/api/customers')).body.some((x) => x.id === c.id));
  const audit = (await call('GET', '/api/audit?limit=50')).body;
  assert.ok(audit.some((a) => a.method === 'DELETE' && a.path === `/api/customers/${c.id}` && a.user_name === 'Olivia Owner'));
  assert.ok(!audit.some((a) => /password/i.test(a.summary)), 'secrets never logged');
});

test('health check and security headers', async () => {
  assert.equal((await fetch(base + '/healthz')).status, 200);
  const r = await fetch(base + '/');
  assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
  assert.match(r.headers.get('content-security-policy'), /frame-ancestors 'none'/);
});
