'use strict';
/* Accounts, offline sync queue, PWA registration and admin screens. Loaded after app.js (shares its globals). */

// ---------- offline queue (IndexedDB) ----------
const Queue = (() => {
  const open = () => new Promise((res, rej) => {
    const r = indexedDB.open('splashdesk', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('q', { keyPath: 'id', autoIncrement: true });
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  });
  const store = async (mode) => { const db = await open(); const t = db.transaction('q', mode); return { s: t.objectStore('q'), done: new Promise((res, rej) => { t.oncomplete = res; t.onerror = () => rej(t.error); }) }; };
  const req = (r) => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
  const q = {
    busy: false,
    async add(item) { const { s, done } = await store('readwrite'); s.add({ ...item, ts: Date.now() }); await done; await netbar(); },
    async all() { try { const { s } = await store('readonly'); return (await req(s.getAll())).sort((a, b) => a.ts - b.ts); } catch { return []; } },
    async del(id) { const { s, done } = await store('readwrite'); s.delete(id); await done; },
    async flush() {
      if (q.busy || !navigator.onLine) return 0;
      q.busy = true; let n = 0;
      try {
        for (const it of await q.all()) {
          let r;
          try { r = await fetch('/api' + it.url, { method: it.method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(it.body) }); } catch { break; }
          if (r.status === 401) break;                       // signed out: keep the work, retry after login
          if (!r.ok) { const d = await r.json().catch(() => ({})); toast('A queued change was rejected: ' + (d.error || r.status), true); }
          await q.del(it.id); n++;
        }
      } finally { q.busy = false; }
      await netbar();
      if (n) { toast(`Synced ${n} offline change${n > 1 ? 's' : ''}`); render(); }
      return n;
    },
  };
  return q;
})();
window.Queue = Queue;

const netbarEl = document.createElement('div');
netbarEl.id = 'netbar'; netbarEl.setAttribute('role', 'status'); document.body.prepend(netbarEl);
async function netbar() {
  const n = (await Queue.all()).length, off = !navigator.onLine;
  netbarEl.className = off || n ? 'show' + (off ? ' off' : '') : '';
  netbarEl.textContent = off ? `Offline — ${n ? n + ' change' + (n > 1 ? 's' : '') + ' will sync when you reconnect' : 'showing saved data'}` : n ? `Syncing ${n} change${n > 1 ? 's' : ''}…` : '';
}
window.addEventListener('online', () => { netbar(); Queue.flush(); });
window.addEventListener('offline', netbar);
setInterval(() => Queue.flush().then(netbar), 30000);

if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});

