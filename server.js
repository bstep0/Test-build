'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { open } = require('./lib/db');
const { ensureVisits } = require('./lib/schedule');
const Dosing = require('./public/dosing');

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
const bad = (m) => new HttpError(400, m);
const notFound = (m = 'Not found') => new HttpError(404, m);
const isDate = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(new Date(s));
const utcToday = () => new Date().toISOString().slice(0, 10);
const addDays = (date, n) => new Date(new Date(date + 'T00:00:00Z').getTime() + n * 864e5).toISOString().slice(0, 10);

function createApp(db) {
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
  const CUST = ['name', 'phone', 'email', 'address', 'city', 'gate_code', 'notes', 'rate'];
  route('GET', '/api/customers', () =>
    all(`SELECT c.*, (SELECT COUNT(*) FROM pools p WHERE p.customer_id=c.id) AS pools,
         COALESCE((SELECT SUM(total) FROM invoices i WHERE i.customer_id=c.id AND i.status='open'),0) AS balance
         FROM customers c ORDER BY c.name COLLATE NOCASE`));
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
    all(`SELECT p.*, c.name AS customer_name, c.address FROM pools p JOIN customers c ON c.id=p.customer_id ORDER BY c.name COLLATE NOCASE, p.id`));
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
        if (kind === 'update' && ['tech_id', 'weekday', 'frequency', 'active', 'start_date'].some((k) => body[k] !== undefined)) dropFuture(id);
      },
      beforeDelete: (id) => dropFuture(id),
    },
  });

  // ---- visits / daily route ----
  const VISIT_SELECT = `SELECT v.*, p.name AS pool_name, p.type AS pool_type, p.volume_gal, p.notes AS pool_notes,
      c.id AS customer_id, c.name AS customer_name, c.address, c.city, c.phone, c.gate_code, c.notes AS customer_notes,
      t.name AS tech_name, t.color AS tech_color
    FROM visits v JOIN pools p ON p.id=v.pool_id JOIN customers c ON c.id=p.customer_id LEFT JOIN techs t ON t.id=v.tech_id`;
  const VISIT = ['pool_id', 'tech_id', 'date', 'position', 'status', 'arrived_at', 'completed_at', 'fc', 'ph', 'ta', 'cya', 'ch', 'salt', 'temp', 'tasks', 'chemicals', 'notes', 'price'];
  const VJSON = ['tasks', 'chemicals'];
  const flag = (v) => Dosing.issues(v.volume_gal, v);

  route('GET', '/api/day/:date', ({ params, query }) => {
    if (!isDate(params.date)) throw bad('date must be YYYY-MM-DD');
    ensureVisits(db, params.date);
    const rows = query.tech_id
      ? all(`${VISIT_SELECT} WHERE v.date=? AND v.tech_id=? ORDER BY v.position, v.id`, params.date, query.tech_id)
      : all(`${VISIT_SELECT} WHERE v.date=? ORDER BY t.name, v.position, v.id`, params.date);
    return rows.map((v) => parseJson(v, VJSON));
  });
  route('GET', '/api/visits/:id', ({ params }) => {
    const v = one(`${VISIT_SELECT} WHERE v.id=?`, params.id);
    if (!v) throw notFound();
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
  route('PUT', '/api/visits/:id', ({ params, body }) => {
    const cur = one('SELECT * FROM visits WHERE id=?', params.id);
    if (!cur) throw notFound();
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

  // ---- http plumbing ----
  async function handleApi(req, res, url) {
    let body = {};
    if (req.method === 'POST' || req.method === 'PUT') {
      const chunks = []; let size = 0;
      for await (const c of req) { size += c.length; if (size > 1e6) throw new HttpError(413, 'Body too large'); chunks.push(c); }
      if (chunks.length) { try { body = JSON.parse(Buffer.concat(chunks).toString()); } catch { throw bad('Invalid JSON'); } }
      if (body === null || typeof body !== 'object' || Array.isArray(body)) throw bad('Body must be a JSON object');
    }
    const query = Object.fromEntries(url.searchParams);
    let pathMatched = false;
    for (const r of routes) {
      const m = r.re.exec(url.pathname);
      if (!m) continue;
      pathMatched = true;
      if (r.method !== req.method) continue;
      const out = r.fn({ params: { ...m.groups }, query, body });
      return send(res, 200, out);
    }
    throw pathMatched ? new HttpError(405, 'Method not allowed') : notFound();
  }
  const send = (res, status, data) => {
    const s = JSON.stringify(data);
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(s);
  };

  const PUB = path.join(__dirname, 'public');
  const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.json': 'application/json', '.png': 'image/png', '.ico': 'image/x-icon' };
  function serveStatic(req, res, url) {
    let rel = decodeURIComponent(url.pathname);
    if (rel === '/') rel = '/index.html';
    const file = path.normalize(path.join(PUB, rel));
    if (!file.startsWith(PUB + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain' }); return res.end('Not found');
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    fs.createReadStream(file).pipe(res);
  }

  return http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://localhost');
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
      if (!res.headersSent) send(res, e.status, { error: e.message }); else res.end();
    }
  });
}

module.exports = { createApp };

if (require.main === module) {
  const db = open();
  if (process.env.SEED_DEMO && !db.prepare('SELECT 1 FROM techs LIMIT 1').get()) {
    require('./seed').seed(db);
    console.log('Seeded demo data.');
  }
  const port = Number(process.env.PORT) || 3000;
  const host = process.env.HOST || '127.0.0.1';
  createApp(db).listen(port, host, () => console.log(`SplashDesk running at http://${host}:${port}`));
}
