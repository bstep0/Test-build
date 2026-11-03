'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { open } = require('../lib/db');
const { createApp } = require('../server');
const Dosing = require('../public/dosing');
const Geo = require('../public/geo');

const crypto = require('node:crypto');
const stripeCalls = [];
const stripeFetch = async (url, init = {}) => {                  // stand-in for api.stripe.com
  const body = Object.fromEntries(new URLSearchParams(init.body || ''));
  stripeCalls.push({ url, method: init.method, body, auth: init.headers?.Authorization });
  const reply = (j, status = 200) => ({ ok: status < 400, status, json: async () => j });
  if (url.endsWith('/checkout/sessions')) return reply({ id: 'cs_test_1', url: 'https://checkout.stripe.test/pay/cs_test_1' });
  if (url.includes('/payment_intents/pi_saved')) return reply({ id: 'pi_saved', payment_method: 'pm_saved' });
  if (url.endsWith('/payment_intents')) return reply({ id: 'pi_auto', status: 'succeeded' });
  return reply({ error: { message: 'unexpected ' + url } }, 400);
};
const sign = (payload, secret = 'whsec_test', t = Math.floor(Date.now() / 1000)) => `t=${t},v1=${crypto.createHmac('sha256', secret).update(`${t}.${payload}`).digest('hex')}`;
const mailCalls = []; let mailFail = false;
const mailFetch = async (url, init = {}) => { mailCalls.push({ url, init }); return { ok: !mailFail, status: mailFail ? 500 : 200, json: async () => ({}) }; };
let osrmMode = 'roads';
const osrmFetch = async (url) => {
  if (osrmMode === 'down') return { ok: false, status: 503, json: async () => ({}) };
  const nodes = decodeURIComponent(url.split('/driving/')[1].split('?')[0]).split(';').map((s) => { const [lng, lat] = s.split(',').map(Number); return { lat, lng }; });
  return { ok: true, status: 200, json: async () => ({ code: 'Ok', distances: nodes.map((a) => nodes.map((b) => Geo.miles(a, b) * 1609.344)) }) };
};
const waitFor = async (fn, ms = 1500) => { const t = Date.now(); for (;;) { const v = await fn(); if (v) return v; if (Date.now() - t > ms) return v; await new Promise((r) => setTimeout(r, 25)); } };
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
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
  server = createApp(open(':memory:'), {
    geocode: async (q) => (q.includes('Nowhere') ? null : { lat: 37.4, lng: -122.1, display: q }),
    stripeKey: 'sk_test_123', stripeWebhookSecret: 'whsec_test', stripeFetch,
    resend_api_key: 're_test', email_from: 'Test <t@x.dev>', twilio_account_sid: 'AC1', twilio_auth_token: 'tok', twilio_from: '+15550001111', mailFetch,
    osrmFetch,
  });
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
  assert.equal(r.fc.dose.text, '91 fl oz');       // CYA 100 → target capped at 8 ppm: 7 ppm × 13 oz
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

const mkCustomer = async (extra = {}, withStop = false) => {
  const c = (await call('POST', '/api/customers', { name: 'Billing ' + Math.random().toString(36).slice(2, 6), rate: 100, email: 'bill@test.dev', ...extra })).body;
  const p = (await call('POST', '/api/pools', { customer_id: c.id })).body;
  if (withStop) await call('POST', '/api/stops', { pool_id: p.id, weekday: 1, start_date: '2020-01-01' });
  return { c, p };
};
const doneVisit = async (pool, date, extra = {}) => {
  const v = (await call('POST', '/api/visits', { pool_id: pool.id, date })).body;
  return (await call('PUT', `/api/visits/${v.id}`, { status: 'done', ...extra })).body;
};

