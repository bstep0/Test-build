'use strict';
// Day-to-day schedule changes: a tech is out (reassign their day), or one visit moves to another date.
function register(ctx) {
  const { db, route, one, run, bad, notFound, isDate, ensureVisits } = ctx;

  route('POST', '/api/schedule/reassign', ({ body }) => {
    if (!isDate(body.date)) throw bad('date must be YYYY-MM-DD');
    ensureVisits(db, body.date);
    const to = body.to_tech_id ?? null;
    if (to !== null && !one('SELECT id FROM techs WHERE id=?', to)) throw bad('unknown technician');
    const from = body.from_tech_id ?? null;
    const r = from === null
      ? run(`UPDATE visits SET tech_id=? WHERE date=? AND tech_id IS NULL AND status='scheduled'`, to, body.date)
      : run(`UPDATE visits SET tech_id=? WHERE date=? AND tech_id=? AND status='scheduled'`, to, body.date, from);
    return { moved: r.changes };
  });

  // Move one visit to another date. The original becomes "skipped" (so the recurring stop doesn't regenerate it)
  // and a one-off visit is created on the new date.
  route('POST', '/api/visits/:id/reschedule', ({ params, body }) => {
    const v = one('SELECT * FROM visits WHERE id=?', params.id);
    if (!v) throw notFound();
    if (!isDate(body.date)) throw bad('date must be YYYY-MM-DD');
    if (v.status !== 'scheduled') throw bad('Only a visit that has not been completed can be moved');
    if (v.invoice_id) throw bad('Visit is already invoiced');
    if (body.date === v.date) throw bad('Choose a different date');
    db.exec('BEGIN');
    try {
      run(`UPDATE visits SET status='skipped', notes=trim(notes || ' Moved to ' || ?) WHERE id=?`, body.date, v.id);
      const id = Number(run('INSERT INTO visits (pool_id, tech_id, date, position, price) VALUES (?,?,?,?,?)', v.pool_id, v.tech_id, body.date, 999, v.price).lastInsertRowid);
      db.exec('COMMIT');
      return { id, date: body.date };
    } catch (e) { db.exec('ROLLBACK'); throw e; }
  });
}
module.exports = { register };
