'use strict';
// Accounts, sessions (hashed tokens in SQLite, HttpOnly cookie), roles and login throttling. No dependencies.
const crypto = require('node:crypto');

const COOKIE = 'sd_session';
const SESSION_DAYS = 30;
const sha = (t) => crypto.createHash('sha256').update(t).digest('hex');
const hashPassword = (pw) => { const salt = crypto.randomBytes(16); return `scrypt$${salt.toString('hex')}$${crypto.scryptSync(pw, salt, 64).toString('hex')}`; };
const DUMMY = hashPassword('not-a-real-password');   // equalises timing for unknown emails
function verifyPassword(pw, stored) {
  const [alg, salt, hash] = String(stored || '').split('$');
  if (alg !== 'scrypt') return false;
  const calc = crypto.scryptSync(pw, Buffer.from(salt, 'hex'), 64), exp = Buffer.from(hash, 'hex');
  return exp.length === calc.length && crypto.timingSafeEqual(calc, exp);
}
const cookies = (req) => Object.fromEntries((req.headers.cookie || '').split(';').map((c) => c.trim().split(/=(.*)/s).slice(0, 2)).filter((p) => p[0]));
const publicUser = (u) => u && { id: u.id, email: u.email, name: u.name, role: u.role, tech_id: u.tech_id };

function authenticate(db, req) {
  const tok = cookies(req)[COOKIE];
  if (!tok) return null;
  return db.prepare(`SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ? AND s.expires_at > ? AND u.active = 1`)
    .get(sha(tok), Date.now()) || null;
}

// Role policy. Owners can do everything; office staff everything except users/backups/audit/settings writes;
// technicians only what they need in the field.
const TECH_ALLOW = [
  ['GET', /^\/api\/(day\/[\d-]+|visits\/\d+|techs|settings|products|work-orders|pool-history\/\d+|visits\/\d+\/photos|photos\/\d+)$/],
  ['PUT', /^\/api\/visits\/\d+$/],
  ['POST', /^\/api\/(dose|work-orders|visits\/\d+\/photos|visits\/\d+\/eta|auth\/password)$/],
];
const OFFICE_DENY = [/^\/api\/users/, /^\/api\/backup/, /^\/api\/audit/, /^\/api\/stripe\/config/];
function can(user, method, path) {
  if (user.role === 'owner') return true;
  if (user.role === 'office') return !OFFICE_DENY.some((re) => re.test(path)) && !(method === 'PUT' && path === '/api/settings');
  return TECH_ALLOW.some(([m, re]) => m === method && re.test(path));
}

