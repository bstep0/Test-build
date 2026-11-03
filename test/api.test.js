'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { open } = require('../lib/db');
const { createApp } = require('../server');
const Dosing = require('../public/dosing');
const Geo = require('../public/geo');

let server, base;
const call = async (method, path, body) => {
  const r = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: await r.json() };
};
const nextWeekday = (wd) => { const d = new Date(); while (d.getUTCDay() !== wd) d.setUTCDate(d.getUTCDate() + 1); return d.toISOString().slice(0, 10); };

test.before(async () => {
  server = createApp(open(':memory:'), { geocode: async (q) => (q.includes('Nowhere') ? null : { lat: 37.4, lng: -122.1, display: q }) });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
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