// ---------- sign in / first-run setup ----------
function showAuth(needsSetup) {
  document.body.classList.add('auth');
  $('#nav').innerHTML = ''; $('#topbar').innerHTML = '';
  const bubbles = Array.from({ length: 11 }, (_, i) => { const s = 10 + ((i * 37) % 34); return `<i style="width:${s}px;height:${s}px;left:${(i * 9 + 4) % 96}%;animation-duration:${9 + ((i * 5) % 9)}s;animation-delay:${-(i * 1.7)}s"></i>`; }).join('');
  const perks = [['route', 'Optimized routes that cut drive time'], ['drop', 'Dosing guidance on every visit'], ['dollar', 'Invoices and card payments in one place']];
  app.innerHTML = html`<div class="auth-split"><aside class="auth-hero"><div class="row" style="gap:12px"><span class="logo">${icon('wave')}</span><b style="font-size:20px;letter-spacing:-.02em">SplashDesk</b></div>
    <div><h2>Run your pool route like a pro.</h2><p>Schedule smarter, test and dose faster, and get paid sooner — from the office or the backyard.</p>
      <ul>${perks.map(([ic, t], i) => html`<li style="--i:${i}"><i>${icon(ic)}</i>${t}</li>`)}</ul></div>
    <div class="bubbles" aria-hidden="true">${raw(bubbles)}</div>${waves()}</aside>
    <div class="auth-form"><form id="authform" class="auth-card" data-setup="${needsSetup ? 1 : 0}">
      <h1 style="font-size:28px">${needsSetup ? 'Create your account' : 'Welcome back'}</h1>
      <p class="muted" style="margin:6px 0 22px">${needsSetup ? "You'll be the owner. Add office staff and technicians afterwards." : 'Sign in to your SplashDesk workspace.'}</p>
      <div class="fields" style="grid-template-columns:1fr">
        ${needsSetup ? html`<label>Company name<input name="company" autocomplete="organization" required></label><label>Your name<input name="name" autocomplete="name" required></label>` : ''}
        <label>Email<input name="email" type="email" autocomplete="username" required></label>
        <label>Password<input name="password" type="password" autocomplete="${needsSetup ? 'new-password' : 'current-password'}" minlength="${needsSetup ? 8 : 1}" required>${needsSetup ? html`<span class="muted small">At least 8 characters.</span>` : ''}</label>
      </div><div class="error" id="autherr" role="alert"></div>
      <button class="btn primary big" style="width:100%;margin-top:8px">${needsSetup ? 'Create account' : 'Sign in'}</button></form></div></div>`.s;
  $('#authform input')?.focus();
}
window.showAuth = showAuth;
document.addEventListener('submit', async (e) => {
  if (e.target.id !== 'authform') return;
  e.preventDefault();
  const f = e.target, setup = f.dataset.setup === '1', err = $('#autherr');
  err.textContent = '';
  try {
    const body = { email: f.email.value, password: f.password.value };
    if (setup) { body.name = f.name.value; body.company = f.company.value; }
    await POST(setup ? '/auth/setup' : '/auth/login', body);
    await afterLogin();
  } catch (x) { err.textContent = x.message; }
});
async function afterLogin() {
  const r = await GET('/auth/me');
  me = r.user;
  if (!me) return showAuth(r.needsSetup);
  document.body.classList.remove('auth');
  for (const k of Object.keys(cache)) delete cache[k];
  settingsCache = null;
  buildNav();
  location.hash = me.role === 'tech' ? '#/route' : '#/dashboard';
  await render();
  Queue.flush();
}
async function boot() {
  try {
    const r = await GET('/auth/me');
    me = r.user;
    if (!me) return showAuth(r.needsSetup);
  } catch { app.innerHTML = html`<div class="card empty"><h2>Can't reach the server</h2><p>Check your connection and reload.</p></div>`.s; return; }
  document.body.classList.remove('auth');
  buildNav();
  await render();
  Queue.flush(); netbar();
}
actions.logout = async () => {
  const pending = (await Queue.all()).length;
  if (pending && !confirm(`${pending} change${pending > 1 ? 's have' : ' has'} not synced yet and will stay on this device. Sign out anyway?`)) return;
  await POST('/auth/logout');
  navigator.serviceWorker?.controller?.postMessage('clear-api');
  me = null; showAuth(false);
};

// ---------- account ----------
views.account = async () => {
  const pending = (await Queue.all()).length;
  return html`${pageHead('Account', `${me.name} · ${me.email}`)}
  <div class="split"><div class="card"><h3>Profile</h3>
    <p class="muted small mt">Signed in as <b>${me.name}</b> <span class="badge">${me.role}</span></p>
    <div class="row mt"><button class="btn" data-act="changePassword">Change password</button><button class="btn danger" data-act="logout">Sign out</button></div></div>
  <div class="card"><h3>Offline &amp; install</h3>
    <p class="muted small mt">SplashDesk works without a signal: visits you save are stored on this device and sync automatically when you're back online.</p>
    <p class="small"><b>${pending}</b> change${pending === 1 ? '' : 's'} waiting to sync · ${navigator.onLine ? 'online' : 'offline'}</p>
    <p class="muted small">To install: in your phone browser choose <b>Share → Add to Home Screen</b> (iPhone) or <b>⋮ → Install app</b> (Android).</p>
    <button class="btn" data-act="syncNow">Sync now</button></div></div>`;
};
actions.syncNow = async () => { const n = await Queue.flush(); if (!n) toast(navigator.onLine ? 'Everything is up to date' : 'Still offline', !navigator.onLine); render(); };
actions.changePassword = () => openForm({ title: 'Change password', saveLabel: 'Update password', message: html`Other devices will be signed out.`,
  fields: [{ name: 'current', label: 'Current password', type: 'password', full: true }, { name: 'password', label: 'New password (8+ characters)', type: 'password', full: true }],
  onSave: async (d) => { await POST('/auth/password', d); toast('Password updated'); } });