test('billing: monthly flat fee + sales tax on chemicals and repairs', async () => {
  await call('PUT', '/api/settings', { tax_rate: 8, due_days: 30, tax_services: 0, company_name: 'Test Pools' });
  const { c, p } = await mkCustomer({ billing_mode: 'monthly', monthly_rate: 150 }, true);
  await doneVisit(p, '2026-03-03', { chemicals: [{ name: 'Chlorine', qty: 1, unit: 'gal', charge: 20 }] });
  await doneVisit(p, '2026-03-10');
  const inv = (await call('POST', '/api/invoices/generate', { customer_id: c.id, period: '2026-03', issued: '2026-03-31' })).body;
  assert.equal(inv.subtotal, 170);
  assert.equal(inv.tax, 1.6, '8% of the $20 chemical only — service is not taxed');
  assert.equal(inv.total, 171.6);
  assert.equal(inv.period, '2026-03');
  assert.equal(inv.due, '2026-04-30');
  assert.equal(inv.items.length, 2);
  assert.equal((await call('POST', '/api/invoices/generate', { customer_id: c.id, period: '2026-03' })).status, 400, 'one flat fee per month');
  await call('PUT', '/api/settings', { tax_services: 1 });
  const { c: c2, p: p2 } = await mkCustomer({ taxable: 0 });
  await doneVisit(p2, '2026-03-04');
  assert.equal((await call('POST', '/api/invoices/generate', { customer_id: c2.id })).body.tax, 0, 'tax-exempt customers pay no tax');
  await call('PUT', '/api/settings', { tax_rate: 0, tax_services: 0, due_days: 14 });
});

