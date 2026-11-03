'use strict';
const DAY = 86400000;

// Materialise visits for `date` (YYYY-MM-DD) from the recurring stops. Idempotent.
function ensureVisits(db, date) {
  const d = new Date(date + 'T00:00:00Z');
  if (isNaN(d)) throw new Error('bad date');
  const stops = db.prepare(
    `SELECT s.*, c.rate FROM stops s JOIN pools p ON p.id = s.pool_id JOIN customers c ON c.id = p.customer_id
     WHERE s.active = 1 AND s.weekday = ? AND s.start_date <= ?`
  ).all(d.getUTCDay(), date);
  const ins = db.prepare(
    `INSERT OR IGNORE INTO visits (stop_id, pool_id, tech_id, date, position, price) VALUES (?,?,?,?,?,?)`
  );
  for (const s of stops) {
    const weeks = Math.floor((d - new Date(s.start_date + 'T00:00:00Z')) / (7 * DAY));
    if (weeks % s.frequency !== 0) continue;
    ins.run(s.id, s.pool_id, s.tech_id, date, s.position, s.rate);
  }
}

module.exports = { ensureVisits };