// ---------- users (Team page, owners only) + data & security (Settings) ----------
const baseTeam = views.team;
views.team = async () => {
  const base = await baseTeam();
  if (me.role !== 'owner') return base;
  const [users, ts] = await Promise.all([GET('/users'), techs()]);
  return html`${base}
  <div class="row spread"><h2>Logins</h2><button class="btn sm" data-act="newUser">${icon('plus')} Add user</button></div>
  <div class="card flush" style="overflow-x:auto"><table><thead><tr><th>Name</th><th class="hide-sm">Email</th><th>Role</th><th class="hide-sm">Technician</th><th></th></tr></thead><tbody>
    ${users.map((u) => html`<tr><td><b>${u.name}</b> ${u.active ? '' : raw('<span class="badge bad">disabled</span>')}</td><td class="hide-sm muted">${u.email}</td>
      <td><span class="badge ${u.role === 'owner' ? 'ok' : u.role === 'office' ? 'warn' : ''}">${u.role}</span></td>
      <td class="hide-sm muted">${ts.find((t) => t.id === u.tech_id)?.name || '—'}</td><td class="right"><button class="btn sm" data-act="editUser" data-id="${u.id}">Edit</button></td></tr>`)}</tbody></table></div>
  <p class="muted small mt"><b>Owner</b>: everything. <b>Office</b>: customers, billing, routes — not logins, backups or settings. <b>Technician</b>: only their own route and visits.</p>`;
};
const userFields = (ts, editing) => [
  { name: 'name', label: 'Name', required: true }, { name: 'email', label: 'Email', type: 'email', required: true },
  { name: 'role', label: 'Role', type: 'select', options: [['tech', 'Technician'], ['office', 'Office'], ['owner', 'Owner']] },
  { name: 'tech_id', label: 'Linked technician', type: 'select', int: true, options: techOptions(ts, 'Create / none') },
  { name: 'password', label: editing ? 'New password (leave blank to keep)' : 'Password (8+ characters)', type: 'password', full: true },
  ...(editing ? [{ name: 'active', label: 'Active (can sign in)', type: 'checkbox' }] : []),
];
actions.newUser = async () => openForm({ title: 'Add user', fields: userFields(await techs(), false), values: { role: 'tech' }, onSave: (d) => POST('/users', d) });
actions.editUser = async ({ id }) => {
  const [users, ts] = await Promise.all([GET('/users'), techs()]);
  openForm({ title: 'Edit user', fields: userFields(ts, true), values: users.find((u) => u.id == id), onSave: (d) => { if (!d.password) delete d.password; return PUT('/users/' + id, d); },
    onDelete: () => DEL('/users/' + id), deleteMsg: 'Delete this login? Their past work is kept.' });
};
const baseSettings = views.settings;
views.settings = async () => {
  const base = await baseSettings();
  if (me.role !== 'owner') return base;
  return html`${base}<h2>Data &amp; security</h2><div class="split">
    <div class="card"><h3>Backups</h3><p class="muted small mt">A copy of the database is saved automatically every day (last 14 kept). You can also download one now.</p>
      <a class="btn" href="/api/backup/download" download>Download backup</a></div>
    <div class="card"><h3>Activity log</h3><p class="muted small mt">Who changed what, and when.</p><button class="btn" data-act="auditLog">View recent activity</button></div></div>`;
};
actions.auditLog = async () => {
  const rows = await GET('/audit?limit=100');
  openForm({ title: 'Recent activity', saveLabel: 'Close', fields: [], onSave: async () => {},
    message: html`<div style="max-height:50vh;overflow:auto"><table class="sumtable"><tbody>${rows.map((a) => html`<tr><td class="muted small" style="white-space:nowrap">${a.at.slice(5, 16)}</td><td><b>${a.user_name}</b></td><td class="small">${a.method} ${a.path}<br><span class="muted">${a.summary}</span></td></tr>`)}</tbody></table></div>` });
};
