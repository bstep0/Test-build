'use strict';
const DAY = 86400000;

const skipDates = (db) => {
  const r = db.prepare(`SELECT value FROM settings WHERE key='skip_dates'`).get();
  return r ? JSON.parse(r.value) : [];
};

// Does this recurring stop run on `date`? (weekday, every-N-weeks cadence, start/end dates)
function stopRunsOn(stop, date) {
  const d = new Date(date + 'T00:00:00Z');
  if (!stop.active || d.getUTCDay() !== stop.weekday || stop.start_date > date || (stop.end_date && stop.end_date < date)) return false;
  return Math.floor((d - new Date(stop.start_date + 'T00:00:00Z')) / (7 * DAY)) % stop.frequency === 0;
}

// Materialise visits for `date` (YYYY-MM-DD) from the recurring stops. Idempotent. Holidays generate nothing.
function ensureVisits(db, date) {
  if (isNaN(new Date(date + 'T00:00:00Z'))) throw new Error('bad date');
  if (skipDates(db).includes(date)) return;
  const stops = db.prepare(
    `SELECT s.*, c.rate FROM stops s JOIN pools p ON p.id = s.pool_id JOIN customers c ON c.id = p.customer_id
     WHERE s.active = 1 AND c.archived = 0 AND s.weekday = ? AND s.start_date <= ?`
  ).all(new Date(date + 'T00:00:00Z').getUTCDay(), date);
  const ins = db.prepare(`INSERT OR IGNORE INTO visits (stop_id, pool_id, tech_id, date, position, price) VALUES (?,?,?,?,?,?)`);
  for (const s of stops) if (stopRunsOn(s, date)) ins.run(s.id, s.pool_id, s.tech_id, date, s.position, s.rate);
}

// The next `n` service dates for a stop on/after `from` (used by the customer portal).
function nextDates(db, stop, from, n = 3, horizonDays = 120) {
  const skip = skipDates(db), out = [];
  for (let i = 0; i < horizonDays && out.length < n; i++) {
    const date = new Date(new Date(from + 'T00:00:00Z').getTime() + i * DAY).toISOString().slice(0, 10);
    if (stopRunsOn(stop, date) && !skip.includes(date)) out.push(date);
  }
  return out;
}

module.exports = { ensureVisits, nextDates, stopRunsOn };
