'use strict';
// Estimates the customer can approve from a link; approval creates a work order.
const crypto = require('node:crypto');

function register(ctx) {
  const { route, one, all, run, bad, notFound, HttpError, round2, baseUrl, getSettings } = ctx;
  const cleanItems = (items) => {
    if (!Array.isArray(items) || !items.length) throw bad('Add at least one line item');
    return items.map((i) => {
      const qty = Number(i.qty ?? 1), price = Number(i.price);
      if (!String(i.desc || '').trim()) throw bad('Every line needs a description');
      if (!(qty > 0) || !isFinite(price) || price < 0) throw bad('Quantities and prices must be valid numbers');
      return { desc: String(i.desc).trim().slice(0, 300), qty, price };
    });
  };
  const total = (items) => round2(items.reduce((s, i) => s + i.qty * i.price, 0));
  const full = (id, req) => {
    const q = one(`SELECT q.*, c.name AS customer_name, c.email AS customer_email, p.name AS pool_name FROM quotes q JOIN customers c ON c.id=q.customer_id LEFT JOIN pools p ON p.id=q.pool_id WHERE q.id=?`, id);
    if (!q) throw notFound();
    q.items = JSON.parse(q.items);
    if (req) q.public_url = `${baseUrl(req)}/quote/${q.token}`;
    return q;
  };

  route('GET', '/api/quotes', () => all(`SELECT q.id, q.title, q.total, q.status, q.created_at, q.responded_at, q.customer_id, q.work_order_id, c.name AS customer_name
    FROM quotes q JOIN customers c ON c.id=q.customer_id ORDER BY q.id DESC`));
  route('GET', '/api/quotes/:id', ({ params, req }) => full(params.id, req));
  route('POST', '/api/quotes', ({ body, req }) => {
    if (!one('SELECT id FROM customers WHERE id=?', body.customer_id)) throw bad('Choose a customer');
    if (!String(body.title || '').trim()) throw bad('Title is required');
    const items = cleanItems(body.items);
    const pool = body.pool_id || one('SELECT id FROM pools WHERE customer_id=? ORDER BY id LIMIT 1', body.customer_id)?.id;
    if (!pool) throw bad('This customer has no pool yet — add one first');
    const id = Number(run('INSERT INTO quotes (customer_id, pool_id, token, title, note, items, total) VALUES (?,?,?,?,?,?,?)',
      body.customer_id, pool, crypto.randomBytes(16).toString('hex'), String(body.title).trim(), body.note || '', JSON.stringify(items), total(items)).lastInsertRowid);
    return full(id, req);
  });
  route('PUT', '/api/quotes/:id', ({ params, body, req }) => {
    const q = full(params.id);
    if (!['draft', 'sent'].includes(q.status)) throw bad('A quote that has been answered can no longer be edited');
    const items = body.items ? cleanItems(body.items) : q.items;
    run('UPDATE quotes SET title=?, note=?, items=?, total=?, pool_id=? WHERE id=?', body.title ?? q.title, body.note ?? q.note, JSON.stringify(items), total(items), body.pool_id ?? q.pool_id, q.id);
    return full(q.id, req);
  });
  route('DELETE', '/api/quotes/:id', ({ params }) => { if (!run('DELETE FROM quotes WHERE id=?', params.id).changes) throw notFound(); return { ok: true }; });
  route('POST', '/api/quotes/:id/send', ({ params, req }) => {
    const q = full(params.id, req);
    if (!['draft', 'sent'].includes(q.status)) throw bad('This quote has already been answered');
    run(`UPDATE quotes SET status='sent' WHERE id=?`, q.id);
    ctx.sendMessage?.({ customer_id: q.customer_id, kind: 'quote', subject: `Your quote from ${getSettings().company_name || 'us'}: ${q.title}`,
      body: `Hi ${q.customer_name},\n\nHere is your quote for "${q.title}" (${q.total.toFixed(2)} before tax).\nReview and approve it online: ${q.public_url}\n\nThank you!` });
    return full(q.id, req);
  });

  // ---- customer-facing (no login; the unguessable token is the credential) ----
  const byToken = (t) => { const r = one('SELECT id FROM quotes WHERE token=?', t); if (!r) throw notFound('That quote link is not valid'); return full(r.id); };
  route('GET', '/api/public/quote/:token', ({ params }) => {
    const q = byToken(params.token);
    if (q.status === 'draft') throw notFound('That quote link is not valid');
    const s = getSettings();
    return { quote: { id: q.id, title: q.title, note: q.note, items: q.items, total: q.total, status: q.status, responded_at: q.responded_at, pool_name: q.pool_name },
      customer_name: q.customer_name, company: { name: s.company_name || 'Your pool service', email: s.company_email, phone: s.company_phone }, tax_rate: s.tax_rate };
  });
  route('POST', '/api/public/quote/:token/respond', ({ params, body }) => {
    const q = byToken(params.token);
    if (q.status === 'draft') throw notFound('That quote link is not valid');
    if (!['approve', 'decline'].includes(body.action)) throw bad('action must be approve or decline');
    if (q.status !== 'sent') return { status: q.status, already: true };      // idempotent: first answer wins
    const status = body.action === 'approve' ? 'approved' : 'declined';
    let woId = null;
    if (status === 'approved') {
      woId = Number(run(`INSERT INTO work_orders (pool_id, title, description, price, status) VALUES (?,?,?,?, 'open')`, q.pool_id, `Quote #${q.id}: ${q.title}`,
        q.items.map((i) => `${i.qty} × ${i.desc}`).join('\n'), q.total).lastInsertRowid);
    }
    run('UPDATE quotes SET status=?, responded_at=datetime(\'now\'), work_order_id=? WHERE id=?', status, woId, q.id);
    const s = getSettings();
    if (s.company_email) ctx.sendMessage?.({ to: s.company_email, channel: 'email', kind: 'quote_response', subject: `Quote "${q.title}" ${status} by ${q.customer_name}`, body: `${q.customer_name} ${status} quote #${q.id} (${q.total.toFixed(2)}).${body.name ? ' Signed: ' + String(body.name).slice(0, 80) : ''}` });
    return { status };
  });
}

module.exports = { register };
