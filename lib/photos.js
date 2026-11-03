'use strict';
// Visit photos: uploaded as data URLs (the app downsizes them first), validated by magic bytes, stored on disk.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const SIG = [['jpg', 'image/jpeg', [0xff, 0xd8, 0xff]], ['png', 'image/png', [0x89, 0x50, 0x4e, 0x47]], ['webp', 'image/webp', null]];
function sniff(buf) {
  if (buf.length > 12 && buf.slice(0, 4).toString() === 'RIFF' && buf.slice(8, 12).toString() === 'WEBP') return SIG[2];
  return SIG.slice(0, 2).find(([, , sig]) => sig.every((b, i) => buf[i] === b)) || null;
}

function register(ctx) {
  const { db, route, one, all, run, bad, notFound, HttpError, opts } = ctx;
  const dbFile = process.env.DB_PATH || 'data/splashdesk.db';
  ctx.photoDir = opts.photoDir || process.env.PHOTO_DIR || (dbFile === ':memory:' ? fs.mkdtempSync(path.join(os.tmpdir(), 'sd-photos-')) : path.join(path.dirname(dbFile), 'photos'));
  fs.mkdirSync(ctx.photoDir, { recursive: true });
  const MAX_PER_VISIT = 12, MAX_BYTES = 6 * 1024 * 1024;

  const visitFor = (id, user) => {
    const v = one('SELECT id, tech_id FROM visits WHERE id=?', id);
    if (!v) throw notFound();
    if (user.role === 'tech' && v.tech_id !== user.tech_id) throw new HttpError(403, 'That stop is not assigned to you');
    return v;
  };
  ctx.photoResponse = (p) => {
    const file = path.join(ctx.photoDir, path.basename(p.file));      // basename: the DB value can never escape the folder
    if (!fs.existsSync(file)) throw notFound();
    const type = { jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp' }[path.extname(file).slice(1)] || 'application/octet-stream';
    return { __raw: { status: 200, headers: { 'Content-Type': type, 'Cache-Control': 'private, max-age=86400' }, body: fs.readFileSync(file) } };
  };

  route('POST', '/api/visits/:id/photos', ({ params, body, user }) => {
    visitFor(params.id, user);
    const m = /^data:image\/(?:jpeg|png|webp);base64,([A-Za-z0-9+/=\s]+)$/.exec(String(body.data || ''));
    if (!m) throw bad('Photo must be a JPEG, PNG or WebP image');
    const buf = Buffer.from(m[1], 'base64');
    if (buf.length > MAX_BYTES) throw new HttpError(413, 'Photo is too large (max 6 MB)');
    const kind = sniff(buf);
    if (!kind) throw bad('That file is not a valid image');
    if (one('SELECT COUNT(*) AS n FROM photos WHERE visit_id=?', params.id).n >= MAX_PER_VISIT) throw bad(`A visit can have at most ${MAX_PER_VISIT} photos`);
    const id = Number(run('INSERT INTO photos (visit_id, file, caption, user_id) VALUES (?,?,?,?)', params.id, 'pending', String(body.caption || '').slice(0, 200), user.id).lastInsertRowid);
    const file = `${id}.${kind[0]}`;
    fs.writeFileSync(path.join(ctx.photoDir, file), buf);
    run('UPDATE photos SET file=? WHERE id=?', file, id);
    return { id, url: `/api/photos/${id}` };
  });
  route('GET', '/api/visits/:id/photos', ({ params, user }) => {
    visitFor(params.id, user);
    return all('SELECT id, caption, created_at FROM photos WHERE visit_id=? ORDER BY id', params.id).map((p) => ({ ...p, url: `/api/photos/${p.id}` }));
  });
  route('GET', '/api/photos/:id', ({ params, user }) => {
    const p = one('SELECT * FROM photos WHERE id=?', params.id);
    if (!p) throw notFound();
    visitFor(p.visit_id, user);
    return ctx.photoResponse(p);
  });
  route('DELETE', '/api/photos/:id', ({ params, user }) => {
    const p = one('SELECT * FROM photos WHERE id=?', params.id);
    if (!p) throw notFound();
    if (user.role === 'tech') { visitFor(p.visit_id, user); if (p.user_id !== user.id) throw new HttpError(403, 'You can only remove your own photos'); }
    try { fs.unlinkSync(path.join(ctx.photoDir, path.basename(p.file))); } catch { /* already gone */ }
    run('DELETE FROM photos WHERE id=?', p.id);
    return { ok: true };
  });
}
module.exports = { register, sniff };
