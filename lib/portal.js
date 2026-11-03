'use strict';
// Customer portal: a private link per customer showing upcoming visits, water tests, photos, invoices and quotes.
const { nextDates } = require('./schedule');
const Dosing = require('../public/dosing');

function register(ctx) {
  const { db, route, one, all, run, bad, notFound, HttpError, getSettings, baseUrl, utcToday, parseJson } = ctx;
  const customerByToken = (t) => {
    const c = /^[0-9a-f]{32}$/.test(t) ? one('SELECT * FROM customers WHERE portal_token=? AND archived=0', t) : null;
    if (!c) throw notFound('That link is not valid');
    return c;
  };
  const photoDir = () => ctx.photoDir;

  route('GET', '/api/public/portal/:token', ({ params, req }) => {
    const c = customerByToken(params.token), s = getSettings(), today = utcToday();
    const pools = all('SELECT * FROM pools WHERE customer_id=? ORDER BY id', c.id).map((p) => {
      const stops = all('SELECT * FROM stops WHERE pool_id=? AND active=1', p.id);
      const next = stops.flatMap((st) => nextDates(db, st, today, 3)).sort().slice(0, 3);
      const last = one(`SELECT id, date, fc, ph, ta, cya, ch, salt, temp, notes FROM visits WHERE pool_id=? AND status='done' ORDER BY date DESC, id DESC LIMIT 1`, p.id);
      const photos = last ? all('SELECT id, caption FROM photos WHERE visit_id=? ORDER BY id', last.id).map((x) => ({ ...x, url: `/api/public/portal/${params.token}/photo/${x.id}` })) : [];
      return { id: p.id, name: p.name, type: p.type, volume_gal: p.volume_gal, next, last: last && { ...last, findings: Dosing.analyze(p.volume_gal, last) }, photos };
    });
    const history = all(`SELECT v.date, p.name AS pool_name, t.name AS tech_name, v.tasks FROM visits v JOIN pools p ON p.id=v.pool_id LEFT JOIN techs t ON t.id=v.tech_id
      WHERE p.customer_id=? AND v.status='done' ORDER BY v.date DESC, v.id DESC LIMIT 10`, c.id).map((v) => parseJson(v, ['tasks']));
    const invoices = all(`SELECT id, issued, due, status, total, paid_at, token FROM invoices WHERE customer_id=? ORDER BY id DESC LIMIT 12`, c.id)
      .map((i) => ({ ...i, pay_url: `${baseUrl(req)}/pay/${i.token}`, token: undefined }));
    const quotes = all(`SELECT title, total, status, token FROM quotes WHERE customer_id=? AND status='sent' ORDER BY id DESC`, c.id).map((q) => ({ title: q.title, total: q.total, url: `${baseUrl(req)}/quote/${q.token}` }));
    return { customer: { name: c.name }, company: { name: s.company_name || 'Your pool service', email: s.company_email, phone: s.company_phone }, pools, history, invoices, quotes };
  });

  route('GET', '/api/public/portal/:token/photo/:id', ({ params }) => {
    const c = customerByToken(params.token);
    const p = one(`SELECT ph.* FROM photos ph JOIN visits v ON v.id=ph.visit_id JOIN pools po ON po.id=v.pool_id WHERE ph.id=? AND po.customer_id=?`, params.id, c.id);
    if (!p) throw notFound();
    return ctx.photoResponse(p);
  });

  // "Request service": becomes an open work order and notifies the office. Limited to 5 per customer per day.
  route('POST', '/api/public/portal/:token/request', ({ params, body }) => {
    const c = customerByToken(params.token);
    const message = String(body.message || '').trim().slice(0, 1000);
    if (message.length < 5) throw bad('Please describe what you need');
    const recent = one(`SELECT COUNT(*) AS n FROM work_orders w JOIN pools p ON p.id=w.pool_id WHERE p.customer_id=? AND w.title LIKE 'Customer request%' AND w.created_at > datetime('now','-1 day')`, c.id).n;
    if (recent >= 5) throw new HttpError(429, 'Too many requests today — please call us instead');
    const pool = (body.pool_id && one('SELECT id FROM pools WHERE id=? AND customer_id=?', body.pool_id, c.id)) || one('SELECT id FROM pools WHERE customer_id=? ORDER BY id LIMIT 1', c.id);
    if (!pool) throw bad('No pool on file');
    run(`INSERT INTO work_orders (pool_id, title, description, status) VALUES (?, 'Customer request', ?, 'open')`, pool.id, message);
    const s = getSettings();
    if (s.company_email) ctx.sendMessage?.({ to: s.company_email, channel: 'email', kind: 'portal_request', subject: `Service request from ${c.name}`, body: `${c.name} asked via the portal:\n\n${message}` });
    return { ok: true };
  });
}
module.exports = { register };
