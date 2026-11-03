'use strict';
// Audit trail and database backups.
const fs = require('node:fs');
const path = require('node:path');

const SENSITIVE = /password|token|secret|card/i;
function summarize(method, pathname, body) {
  const keys = Object.keys(body || {}).filter((k) => !SENSITIVE.test(k)).slice(0, 8);
  return keys.length ? `fields: ${keys.join(', ')}` : '';
}

function backupTo(db, dir, keep = 14) {
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `splashdesk-${new Date().toISOString().replace(/[:.]/g, '-')}.db`);
  db.exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`);
  const all = fs.readdirSync(dir).filter((f) => /^splashdesk-.*\.db$/.test(f)).sort();
  for (const f of all.slice(0, Math.max(0, all.length - keep))) fs.unlinkSync(path.join(dir, f));
  return file;
}

function register(ctx) {
  const { db, route, all, run, opts } = ctx;
  ctx.audit = (user, method, pathname, body) => {
    try { run('INSERT INTO audit (user_id, user_name, method, path, summary) VALUES (?,?,?,?,?)', user.id, user.name, method, pathname, summarize(method, pathname, body)); } catch { /* never block a request on logging */ }
  };
  route('GET', '/api/audit', ({ query }) => all('SELECT * FROM audit ORDER BY id DESC LIMIT ?', Math.min(500, Number(query.limit) || 100)));
  route('GET', '/api/backup/download', () => {
    const dir = opts.backupDir || path.join(path.dirname(process.env.DB_PATH || 'data/x'), 'backups');
    const file = backupTo(db, dir);
    return { __raw: { status: 200, headers: { 'Content-Type': 'application/octet-stream', 'Content-Disposition': `attachment; filename="${path.basename(file)}"` }, body: fs.readFileSync(file) } };
  });
}

// Daily automatic backups for file-backed databases.
function scheduleBackups(db, dir) {
  const run = () => { try { backupTo(db, dir); } catch (e) { console.error('Backup failed:', e.message); } };
  const t = setInterval(run, 24 * 3600 * 1000); t.unref();
  setTimeout(run, 5000).unref();
}

module.exports = { register, backupTo, scheduleBackups };