test('stripe: pay link, checkout, signed webhook, replay safety, saved-card autopay', async () => {
  const { c, p } = await mkCustomer({ name: 'Card Payer' });
  await doneVisit(p, '2026-04-01');
  const inv = (await call('POST', '/api/invoices/generate', { customer_id: c.id })).body;
  assert.match(inv.pay_url, /\/pay\/[0-9a-f]{32}$/);
  const token = inv.pay_url.split('/').pop();
  const pub = (await call('GET', `/api/public/pay/${token}`, null, '')).body;
  assert.equal(pub.invoice.total, 100); assert.equal(pub.payable, true);
  assert.equal((await call('GET', '/api/public/pay/deadbeef', null, '')).status, 404);
  const co = (await call('POST', `/api/public/pay/${token}/checkout`, { save_card: true }, '')).body;
  assert.match(co.url, /^https:\/\/checkout\.stripe\.test/);
  const sent = stripeCalls.find((x) => x.url.endsWith('/checkout/sessions')).body;
  assert.equal(sent['line_items[0][price_data][unit_amount]'], '10000');
  assert.equal(sent['payment_intent_data[setup_future_usage]'], 'off_session');
  assert.equal(stripeCalls.at(-1).auth, 'Bearer sk_test_123');

  const event = JSON.stringify({ type: 'checkout.session.completed', data: { object: { payment_status: 'paid', customer: 'cus_1', payment_intent: 'pi_saved',
    metadata: { invoice_id: String(inv.id), save_card: '1', customer_id: String(c.id) } } } });
  const hook = (payload, sig) => fetch(base + '/api/stripe/webhook', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Stripe-Signature': sig }, body: payload });
  assert.equal((await hook(event, sign(event, 'wrong-secret'))).status, 400, 'forged signature rejected');
  assert.equal((await hook(event, sign(event, 'whsec_test', Math.floor(Date.now() / 1000) - 3600))).status, 400, 'stale timestamp rejected');
  assert.equal((await hook(event, sign(event))).status, 200);
  assert.equal((await hook(event, sign(event))).status, 200, 'replays are harmless');
  const paid = (await call('GET', `/api/invoices/${inv.id}`)).body;
  assert.equal(paid.status, 'paid'); assert.equal(paid.method, 'Card (Stripe)');
  assert.equal((await call('GET', `/api/customers/${c.id}`)).body.autopay, 1, 'card saved for autopay');
  assert.equal((await call('DELETE', `/api/invoices/${inv.id}`)).status, 400, 'card-paid invoices cannot be voided here');

  await doneVisit(p, '2026-04-08');
  const next = (await call('POST', '/api/invoices/generate', { customer_id: c.id })).body;
  assert.equal(next.status, 'paid', 'autopay charged the saved card at invoice time');
  assert.equal(next.method, 'Autopay (Stripe)');
  assert.equal((await call('GET', '/api/stripe/config')).body.enabled, true);
});

test('quotes: send, customer approves via public link, work order created once', async () => {
  const { c, p } = await mkCustomer({ name: 'Quote Fan' });
  assert.equal((await call('POST', '/api/quotes', { customer_id: c.id, title: 'x', items: [] })).status, 400);
  const q = (await call('POST', '/api/quotes', { customer_id: c.id, pool_id: p.id, title: 'New pump', note: 'Includes install',
    items: [{ desc: 'Variable-speed pump', qty: 1, price: 900 }, { desc: 'Labor', qty: 2, price: 75 }] })).body;
  assert.equal(q.total, 1050);
  const token = q.public_url.split('/').pop();
  assert.equal((await call('GET', `/api/public/quote/${token}`, null, '')).status, 404, 'drafts are not public');
  await call('POST', `/api/quotes/${q.id}/send`);
  const pub = (await call('GET', `/api/public/quote/${token}`, null, '')).body;
  assert.equal(pub.quote.total, 1050); assert.equal(pub.quote.status, 'sent');
  assert.equal((await call('POST', `/api/public/quote/${token}/respond`, { action: 'maybe' }, '')).status, 400);
  assert.equal((await call('POST', `/api/public/quote/${token}/respond`, { action: 'approve', name: 'Pat' }, '')).body.status, 'approved');
  assert.equal((await call('POST', `/api/public/quote/${token}/respond`, { action: 'decline' }, '')).body.already, true, 'first answer wins');
  const wos = (await call('GET', '/api/work-orders')).body.filter((w) => w.title.includes('New pump'));
  assert.equal(wos.length, 1); assert.equal(wos[0].price, 1050);
  assert.equal((await call('PUT', `/api/quotes/${q.id}`, { title: 'changed' })).status, 400, 'answered quotes are locked');
});

test('inventory: stock follows visits, re-edits and re-opens; cost is tracked', async () => {
  const prod = (await call('POST', '/api/products', { name: 'Liquid chlorine', unit: 'gal', cost: 3, price: 8, stock: 10, low_stock: 4 })).body;
  const { p } = await mkCustomer({ name: 'Stock Test' });
  const v = (await call('POST', '/api/visits', { pool_id: p.id, date: '2026-05-01' })).body;
  const chem = (qty) => [{ product_id: prod.id, name: prod.name, qty, unit: 'gal', charge: qty * 8 }];
  const stock = async () => (await call('GET', '/api/products')).body.find((x) => x.id === prod.id);
  let r = (await call('PUT', `/api/visits/${v.id}`, { status: 'done', chemicals: chem(3) })).body;
  assert.equal((await stock()).stock, 7);
  assert.equal((await call('GET', `/api/visits/${v.id}`)).body.cost, 9, '3 gal × $3 cost');
  await call('PUT', `/api/visits/${v.id}`, { chemicals: chem(2) });
  assert.equal((await stock()).stock, 8, 'editing quantity adjusts, not double-deducts');
  await call('PUT', `/api/visits/${v.id}`, { status: 'scheduled' });
  assert.equal((await stock()).stock, 10, 're-opening gives the stock back');
  await call('PUT', `/api/visits/${v.id}`, { status: 'done', chemicals: chem(7) });
  const s = await stock(); assert.equal(s.stock, 3); assert.equal(s.low, true, 'low-stock flag');
  assert.equal((await call('POST', `/api/products/${prod.id}/adjust`, { delta: 20 })).body.stock, 23);
  assert.equal((await call('POST', `/api/products/${prod.id}/adjust`, { delta: 0 })).status, 400);
});

test('exports: CSV for accounting, spreadsheet-formula safe', async () => {
  const { c, p } = await mkCustomer({ name: '=HYPERLINK("http://evil","x")' });
  await doneVisit(p, '2026-06-02');
  await call('POST', '/api/invoices/generate', { customer_id: c.id });
  const res = await fetch(base + '/api/export/invoices.csv', { headers: { Cookie: cookie } });
  assert.equal(res.status, 200); assert.match(res.headers.get('content-type'), /text\/csv/);
  const text = await res.text();
  assert.match(text.split('\r\n')[0], /^InvoiceNo,Customer,InvoiceDate/);
  assert.ok(text.includes(`"'=HYPERLINK(""http://evil"",""x"")"`), 'formula neutralised');
  assert.equal((await fetch(base + '/api/export/payments.csv', { headers: { Cookie: cookie } })).status, 200);
  assert.equal((await fetch(base + '/api/export/customers.csv', { headers: { Cookie: '' } })).status, 401);
});

test('dosing: chlorine need scales with stabilizer; LSI flags corrosive and scaling water', () => {
  const fc = (cya, salt) => Dosing.analyze(10000, { fc: 3, cya, salt }).find((x) => x.key === 'fc');
  assert.equal(fc(30).status, 'ok'); assert.equal(fc(40).status, 'ok');
  assert.equal(fc(60).status, 'low', '3 ppm is too little with 60 ppm CYA (min 4.5)');
  assert.equal(fc(60, 3200).status, 'ok', 'salt-cell pools need only 5% of CYA');
  const get = (r) => Dosing.analyze(10000, r, { lsi: true }).find((x) => x.key === 'lsi');
  assert.equal(get({ ph: 7.5, ta: 100, ch: 300, temp: 80 }).status, 'ok');
  const corrosive = get({ ph: 7.0, ta: 60, ch: 150, temp: 70 });
  assert.equal(corrosive.status, 'low'); assert.match(corrosive.message, /Corrosive/);
  assert.equal(get({ ph: 8.0, ta: 140, ch: 450, temp: 90 }).status, 'high');
  assert.equal(get({ ph: 7.5 }), undefined, 'needs pH, alkalinity and calcium');
  assert.equal(Dosing.analyze(10000, { ph: 7.0, ta: 60, ch: 150 }).some((x) => x.key === 'lsi'), false, 'LSI is opt-in');
});

test('notifications: service report, invoice, ETA text, reminders; outbox records everything', async () => {
  await call('PUT', '/api/settings', { company_name: 'Test Pools', company_email: 'office@test.dev' });
  const { c, p } = await mkCustomer({ name: 'Notify Me', email: 'n@x.dev', phone: '+15551234567', notify_sms: 1 }, true);
  const v = (await call('POST', '/api/visits', { pool_id: p.id, date: '2026-07-01' })).body;
  mailCalls.length = 0;
  await call('PUT', `/api/visits/${v.id}`, { status: 'done', ph: 7.4, fc: 3, tasks: ['Skim surface'], notes: 'All good' });
  const report = await waitFor(async () => (await call('GET', '/api/outbox')).body.find((o) => o.kind === 'service_report' && o.to_addr === 'n@x.dev' && o.status === 'sent'));
  assert.ok(report, 'service report emailed'); assert.match(report.body, /Water test:/); assert.match(report.body, /\/portal\/[0-9a-f]{32}/);
  const mail = mailCalls.find((m) => m.url.includes('resend.com'));
  assert.equal(mail.init.headers.Authorization, 'Bearer re_test'); assert.equal(JSON.parse(mail.init.body).to[0], 'n@x.dev');
  assert.equal(mailCalls.filter((m) => m.url.includes('twilio')).length, 0, 'reports go by email only');

  const inv = (await call('POST', '/api/invoices/generate', { customer_id: c.id, issued: '2020-01-01' })).body;
  assert.ok(await waitFor(async () => (await call('GET', '/api/outbox')).body.find((o) => o.kind === 'invoice' && o.status === 'sent')), 'invoice emailed on creation');
  assert.equal((await call('POST', `/api/invoices/${inv.id}/email`)).status, 200);

  const eta = await call('POST', `/api/visits/${v.id}/eta`);
  assert.equal(eta.body.sent, 1);
  const sms = await waitFor(() => mailCalls.find((m) => m.url.includes('twilio.com')));
  assert.ok(sms, 'ETA goes out as an SMS'); assert.match(sms.init.headers.Authorization, /^Basic /); assert.match(sms.init.body, /heading\+to\+your\+pool/);

  const r1 = (await call('POST', '/api/reminders/run')).body;
  assert.ok(r1.sent >= 1, 'overdue invoice reminded');
  assert.equal((await call('POST', '/api/reminders/run')).body.sent, 0, 'at most one reminder a week');

  const { c: quiet } = await mkCustomer({ name: 'No Email', email: 'q@x.dev', notify_email: 0 });
  const before = (await call('GET', '/api/outbox')).body.length;
  await call('POST', `/api/invoices/generate`, { customer_id: quiet.id }).catch(() => {});
  assert.equal((await call('GET', '/api/outbox')).body.filter((o) => o.to_addr === 'q@x.dev').length, 0, 'respects notification preferences');

  mailFail = true;
  const rows = (await call('POST', '/api/quotes', { customer_id: c.id, pool_id: p.id, title: 'Fail test', items: [{ desc: 'x', price: 1 }] })).body;
  await call('POST', `/api/quotes/${rows.id}/send`);
  const failed = await waitFor(async () => (await call('GET', '/api/outbox')).body.find((o) => o.kind === 'quote' && o.status === 'failed'));
  assert.ok(failed, 'provider errors are recorded, not swallowed');
  mailFail = false;
  assert.equal((await call('POST', `/api/outbox/${failed.id}/retry`)).body.status, 'sent');
});

test('portal: private link shows status; service requests become work orders', async () => {
  const { c, p } = await mkCustomer({ name: 'Portal Pat' }, true);
  await doneVisit(p, '2026-07-02', { ph: 7.5, fc: 3, ta: 90, cya: 40, ch: 300 });
  const { url } = (await call('POST', `/api/customers/${c.id}/portal-link`)).body;
  const token = url.split('/').pop();
  const d = (await call('GET', `/api/public/portal/${token}`, null, '')).body;
  assert.equal(d.customer.name, 'Portal Pat'); assert.equal(d.pools.length, 1); assert.ok(d.pools[0].last.findings.length >= 4); assert.ok(d.pools[0].next.length >= 1, 'upcoming visits');
  assert.equal(d.company.name, 'Test Pools');
  assert.equal(JSON.stringify(d).includes('portal_token'), false);
  assert.equal((await call('GET', '/api/public/portal/' + 'a'.repeat(32), null, '')).status, 404);
  assert.equal((await call('GET', '/api/public/portal/nope', null, '')).status, 404);
  assert.equal((await call('POST', `/api/public/portal/${token}/request`, { message: 'hi' }, '')).status, 400);
  assert.equal((await call('POST', `/api/public/portal/${token}/request`, { message: 'Pump is making a loud noise' }, '')).status, 200);
  assert.ok((await call('GET', '/api/work-orders')).body.some((w) => w.customer_id === c.id && w.title === 'Customer request' && /loud noise/.test(w.description)));
  await call('DELETE', `/api/customers/${c.id}`);
  assert.equal((await call('GET', `/api/public/portal/${token}`, null, '')).status, 404, 'archived customers lose portal access');
});

test('photos: validated uploads, tech scoping, portal access', async () => {
  const tina = (await call('GET', '/api/users')).body.find((u) => u.email === 'tina@test.dev');
  const { c, p } = await mkCustomer({ name: 'Photo Fan' });
  await call('POST', '/api/stops', { pool_id: p.id, tech_id: tina.tech_id, weekday: 2, start_date: '2020-01-01' });
  const v = (await call('GET', `/api/day/${nextWeekday(2)}`)).body.find((x) => x.pool_id === p.id);
  assert.equal((await call('POST', `/api/visits/${v.id}/photos`, { data: 'hello' })).status, 400);
  assert.equal((await call('POST', `/api/visits/${v.id}/photos`, { data: 'data:image/png;base64,' + Buffer.from('<script>alert(1)</script>').toString('base64') })).status, 400, 'magic bytes checked');
  const up = (await call('POST', `/api/visits/${v.id}/photos`, { data: PNG, caption: 'Filter before' })).body;
  assert.ok(up.id);
  const img = await fetch(base + up.url, { headers: { Cookie: cookie } });
  assert.equal(img.status, 200); assert.equal(img.headers.get('content-type'), 'image/png'); assert.ok((await img.arrayBuffer()).byteLength > 50);
  assert.equal((await call('GET', `/api/visits/${v.id}/photos`)).body[0].caption, 'Filter before');
  assert.equal((await fetch(base + up.url, { headers: { Cookie: '' } })).status, 401);
  // another technician cannot see it
  await call('PUT', `/api/users/${(await call('GET', '/api/users')).body.find((u) => u.email === 'bob@test.dev').id}`, { active: true });
  const bob = cookieOf(await call('POST', '/api/auth/login', { email: 'bob@test.dev', password: 'password1' }, ''));
  assert.equal((await fetch(base + up.url, { headers: { Cookie: bob } })).status, 403);
  assert.equal((await call('POST', `/api/visits/${v.id}/photos`, { data: PNG }, bob)).status, 403);
  // the assigned technician can upload and delete their own
  const tinaCookie = cookieOf(await call('POST', '/api/auth/login', { email: 'tina@test.dev', password: 'password1' }, ''));
  const mine = (await call('POST', `/api/visits/${v.id}/photos`, { data: PNG }, tinaCookie)).body;
  assert.equal((await call('DELETE', `/api/photos/${up.id}`, null, tinaCookie)).status, 403, 'not their upload');
  assert.equal((await call('DELETE', `/api/photos/${mine.id}`, null, tinaCookie)).status, 200);
  // shown on the customer portal after the visit is done
  await call('PUT', `/api/visits/${v.id}`, { status: 'done' });
  const token = (await call('POST', `/api/customers/${c.id}/portal-link`)).body.url.split('/').pop();
  const portal = (await call('GET', `/api/public/portal/${token}`, null, '')).body;
  assert.equal(portal.pools[0].photos.length, 1);
  assert.equal((await fetch(base + portal.pools[0].photos[0].url)).status, 200);
  const other = (await call('POST', `/api/customers/${(await mkCustomer({ name: 'Someone Else' })).c.id}/portal-link`)).body.url.split('/').pop();
  assert.equal((await fetch(`${base}/api/public/portal/${other}/photo/${up.id}`)).status, 404, 'a portal can only see its own photos');
});

test('scheduling: holidays, seasonal end dates, reassigning a day, rescheduling a visit', async () => {
  const mon = nextWeekday(1);
  const { p } = await mkCustomer({ name: 'Sched Test' });
  const techA = (await call('POST', '/api/techs', { name: 'Out Sick' })).body, techB = (await call('POST', '/api/techs', { name: 'Covering' })).body;
  const stop = (await call('POST', '/api/stops', { pool_id: p.id, tech_id: techA.id, weekday: 1, start_date: '2020-01-01' })).body;
  const has = async (d) => (await call('GET', `/api/day/${d}`)).body.filter((x) => x.pool_id === p.id);
  assert.equal((await has(mon)).length, 1);
  assert.equal((await call('PUT', '/api/settings', { skip_dates: 'not-a-date' })).status, 400);
  const other = new Date(mon + 'T00:00:00Z'); other.setUTCDate(other.getUTCDate() + 7);
  const holiday = other.toISOString().slice(0, 10);
  await call('PUT', '/api/settings', { skip_dates: [holiday] });
  assert.equal((await has(holiday)).length, 0, 'no visits on a holiday');
  await call('PUT', '/api/settings', { skip_dates: [] });
  assert.equal((await has(holiday)).length, 1);
  await call('PUT', `/api/stops/${stop.id}`, { end_date: mon });
  const later = new Date(mon + 'T00:00:00Z'); later.setUTCDate(later.getUTCDate() + 14);
  assert.equal((await has(later.toISOString().slice(0, 10))).length, 0, 'seasonal stop has ended');
  assert.equal((await has(mon)).length, 1, 'but still runs through its end date');

  const moved = (await call('POST', '/api/schedule/reassign', { date: mon, from_tech_id: techA.id, to_tech_id: techB.id })).body;
  assert.equal(moved.moved, 1);
  assert.equal((await has(mon))[0].tech_id, techB.id);
  assert.equal((await call('POST', '/api/schedule/reassign', { date: 'bad', from_tech_id: 1, to_tech_id: 2 })).status, 400);

  const v = (await has(mon))[0];
  const target = new Date(mon + 'T00:00:00Z'); target.setUTCDate(target.getUTCDate() + 2);
  const newDate = target.toISOString().slice(0, 10);
  const r = (await call('POST', `/api/visits/${v.id}/reschedule`, { date: newDate })).body;
  assert.equal(r.date, newDate);
  const after = await has(mon);
  assert.equal(after.length, 1, 'the recurring stop does not regenerate the moved visit'); assert.equal(after[0].status, 'skipped');
  assert.equal((await has(newDate)).length, 1);
  assert.equal((await call('POST', `/api/visits/${v.id}/reschedule`, { date: newDate })).status, 400, 'already moved');
});

test('reports: revenue, aging, technicians, route profitability, chemicals', async () => {
  const r = (await call('GET', '/api/reports/summary?days=365')).body;
  assert.equal(r.days, 365);
  for (const k of ['billed', 'collected', 'outstanding', 'visits', 'chemical_cost']) assert.equal(typeof r.totals[k], 'number', k);
  assert.ok(r.totals.visits > 5); assert.ok(r.revenue.length >= 1);
  assert.deepEqual(Object.keys(r.aging), ['current', 'd30', 'd60', 'd90']);
  assert.ok(r.aging.d90 > 0, 'invoices from 2020 are 90+ days overdue');
  assert.ok(r.technicians.every((t) => t.visits > 0 && 'flagged_pct' in t));
  assert.ok(r.chemicals.some((c) => /chlorine/i.test(c.name) && c.charge > 0));
  assert.ok(r.routes.length >= 1 && r.routes.every((x) => x.stops > 0 && typeof x.per_hour === 'number'));
  assert.equal((await call('GET', '/api/reports/summary?days=7')).body.days, 90, 'unknown ranges fall back');
  const tina = cookieOf(await call('POST', '/api/auth/login', { email: 'tina@test.dev', password: 'password1' }, ''));
  assert.equal((await call('GET', '/api/reports/summary', null, tina)).status, 403, 'technicians cannot see business reports');
});

test('optimizer uses real road distances when a routing server is configured, falls back otherwise', async () => {
  await call('PUT', '/api/settings', { osrm_url: 'http://osrm.test', depot_lat: 37.0, depot_lng: -122.0 });
  const tech = (await call('POST', '/api/techs', { name: 'Road Tech' })).body;
  for (const k of [4, 1, 3, 2]) {
    const c = (await call('POST', '/api/customers', { name: 'Road ' + k, lat: 37.0 + k * 0.02, lng: -122.0 })).body;
    const p = (await call('POST', '/api/pools', { customer_id: c.id })).body;
    await call('POST', '/api/stops', { pool_id: p.id, tech_id: tech.id, weekday: 0, start_date: '2020-01-01' });
  }
  osrmMode = 'roads';
  const a = (await call('POST', '/api/routes/optimize', { weekday: 0, tech_id: tech.id })).body;
  assert.equal(a.routing, 'roads'); assert.ok(a.after_miles < a.before_miles);
  osrmMode = 'down';
  const b = (await call('POST', '/api/routes/optimize', { weekday: 0, tech_id: tech.id })).body;
  assert.equal(b.routing, 'estimate', 'falls back to straight-line when the router is down'); assert.ok(b.after_miles < b.before_miles);
  assert.equal((await call('PUT', '/api/settings', { osrm_url: 'ftp://nope' })).status, 400);
  await call('PUT', '/api/settings', { osrm_url: '' });
});
