'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { open } = require('./lib/db');
const { ensureVisits } = require('./lib/schedule');
const Dosing = require('./public/dosing');
const Geo = require('./public/geo');
const Auth = require('./lib/auth');
const Ops = require('./lib/ops');

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
const bad = (m) => new HttpError(400, m);
const notFound = (m = 'Not found') => new HttpError(404, m);
const isDate = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(new Date(s));
const utcToday = () => new Date().toISOString().slice(0, 10);
const addDays = (date, n) => new Date(new Date(date + 'T00:00:00Z').getTime() + n * 864e5).toISOString().slice(0, 10);

async function nominatim(q) { // free OSM geocoder; only called when the user asks for a lookup
  const r = await fetch('https://nominatim.openstreetmap.org/search?format=json&limit=1&q=' + encodeURIComponent(q),
    { headers: { 'User-Agent': 'SplashDesk/1.0 (pool route software)' }, signal: AbortSignal.timeout(8000) });
  if (!r.ok) throw new Error('Geocoder returned ' + r.status);
  const [hit] = await r.json();
  return hit ? { lat: +hit.lat, lng: +hit.lon, display: hit.display_name } : null;
}

function createApp(db, opts = {}) {
  const { geocode = nominatim } = opts;
  const routes = [];
  const route = (method, p, fn) =>
    routes.push({ method, re: new RegExp('^' + p.replace(/:(\w+)/g, '(?<$1>[^/]+)') + '$'), fn });

  const one = (sql, ...a) => db.prepare(sql).get(...a);
  const all = (sql, ...a) => db.prepare(sql).all(...a);
  const run = (sql, ...a) => db.prepare(sql).run(...a);
  const parseJson = (row, cols) => {
    if (row) for (const c of cols) if (typeof row[c] === 'string') row[c] = JSON.parse(row[c]);
    return row;
  };
  const norm = (v) => (v === undefined ? null : typeof v === 'boolean' ? +v : v);

  // ---- generic row helpers (column names always come from a whitelist) ----
  function insertRow(table, cols, json, body, required = []) {
    for (const r of required) if (body[r] === undefined || body[r] === null || body[r] === '') throw bad(`${r} is required`);
    const keys = cols.filter((c) => body[c] !== undefined);
    const vals = keys.map((k) => (json.includes(k) ? JSON.stringify(body[k]) : norm(body[k])));
    const sql = keys.length
      ? `INSERT INTO ${table} (${keys.join(',')}) VALUES (${keys.map(() => '?').join(',')})`
      : `INSERT INTO ${table} DEFAULT VALUES`;
    return Number(run(sql, ...vals).lastInsertRowid);
  }
  function updateRow(table, cols, json, id, body) {
    const keys = cols.filter((c) => body[c] !== undefined);
    if (keys.length) {
      const vals = keys.map((k) => (json.includes(k) ? JSON.stringify(body[k]) : norm(body[k])));
      const r = run(`UPDATE ${table} SET ${keys.map((k) => k + '=?').join(',')} WHERE id=?`, ...vals, id);
      if (!r.changes) throw notFound();
    } else if (!one(`SELECT id FROM ${table} WHERE id=?`, id)) throw notFound();
  }
  function crud(base, table, cols, { json = [], required = [], order = 'id', after = {}, defaults = () => ({}) } = {}) {
    const get = (id) => {
      const r = one(`SELECT * FROM ${table} WHERE id=?`, id);
      if (!r) throw notFound();
      return parseJson(r, json);
    };
    route('GET', base, ({ query }) => {
      const ks = Object.keys(query).filter((k) => cols.includes(k));
      const where = ks.length ? ' WHERE ' + ks.map((k) => k + '=?').join(' AND ') : '';
      return all(`SELECT * FROM ${table}${where} ORDER BY ${order}`, ...ks.map((k) => query[k])).map((r) => parseJson(r, json));
    });
    route('GET', base + '/:id', ({ params }) => get(params.id));
    route('POST', base, ({ body }) => {
      body = { ...defaults(), ...body };
      const id = insertRow(table, cols, json, body, required);
      after.write?.(id, body, 'create');
      return get(id);
    });
    route('PUT', base + '/:id', ({ params, body }) => {
      updateRow(table, cols, json, params.id, body);
      after.write?.(Number(params.id), body, 'update');
      return get(params.id);
    });
    route('DELETE', base + '/:id', ({ params }) => {
      after.beforeDelete?.(Number(params.id));
      if (!run(`DELETE FROM ${table} WHERE id=?`, params.id).changes) throw notFound();
      return { ok: true };
    });
    return get;
  }

  // ---- techs ----
  crud('/api/techs', 'techs', ['name', 'phone', 'color'], { required: ['name'], order: 'name' });

  // ---- customers ----
  const CUST = ['name', 'phone', 'email', 'address', 'city', 'gate_code', 'notes', 'rate', 'lat', 'lng'];
  route('GET', '/api/customers', ({ query }) =>
    all(`SELECT c.*, (SELECT COUNT(*) FROM pools p WHERE p.customer_id=c.id) AS pools,
         COALESCE((SELECT SUM(total) FROM invoices i WHERE i.customer_id=c.id AND i.status='open'),0) AS balance
         FROM customers c WHERE c.archived = ? ORDER BY c.name COLLATE NOCASE`, query.archived === '1' ? 1 : 0));
  // Deleting a customer archives them (history and invoices are kept); owners may purge permanently.
  route('DELETE', '/api/customers/:id', ({ params, query, user }) => {
    const c = one('SELECT id FROM customers WHERE id=?', params.id);
    if (!c) throw notFound();
    if (query.permanent === '1') {
      if (user.role !== 'owner') throw new HttpError(403, 'Only an owner can permanently delete a customer');
      run('DELETE FROM customers WHERE id=?', c.id);
      return { ok: true, permanent: true };
    }
    run('UPDATE customers SET archived=1 WHERE id=?', c.id);
    for (const s of all('SELECT s.id FROM stops s JOIN pools p ON p.id=s.pool_id WHERE p.customer_id=?', c.id)) { run('UPDATE stops SET active=0 WHERE id=?', s.id); dropFuture(s.id); }
    return { ok: true, archived: true };
  });
  route('POST', '/api/customers/:id/restore', ({ params }) => {
    if (!run('UPDATE customers SET archived=0 WHERE id=?', params.id).changes) throw notFound();
    return { ok: true };
  });
  route('GET', '/api/customers/:id', ({ params }) => {
    const c = one('SELECT * FROM customers WHERE id=?', params.id);
    if (!c) throw notFound();
    c.pools = all('SELECT * FROM pools WHERE customer_id=? ORDER BY id', c.id);
    for (const p of c.pools)
      p.stops = all(`SELECT s.*, t.name AS tech_name FROM stops s LEFT JOIN techs t ON t.id=s.tech_id WHERE s.pool_id=? ORDER BY s.weekday`, p.id);
    c.visits = all(
      `SELECT v.*, p.name AS pool_name, p.volume_gal, t.name AS tech_name FROM visits v JOIN pools p ON p.id=v.pool_id
       LEFT JOIN techs t ON t.id=v.tech_id WHERE p.customer_id=? AND v.status!='scheduled' ORDER BY v.date DESC, v.id DESC LIMIT 25`, c.id
    ).map((v) => parseJson(v, ['tasks', 'chemicals']));
    c.work_orders = all(
      `SELECT w.*, p.name AS pool_name FROM work_orders w JOIN pools p ON p.id=w.pool_id WHERE p.customer_id=? ORDER BY w.id DESC`, c.id);
    c.invoices = all('SELECT id,issued,due,status,total FROM invoices WHERE customer_id=? ORDER BY id DESC', c.id);
    c.unbilled = unbilled(c.id).total;
    return c;
  });
  crud('/api/customers', 'customers', CUST, { required: ['name'] });

  // ---- pools ----
  route('GET', '/api/pools', () =>
    all(`SELECT p.*, c.name AS customer_name, c.address FROM pools p JOIN customers c ON c.id=p.customer_id WHERE c.archived=0 ORDER BY c.name COLLATE NOCASE, p.id`));
  crud('/api/pools', 'pools', ['customer_id', 'name', 'type', 'volume_gal', 'surface', 'sanitizer', 'notes'], { required: ['customer_id'] });

  // ---- stops (recurring route) ----
  const dropFuture = (stopId) =>
    run(`DELETE FROM visits WHERE stop_id=? AND status='scheduled' AND arrived_at IS NULL AND date >= ?
         AND fc IS NULL AND ph IS NULL AND ta IS NULL AND cya IS NULL AND ch IS NULL AND salt IS NULL AND temp IS NULL
         AND tasks='[]' AND chemicals='[]' AND notes=''`, stopId, addDays(utcToday(), -1)); // never discard a tech's draft
  crud('/api/stops', 'stops', ['pool_id', 'tech_id', 'weekday', 'frequency', 'position', 'active', 'start_date'], {
    required: ['pool_id', 'weekday'],
    order: 'weekday, position',
    defaults: () => ({ start_date: utcToday() }),
    after: {
      write: (id, body, kind) => {  // reordering alone must not reshuffle; anything else regenerates lazily
        if (kind === 'update' && body.position !== undefined)
          run(`UPDATE visits SET position=? WHERE stop_id=? AND status='scheduled' AND date >= ?`, body.position, id, addDays(utcToday(), -1));
        if (kind === 'update' && ['tech_id', 'weekday', 'frequency', 'active', 'start_date'].some((k) => body[k] !== undefined)) dropFuture(id);
      },
      beforeDelete: (id) => dropFuture(id),
    },
  });

  // ---- visits / daily route ----
  const VISIT_SELECT = `SELECT v.*, p.name AS pool_name, p.type AS pool_type, p.volume_gal, p.notes AS pool_notes,
      c.id AS customer_id, c.name AS customer_name, c.address, c.city, c.lat, c.lng, c.phone, c.gate_code, c.notes AS customer_notes,
      t.name AS tech_name, t.color AS tech_color
    FROM visits v JOIN pools p ON p.id=v.pool_id JOIN customers c ON c.id=p.customer_id LEFT JOIN techs t ON t.id=v.tech_id`;
  const VISIT = ['pool_id', 'tech_id', 'date', 'position', 'status', 'arrived_at', 'completed_at', 'fc', 'ph', 'ta', 'cya', 'ch', 'salt', 'temp', 'tasks', 'chemicals', 'notes', 'price'];
  const VJSON = ['tasks', 'chemicals'];
  const flag = (v) => Dosing.issues(v.volume_gal, v);

  const ownStop = (user, v) => { if (user.role === 'tech' && v.tech_id !== user.tech_id) throw new HttpError(403, 'That stop is not assigned to you'); };
  route('GET', '/api/day/:date', ({ params, query, user }) => {
    if (!isDate(params.date)) throw bad('date must be YYYY-MM-DD');
    ensureVisits(db, params.date);
    if (user.role === 'tech') query = { ...query, tech_id: user.tech_id || -1 };   // technicians only ever see their own route
    const rows = query.tech_id
      ? all(`${VISIT_SELECT} WHERE v.date=? AND v.tech_id=? ORDER BY v.position, v.id`, params.date, query.tech_id)
      : all(`${VISIT_SELECT} WHERE v.date=? ORDER BY t.name, v.position, v.id`, params.date);
    return rows.map((v) => parseJson(v, VJSON));
  });
  route('GET', '/api/visits/:id', ({ params, user }) => {
    const v = one(`${VISIT_SELECT} WHERE v.id=?`, params.id);
    if (!v) throw notFound();
    ownStop(user, v);
    parseJson(v, VJSON);
    v.previous = parseJson(one(
      `SELECT date, fc, ph, ta, cya, ch, salt, temp FROM visits WHERE pool_id=? AND status='done' AND id!=? AND date<=? ORDER BY date DESC, id DESC LIMIT 1`,
      v.pool_id, v.id, v.date), []);
    return v;
  });
  route('POST', '/api/visits', ({ body }) => {
    if (!isDate(body.date)) throw bad('date must be YYYY-MM-DD');
    const pool = one('SELECT p.id, c.rate FROM pools p JOIN customers c ON c.id=p.customer_id WHERE p.id=?', body.pool_id);
    if (!pool) throw bad('unknown pool');
    const id = insertRow('visits', VISIT, VJSON, { position: 999, price: pool.rate, ...body });
    return parseJson(one(`${VISIT_SELECT} WHERE v.id=?`, id), VJSON);
  });
  route('PUT', '/api/visits/:id', ({ params, body, user }) => {
    const cur = one('SELECT * FROM visits WHERE id=?', params.id);
    if (!cur) throw notFound();
    if (user.role === 'tech') { ownStop(user, cur); for (const k of ['pool_id', 'tech_id', 'date', 'position', 'price', 'cost', 'completed_at']) delete body[k]; }
    if (cur.invoice_id && ((body.price !== undefined && body.price !== cur.price) || (body.status !== undefined && body.status !== cur.status))) throw bad('Visit is already invoiced');
    if (body.status && !['scheduled', 'done', 'skipped'].includes(body.status)) throw bad('bad status');
    const now = new Date().toISOString();
    if (body.status === 'done' && !cur.completed_at && body.completed_at === undefined) body.completed_at = now;
    if (body.status === 'scheduled') body.completed_at = null;
    updateRow('visits', VISIT, VJSON, params.id, body);
    return parseJson(one(`${VISIT_SELECT} WHERE v.id=?`, params.id), VJSON);
  });
  route('DELETE', '/api/visits/:id', ({ params }) => {
    const v = one('SELECT invoice_id FROM visits WHERE id=?', params.id);
    if (!v) throw notFound();
    if (v.invoice_id) throw bad('Visit is already invoiced');
    run('DELETE FROM visits WHERE id=?', params.id);
    return { ok: true };
  });

  // ---- work orders ----
  const WO = ['pool_id', 'tech_id', 'title', 'description', 'price', 'status', 'due_date', 'completed_at'];
  const woRow = (id) => one(`SELECT w.*, p.name AS pool_name, c.name AS customer_name, c.id AS customer_id FROM work_orders w JOIN pools p ON p.id=w.pool_id JOIN customers c ON c.id=p.customer_id WHERE w.id=?`, id);
  route('GET', '/api/work-orders', ({ query }) =>
    all(`SELECT w.*, p.name AS pool_name, c.name AS customer_name, c.id AS customer_id, t.name AS tech_name
         FROM work_orders w JOIN pools p ON p.id=w.pool_id JOIN customers c ON c.id=p.customer_id LEFT JOIN techs t ON t.id=w.tech_id
         ${query.status ? 'WHERE w.status=?' : ''} ORDER BY (w.status='done'), w.due_date IS NULL, w.due_date, w.id DESC`,
      ...(query.status ? [query.status] : [])));
  route('POST', '/api/work-orders', ({ body }) => woRow(insertRow('work_orders', WO, [], body, ['pool_id', 'title'])));
  route('PUT', '/api/work-orders/:id', ({ params, body }) => {
    const cur = one('SELECT * FROM work_orders WHERE id=?', params.id);
    if (!cur) throw notFound();
    if (cur.invoice_id && (body.price !== undefined || body.status !== undefined)) throw bad('Work order is already invoiced');
    if (body.status && !['open', 'scheduled', 'done'].includes(body.status)) throw bad('bad status');
    if (body.status === 'done' && !cur.completed_at) body.completed_at = new Date().toISOString();
    if (body.status && body.status !== 'done') body.completed_at = null;
    updateRow('work_orders', WO, [], params.id, body);
    return woRow(params.id);
  });
  route('DELETE', '/api/work-orders/:id', ({ params }) => {
    const w = one('SELECT invoice_id FROM work_orders WHERE id=?', params.id);
    if (!w) throw notFound();
    if (w.invoice_id) throw bad('Work order is already invoiced');
    run('DELETE FROM work_orders WHERE id=?', params.id);
    return { ok: true };
  });

  // ---- invoices ----
  const round2 = (n) => Math.round(n * 100) / 100;
  function unbilled(customerId) {
    const visits = all(
      `SELECT v.* , p.name AS pool_name FROM visits v JOIN pools p ON p.id=v.pool_id
       WHERE p.customer_id=? AND v.status='done' AND v.invoice_id IS NULL ORDER BY v.date, v.id`, customerId).map((v) => parseJson(v, VJSON));
    const wos = all(
      `SELECT w.* FROM work_orders w JOIN pools p ON p.id=w.pool_id
       WHERE p.customer_id=? AND w.status='done' AND w.invoice_id IS NULL ORDER BY w.id`, customerId);
    const items = [];
    for (const v of visits) {
      if (v.price > 0) items.push({ desc: `Pool service — ${v.pool_name} (${v.date})`, qty: 1, price: v.price });
      for (const ch of v.chemicals) if (Number(ch.charge) > 0) items.push({ desc: `${ch.name} ${ch.qty || ''} ${ch.unit || ''} (${v.date})`.replace(/\s+/g, ' ').trim(), qty: 1, price: Number(ch.charge) });
    }
    for (const w of wos) if (w.price > 0) items.push({ desc: `Repair: ${w.title}`, qty: 1, price: w.price });
    return { visits, wos, items, total: round2(items.reduce((s, i) => s + i.qty * i.price, 0)) };
  }
  const invoiceFull = (id) => {
    const inv = one(`SELECT i.*, c.name AS customer_name, c.address, c.city, c.email FROM invoices i JOIN customers c ON c.id=i.customer_id WHERE i.id=?`, id);
    if (!inv) throw notFound();
    return parseJson(inv, ['items']);
  };
  route('GET', '/api/invoices', ({ query }) =>
    all(`SELECT i.id,i.customer_id,i.issued,i.due,i.status,i.total,i.paid_at, c.name AS customer_name
         FROM invoices i JOIN customers c ON c.id=i.customer_id ${query.status ? 'WHERE i.status=?' : ''} ORDER BY i.id DESC`,
      ...(query.status ? [query.status] : [])));
  route('GET', '/api/invoices/:id', ({ params }) => invoiceFull(params.id));
  route('POST', '/api/invoices/generate', ({ body }) => {
    if (!one('SELECT id FROM customers WHERE id=?', body.customer_id)) throw bad('unknown customer');
    const u = unbilled(body.customer_id);
    if (!u.items.length) throw bad('Nothing to invoice');
    const issued = isDate(body.issued) ? body.issued : utcToday();
    const due = isDate(body.due) ? body.due : addDays(issued, 14);
    db.exec('BEGIN');
    try {
      const id = Number(run('INSERT INTO invoices (customer_id, issued, due, items, total) VALUES (?,?,?,?,?)',
        body.customer_id, issued, due, JSON.stringify(u.items), u.total).lastInsertRowid);
      for (const v of u.visits) run('UPDATE visits SET invoice_id=? WHERE id=?', id, v.id);
      for (const w of u.wos) run('UPDATE work_orders SET invoice_id=? WHERE id=?', id, w.id);
      db.exec('COMMIT');
      return invoiceFull(id);
    } catch (e) { db.exec('ROLLBACK'); throw e; }
  });
  route('POST', '/api/invoices/:id/pay', ({ params, body }) => {
    const r = run(`UPDATE invoices SET status='paid', paid_at=?, method=? WHERE id=?`, isDate(body.paid_at) ? body.paid_at : utcToday(), body.method || '', params.id);
    if (!r.changes) throw notFound();
    return invoiceFull(params.id);
  });
  route('POST', '/api/invoices/:id/reopen', ({ params }) => {
    if (!run(`UPDATE invoices SET status='open', paid_at=NULL, method='' WHERE id=?`, params.id).changes) throw notFound();
    return invoiceFull(params.id);
  });
  route('DELETE', '/api/invoices/:id', ({ params }) => {   // void: releases the billed items again
    invoiceFull(params.id);
    run('UPDATE visits SET invoice_id=NULL WHERE invoice_id=?', params.id);
    run('UPDATE work_orders SET invoice_id=NULL WHERE invoice_id=?', params.id);
    run('DELETE FROM invoices WHERE id=?', params.id);
    return { ok: true };
  });

  // ---- settings (depot, speeds) ----
  const SETTING_DEFAULTS = { depot_name: 'Shop', depot_address: '', depot_lat: null, depot_lng: null, speed_mph: 25, service_min: 25, round_trip: 1 };
  const getSettings = () => {
    const out = { ...SETTING_DEFAULTS };
    for (const r of all('SELECT key, value FROM settings')) if (r.key in out) out[r.key] = JSON.parse(r.value);
    return out;
  };
  route('GET', '/api/settings', () => getSettings());
  route('PUT', '/api/settings', ({ body }) => {
    for (const [k, v] of Object.entries(body)) {
      if (!(k in SETTING_DEFAULTS)) continue;
      const numeric = typeof SETTING_DEFAULTS[k] === 'number' || k.endsWith('_lat') || k.endsWith('_lng');
      let x = numeric ? (v === '' || v === null ? null : Number(v)) : v;
      if (numeric && x !== null && isNaN(x)) throw bad(`${k} must be a number`);
      if (['speed_mph', 'service_min'].includes(k) && !(x > 0)) throw bad(`${k} must be positive`);
      run('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value', k, JSON.stringify(x));
    }
    return getSettings();
  });
  const depotOf = (s) => (Geo.has({ lat: s.depot_lat, lng: s.depot_lng }) ? { lat: s.depot_lat, lng: s.depot_lng } : null);

  route('POST', '/api/geocode', async ({ body }) => {
    if (!body.query) throw bad('query is required');
    let hit; try { hit = await geocode(body.query); } catch (e) { throw new HttpError(502, 'Address lookup failed: ' + e.message); }
    if (!hit) throw notFound('No match for that address');
    return hit;
  });
  route('POST', '/api/geocode-missing', async () => {   // fill in map locations for customers that lack them
    const todo = all(`SELECT id, address, city FROM customers WHERE (lat IS NULL OR lng IS NULL) AND address != '' LIMIT 20`);
    let updated = 0, failed = 0;
    for (const c of todo) {
      try {
        const hit = await geocode(`${c.address}, ${c.city}`);
        if (hit) { run('UPDATE customers SET lat=?, lng=? WHERE id=?', hit.lat, hit.lng, c.id); updated++; } else failed++;
      } catch { failed++; }
      if (geocode === nominatim) await new Promise((r) => setTimeout(r, 1100)); // be polite to the free service
    }
    return { updated, failed, remaining: one(`SELECT COUNT(*) AS n FROM customers WHERE (lat IS NULL OR lng IS NULL) AND address != ''`).n };
  });

  // ---- route builder board + optimiser ----
  route('GET', '/api/board', ({ query }) => {
    const stops = all(
      `SELECT s.*, p.name AS pool_name, p.volume_gal, c.id AS customer_id, c.name AS customer_name, c.address, c.city, c.lat, c.lng, c.rate,
              t.name AS tech_name, t.color AS tech_color
       FROM stops s JOIN pools p ON p.id=s.pool_id JOIN customers c ON c.id=p.customer_id LEFT JOIN techs t ON t.id=s.tech_id
       WHERE s.active=1 ${query.tech_id ? 'AND s.tech_id=?' : ''} ORDER BY s.weekday, s.position, s.id`, ...(query.tech_id ? [query.tech_id] : []));
    const unassigned = all(
      `SELECT p.id AS pool_id, p.name AS pool_name, p.volume_gal, c.id AS customer_id, c.name AS customer_name, c.address, c.city, c.lat, c.lng, c.rate
       FROM pools p JOIN customers c ON c.id=p.customer_id
       WHERE c.archived=0 AND NOT EXISTS (SELECT 1 FROM stops s WHERE s.pool_id=p.id AND s.active=1) ORDER BY c.name COLLATE NOCASE`);
    return { stops, unassigned, settings: getSettings() };
  });

  // Optimise either a calendar day's visits ({date}) or the recurring weekday template ({weekday}).
  // One independent route per technician. `apply: false` previews without saving.
  route('POST', '/api/routes/optimize', ({ body }) => {
    const st = getSettings(), depot = depotOf(st), roundTrip = !!st.round_trip;
    const byDate = isDate(body.date);
    if (!byDate && !(Number.isInteger(body.weekday) && body.weekday >= 0 && body.weekday <= 6)) throw bad('date or weekday is required');
    const techFilter = body.tech_id ? ' AND x.tech_id = ?' : '';
    const args = body.tech_id ? [body.tech_id] : [];
    let rows;
    if (byDate) {
      ensureVisits(db, body.date);
      rows = all(`SELECT x.id, x.tech_id, x.position, x.status, c.lat, c.lng FROM visits x JOIN pools p ON p.id=x.pool_id JOIN customers c ON c.id=p.customer_id
                  WHERE x.date=?${techFilter} ORDER BY x.position, x.id`, body.date, ...args);
    } else {
      rows = all(`SELECT x.id, x.tech_id, x.position, 'scheduled' AS status, c.lat, c.lng FROM stops x JOIN pools p ON p.id=x.pool_id JOIN customers c ON c.id=p.customer_id
                  WHERE x.active=1 AND x.weekday=?${techFilter} ORDER BY x.position, x.id`, body.weekday, ...args);
    }
    const groups = new Map();
    for (const r of rows) { const k = r.tech_id ?? 0; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(r); }
    const result = { applied: !!body.apply, groups: [], before_miles: 0, after_miles: 0, depot_assumed: !depot, missing: 0 };
    const opts = { roundTrip, speed: st.speed_mph, serviceMin: st.service_min };
    const upd = db.prepare(byDate ? 'UPDATE visits SET position=? WHERE id=?' : 'UPDATE stops SET position=? WHERE id=?');
    const updVisitsOfStop = db.prepare(`UPDATE visits SET position=? WHERE stop_id=? AND status='scheduled' AND date >= ?`);
    for (const [techId, list] of groups) {
      const fixed = list.filter((r) => r.status !== 'scheduled');          // done/skipped visits stay put
      const movable = list.filter((r) => r.status === 'scheduled');
      const o = Geo.optimizeItems(depot, movable, { roundTrip });
      const base = fixed.reduce((m, r) => Math.max(m, r.position), 0);
      const before = Geo.stats(depot, movable, opts), after = Geo.stats(depot, o.ordered, opts);
      result.groups.push({
        tech_id: techId || null, tech_name: techId ? one('SELECT name FROM techs WHERE id=?', techId)?.name : 'Unassigned',
        count: movable.length, located: before.located, before_miles: o.before, after_miles: o.after,
        before_min: before.totalMin, after_min: after.totalMin, order: o.ordered.map((r) => r.id),
      });
      result.before_miles += o.before; result.after_miles += o.after; result.missing += o.missing;
      if (body.apply) {
        db.exec('BEGIN');
        try {
          o.ordered.forEach((r, i) => {
            const pos = (byDate ? base : 0) + (i + 1) * 10;
            upd.run(pos, r.id);
            if (!byDate) updVisitsOfStop.run(pos, r.id, addDays(utcToday(), -1));
          });
          db.exec('COMMIT');
        } catch (e) { db.exec('ROLLBACK'); throw e; }
      }
    }
    return result;
  });

  // ---- dashboard + dosing ----
  route('GET', '/api/dashboard', ({ query }) => {
    const date = isDate(query.date) ? query.date : utcToday();
    ensureVisits(db, date);
    const byTech = all(
      `SELECT COALESCE(t.name,'Unassigned') AS name, COALESCE(t.color,'#94a3b8') AS color, COUNT(*) AS total,
              SUM(v.status='done') AS done, SUM(v.status='skipped') AS skipped
       FROM visits v LEFT JOIN techs t ON t.id=v.tech_id WHERE v.date=? GROUP BY v.tech_id ORDER BY name`, date);
    const month = date.slice(0, 7);
    const attention = all(
      `${VISIT_SELECT} WHERE v.status='done' AND v.date >= ? AND v.id = (SELECT MAX(id) FROM visits x WHERE x.pool_id=v.pool_id AND x.status='done')
       ORDER BY v.date DESC`, addDays(date, -10))
      .map((v) => ({ id: v.id, date: v.date, customer_id: v.customer_id, customer_name: v.customer_name, pool_name: v.pool_name, issues: flag(v) }))
      .filter((v) => v.issues.length);
    return {
      date,
      today: { total: byTech.reduce((s, t) => s + t.total, 0), done: byTech.reduce((s, t) => s + (t.done || 0), 0), byTech },
      open_work_orders: one(`SELECT COUNT(*) AS n FROM work_orders WHERE status!='done'`).n,
      outstanding: one(`SELECT COALESCE(SUM(total),0) AS n FROM invoices WHERE status='open'`).n,
      overdue: one(`SELECT COALESCE(SUM(total),0) AS n FROM invoices WHERE status='open' AND due < ?`, date).n,
      paid_this_month: one(`SELECT COALESCE(SUM(total),0) AS n FROM invoices WHERE status='paid' AND substr(paid_at,1,7)=?`, month).n,
      customers: one('SELECT COUNT(*) AS n FROM customers').n,
      attention,
    };
  });
  route('POST', '/api/dose', ({ body }) => Dosing.analyze(body.volume, body.readings || {}));

  // ---- feature modules (each registers its own routes) ----
  const ctx = { db, route, one, all, run, bad, notFound, HttpError, opts, parseJson, insertRow, updateRow, isDate, addDays, utcToday, ensureVisits, getSettings, round2: (n) => Math.round(n * 100) / 100 };
  Auth.register(ctx);
  Ops.register(ctx);
  for (const m of opts.modules || require('./lib/modules')) m.register(ctx);

  // ---- http plumbing ----
  const PUBLIC_API = [/^\/api\/auth\/(me|setup|login|logout)$/, /^\/api\/public\//, /^\/api\/stripe\/webhook$/];
  const MAX_BODY = (p) => (/\/photos$/.test(p) ? 12e6 : 1e6);
  async function handleApi(req, res, url) {
    const reply = { headers: {} }, pathname = url.pathname, mutating = !['GET', 'HEAD'].includes(req.method);
    let body = {}, rawBody = '';
    if (req.method === 'POST' || req.method === 'PUT') {
      const chunks = []; let size = 0;
      for await (const c of req) { size += c.length; if (size > MAX_BODY(pathname)) throw new HttpError(413, 'Body too large'); chunks.push(c); }
      rawBody = Buffer.concat(chunks).toString();
      if (rawBody) { try { body = JSON.parse(rawBody); } catch { throw bad('Invalid JSON'); } }
      if (body === null || typeof body !== 'object' || Array.isArray(body)) throw bad('Body must be a JSON object');
    }
    // CSRF defence in depth (cookies are SameSite=Lax): refuse cross-origin state changes
    const origin = req.headers.origin;
    if (mutating && origin && !/^\/api\/stripe\/webhook$/.test(pathname)) {
      let same = false; try { same = new URL(origin).host === req.headers.host; } catch { /* bad origin */ }
      if (!same) throw new HttpError(403, 'Cross-origin request blocked');
    }
    const isPublic = PUBLIC_API.some((re) => re.test(pathname));
    const user = Auth.authenticate(db, req);
    if (!isPublic) {
      if (!user) throw new HttpError(401, 'Please sign in');
      if (!Auth.can(user, req.method, pathname)) throw new HttpError(403, 'You do not have access to that');
    }
    const query = Object.fromEntries(url.searchParams);
    let pathMatched = false;
    for (const r of routes) {
      const m = r.re.exec(pathname);
      if (!m) continue;
      pathMatched = true;
      if (r.method !== req.method) continue;
      const out = await r.fn({ params: { ...m.groups }, query, body, user, req, reply, rawBody });
      if (mutating && user && !isPublic) ctx.audit(user, req.method, pathname, body);
      return send(res, 200, out, reply);
    }
    throw pathMatched ? new HttpError(405, 'Method not allowed') : notFound();
  }
  const SECURITY = {
    'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'same-origin', 'X-Frame-Options': 'DENY',
    'Content-Security-Policy': "default-src 'self'; img-src 'self' data: blob: https://*.tile.openstreetmap.org; style-src 'self' 'unsafe-inline' https://cdnjs.cloudflare.com; script-src 'self' https://cdnjs.cloudflare.com; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
  };
  const send = (res, status, data, reply = { headers: {} }) => {
    if (data && data.__raw) { res.writeHead(data.__raw.status, { ...SECURITY, 'Cache-Control': 'no-store', ...data.__raw.headers, ...reply.headers }); return res.end(data.__raw.body); }
    res.writeHead(status, { ...SECURITY, 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...reply.headers });
    res.end(JSON.stringify(data));
  };

  const PUB = path.join(__dirname, 'public');
  const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.ico': 'image/x-icon' };
  function serveStatic(req, res, url) {
    let rel = decodeURIComponent(url.pathname);
    if (rel === '/') rel = '/index.html';
    if (/^\/(portal|quote|pay)(\/|$)/.test(rel)) rel = '/public.html';   // customer-facing pages (no login)
    const file = path.normalize(path.join(PUB, rel));
    if (!file.startsWith(PUB + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain' }); return res.end('Not found');
    }
    res.writeHead(200, { ...SECURITY, 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    fs.createReadStream(file).pipe(res);
  }

  return http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://localhost');
      if (url.pathname === '/healthz') { db.prepare('SELECT 1').get(); res.writeHead(200, { 'Content-Type': 'text/plain' }); return res.end('ok'); }
      if (url.pathname.startsWith('/api/')) return await handleApi(req, res, url);
      if (req.method !== 'GET' && req.method !== 'HEAD') throw new HttpError(405, 'Method not allowed');
      serveStatic(req, res, url);
    } catch (e) {
      if (!(e instanceof HttpError)) {
        const msg = String(e.message || e);
        // SQLite constraint violations are client errors (bad references, NOT NULL, ...)
        if (/constraint/i.test(msg)) e = bad(msg.replace(/^.*constraint failed: /i, 'Invalid data: '));
        else { console.error(e); e = new HttpError(500, 'Server error'); }
      }
      if (!res.headersSent) send(res, e.status, { error: e.message }, { headers: e.headers || {} }); else res.end();
    }
  });
}

module.exports = { createApp };

if (require.main === module) {
  const dbFile = process.env.DB_PATH || path.join(__dirname, 'data', 'splashdesk.db');
  const db = open(dbFile);
  if (process.env.SEED_DEMO && !db.prepare('SELECT 1 FROM techs LIMIT 1').get()) {
    require('./seed').seed(db);
    console.log('Seeded demo data. Demo logins: owner@demo.test / tech@demo.test  (password: demo1234)');
  }
  if (!process.env.NO_BACKUPS) require('./lib/ops').scheduleBackups(db, process.env.BACKUP_DIR || path.join(path.dirname(dbFile), 'backups'));
  const port = Number(process.env.PORT) || 3000;
  const host = process.env.HOST || '127.0.0.1';
  createApp(db).listen(port, host, () => console.log(`SplashDesk running at http://${host}:${port}`));
}
