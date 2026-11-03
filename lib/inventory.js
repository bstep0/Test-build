'use strict';
// Products with stock levels and cost; chemicals used on completed visits deduct stock and feed margin reporting.
function register(ctx) {
  const { db, route, one, all, run, bad, notFound, insertRow, updateRow, parseJson } = ctx;
  const COLS = ['name', 'unit', 'cost', 'price', 'stock', 'low_stock', 'active'];
  const row = (id) => { const p = one('SELECT * FROM products WHERE id=?', id); if (!p) throw notFound(); p.low = p.low_stock > 0 && p.stock <= p.low_stock; return p; };

  route('GET', '/api/products', () => all('SELECT * FROM products ORDER BY active DESC, name COLLATE NOCASE').map((p) => ({ ...p, low: p.low_stock > 0 && p.stock <= p.low_stock })));
  route('POST', '/api/products', ({ body }) => row(insertRow('products', COLS, [], body, ['name'])));
  route('PUT', '/api/products/:id', ({ params, body }) => { updateRow('products', COLS, [], params.id, body); return row(params.id); });
  route('DELETE', '/api/products/:id', ({ params }) => { if (!run('DELETE FROM products WHERE id=?', params.id).changes) throw notFound(); return { ok: true }; });
  route('POST', '/api/products/:id/adjust', ({ params, body }) => {
    const delta = Number(body.delta);
    if (!isFinite(delta) || delta === 0) throw bad('delta must be a non-zero number');
    row(params.id);
    run('UPDATE products SET stock = stock + ? WHERE id=?', delta, params.id);
    return row(params.id);
  });

  // Reconcile stock + cost for a visit after it changes: give back what was deducted before, then deduct what is used now.
  ctx.syncVisitInventory = (visitId) => {
    const v = one('SELECT status, chemicals, stock_applied FROM visits WHERE id=?', visitId);
    if (!v) return;
    const chems = JSON.parse(v.chemicals || '[]'), prev = JSON.parse(v.stock_applied || '[]');
    const next = [];
    let cost = 0;
    for (const c of chems) {
      const qty = Number(c.qty) || 0, p = c.product_id ? one('SELECT * FROM products WHERE id=?', c.product_id) : null;
      const unit = Number(c.cost === '' || c.cost == null ? p?.cost : c.cost) || 0;
      cost += qty * unit;
      if (p && qty > 0 && v.status === 'done') next.push({ product_id: p.id, qty });
    }
    db.exec('BEGIN');
    try {
      for (const a of prev) run('UPDATE products SET stock = stock + ? WHERE id=?', a.qty, a.product_id);
      for (const a of next) run('UPDATE products SET stock = stock - ? WHERE id=?', a.qty, a.product_id);
      run('UPDATE visits SET stock_applied=?, cost=? WHERE id=?', JSON.stringify(next), Math.round(cost * 100) / 100, visitId);
      db.exec('COMMIT');
    } catch (e) { db.exec('ROLLBACK'); throw e; }
  };
}
module.exports = { register };