function register(ctx) {
  const { db, route, one, all, run, bad, HttpError, notFound } = ctx;
  const attempts = new Map();
  const throttle = (key) => {
    const now = Date.now(), a = attempts.get(key);
    if (a && a.reset > now && a.n >= 8) throw new HttpError(429, 'Too many attempts — try again in a few minutes');
    return (fail) => { const cur = attempts.get(key); if (!fail) return attempts.delete(key); attempts.set(key, !cur || cur.reset < now ? { n: 1, reset: now + 15 * 60 * 1000 } : { n: cur.n + 1, reset: cur.reset }); };
  };
  const startSession = (userId, req, reply) => {
    const token = crypto.randomBytes(32).toString('hex');
    run('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?,?,?)', sha(token), userId, Date.now() + SESSION_DAYS * 864e5);
    run('DELETE FROM sessions WHERE expires_at < ?', Date.now());
    const secure = process.env.COOKIE_SECURE === '1' || req.headers['x-forwarded-proto'] === 'https';
    reply.headers['Set-Cookie'] = `${COOKIE}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${SESSION_DAYS * 86400}${secure ? '; Secure' : ''}`;
  };
  const needUsers = () => one('SELECT COUNT(*) AS n FROM users').n === 0;
  const checkPw = (pw) => { if (typeof pw !== 'string' || pw.length < 8) throw bad('Password must be at least 8 characters'); };
  const checkEmail = (e) => { if (typeof e !== 'string' || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)) throw bad('A valid email is required'); };

  route('GET', '/api/auth/me', ({ user }) => ({ user: publicUser(user), needsSetup: !user && needUsers() }));
  route('POST', '/api/auth/setup', ({ body, req, reply }) => {
    if (!needUsers()) throw new HttpError(403, 'Setup already completed');
    checkEmail(body.email); checkPw(body.password);
    if (!body.name) throw bad('Name is required');
    const id = Number(run(`INSERT INTO users (email, name, role, password_hash) VALUES (?,?, 'owner', ?)`, body.email, body.name, hashPassword(body.password)).lastInsertRowid);
    if (body.company) run(`INSERT INTO settings (key, value) VALUES ('company_name', ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`, JSON.stringify(String(body.company)));
    startSession(id, req, reply);
    return { user: publicUser(one('SELECT * FROM users WHERE id=?', id)) };
  });
  route('POST', '/api/auth/login', ({ body, req, reply }) => {
    const key = `${req.socket.remoteAddress}|${String(body.email).toLowerCase()}`, record = throttle(key);
    const u = one('SELECT * FROM users WHERE email = ? AND active = 1', String(body.email || ''));
    const ok = verifyPassword(String(body.password || ''), u ? u.password_hash : DUMMY);
    if (!u || !ok) { record(true); throw new HttpError(401, 'Incorrect email or password'); }
    record(false); startSession(u.id, req, reply);
    return { user: publicUser(u) };
  });
  route('POST', '/api/auth/logout', ({ req, reply }) => {
    const tok = cookies(req)[COOKIE];
    if (tok) run('DELETE FROM sessions WHERE token_hash = ?', sha(tok));
    reply.headers['Set-Cookie'] = `${COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`;
    return { ok: true };
  });
  route('POST', '/api/auth/password', ({ body, user, req, reply }) => {
    const u = one('SELECT * FROM users WHERE id=?', user.id);
    if (!verifyPassword(String(body.current || ''), u.password_hash)) throw new HttpError(403, 'Current password is incorrect');
    checkPw(body.password);
    run('UPDATE users SET password_hash=? WHERE id=?', hashPassword(body.password), user.id);
    run('DELETE FROM sessions WHERE user_id=?', user.id);   // sign out everywhere, then sign this device back in
    startSession(user.id, req, reply);
    return { ok: true };
  });

  // ---- user management (owner only; enforced by `can`) ----
  const listUsers = () => all('SELECT id, email, name, role, tech_id, active, created_at FROM users ORDER BY name COLLATE NOCASE');
  const ROLES = ['owner', 'office', 'tech'];
  const ownersLeft = (exceptId) => one(`SELECT COUNT(*) AS n FROM users WHERE role='owner' AND active=1 AND id != ?`, exceptId).n;
  route('GET', '/api/users', () => listUsers());
  route('POST', '/api/users', ({ body }) => {
    checkEmail(body.email); checkPw(body.password);
    if (!body.name) throw bad('Name is required');
    if (!ROLES.includes(body.role)) throw bad('Role must be owner, office or tech');
    if (one('SELECT id FROM users WHERE email=?', body.email)) throw bad('That email is already in use');
    let techId = body.tech_id || null;
    if (body.role === 'tech' && !techId) techId = Number(run('INSERT INTO techs (name) VALUES (?)', body.name).lastInsertRowid);
    const id = Number(run('INSERT INTO users (email, name, role, password_hash, tech_id) VALUES (?,?,?,?,?)', body.email, body.name, body.role, hashPassword(body.password), techId).lastInsertRowid);
    return listUsers().find((u) => u.id === id);
  });
  route('PUT', '/api/users/:id', ({ params, body, user }) => {
    const u = one('SELECT * FROM users WHERE id=?', params.id);
    if (!u) throw notFound();
    const role = body.role ?? u.role, active = body.active === undefined ? u.active : +!!body.active;
    if (!ROLES.includes(role)) throw bad('Bad role');
    if ((role !== 'owner' || !active) && u.role === 'owner' && !ownersLeft(u.id)) throw bad('There must be at least one active owner');
    if (u.id === user.id && !active) throw bad('You cannot deactivate yourself');
    if (body.email !== undefined) { checkEmail(body.email); if (one('SELECT id FROM users WHERE email=? AND id!=?', body.email, u.id)) throw bad('That email is already in use'); }
    run('UPDATE users SET name=?, email=?, role=?, active=?, tech_id=? WHERE id=?', body.name ?? u.name, body.email ?? u.email, role, active, body.tech_id === undefined ? u.tech_id : body.tech_id, u.id);
    if (body.password) { checkPw(body.password); run('UPDATE users SET password_hash=? WHERE id=?', hashPassword(body.password), u.id); }
    if (!active || body.password) run('DELETE FROM sessions WHERE user_id=?', u.id);
    return listUsers().find((x) => x.id === u.id);
  });
  route('DELETE', '/api/users/:id', ({ params, user }) => {
    const u = one('SELECT * FROM users WHERE id=?', params.id);
    if (!u) throw notFound();
    if (u.id === user.id) throw bad('You cannot delete yourself');
    if (u.role === 'owner' && !ownersLeft(u.id)) throw bad('There must be at least one active owner');
    run('DELETE FROM users WHERE id=?', u.id);
    return { ok: true };
  });
}

module.exports = { register, authenticate, can, hashPassword, verifyPassword, publicUser, COOKIE };
