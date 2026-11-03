'use strict';
/* SplashDesk front end — vanilla JS, hash-routed. All dynamic text is escaped by the `html` tag. */

// ---------- helpers ----------
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
class Raw { constructor(s) { this.s = s; } }
const raw = (s) => new Raw(s);
const val = (v) => (v instanceof Raw ? v.s : Array.isArray(v) ? v.map(val).join('') : esc(v));
const html = (strs, ...vals) => new Raw(strs.reduce((a, s, i) => a + s + (i < vals.length ? val(vals[i]) : ''), ''));

const $ = (s, r = document) => r.querySelector(s);
const app = $('#app');
const money = (n) => new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD' }).format(n || 0);
const localISO = (d = new Date()) => new Date(d - d.getTimezoneOffset() * 6e4).toISOString().slice(0, 10);
const addDays = (s, n) => { const d = new Date(s + 'T12:00:00'); d.setDate(d.getDate() + n); return localISO(d); };
const fmtDate = (s, o = { weekday: 'short', month: 'short', day: 'numeric' }) => (s ? new Date(s.slice(0, 10) + 'T12:00:00').toLocaleDateString(undefined, o) : '—');
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const num = (v) => (v === '' || v == null ? null : Number(v));

async function api(method, url, body) {
  const r = await fetch('/api' + url, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || `Request failed (${r.status})`);
  return data;
}
const GET = (u) => api('GET', u), POST = (u, b) => api('POST', u, b || {}), PUT = (u, b) => api('PUT', u, b), DEL = (u) => api('DELETE', u);

let toastTimer;
function toast(msg, err) {
  const t = $('#toast'); t.textContent = msg; t.className = 'show' + (err ? ' err' : '');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => (t.className = ''), 2600);
}
const guard = (fn) => async (...a) => { try { return await fn(...a); } catch (e) { toast(e.message, true); } };

// ---------- modal form builder ----------
const modal = $('#modal');
function fieldHtml(f, v) {
  const val_ = v?.[f.name] ?? f.default ?? '';
  const cls = f.full ? ' class="full"' : '';
  if (f.type === 'checkbox') return html`<label class="check full"><input type="checkbox" name="${f.name}" ${raw(val_ ? 'checked' : '')}> ${f.label}</label>`;
  let input;
  if (f.type === 'select') input = html`<select name="${f.name}">${(f.options || []).map(([k, l]) => html`<option value="${k}" ${raw(String(k) === String(val_) ? 'selected' : '')}>${l}</option>`)}</select>`;
  else if (f.type === 'textarea') input = html`<textarea name="${f.name}" rows="3">${val_}</textarea>`;
  else input = html`<input name="${f.name}" type="${f.type || 'text'}" value="${val_}" ${raw(f.step ? `step="${f.step}"` : '')} ${raw(f.required ? 'required' : '')} ${raw(f.type === 'tel' ? 'inputmode="tel"' : '')}>`;
  return html`<label${raw(cls)}>${f.label}${input}</label>`;
}
function openForm({ title, fields, values = {}, onSave, onDelete, saveLabel = 'Save' }) {
  modal.innerHTML = html`<form method="dialog" id="mform"><h3 style="font-size:18px;margin-bottom:14px">${title}</h3>
    <div class="fields">${fields.map((f) => fieldHtml(f, values))}</div>
    <div class="row spread mt"><div>${onDelete ? raw('<button type="button" class="btn danger" data-m="delete">Delete</button>') : ''}</div>
    <div class="row"><button type="button" class="btn" data-m="cancel">Cancel</button><button class="btn primary">${saveLabel}</button></div></div></form>`.s;
  const form = $('#mform', modal);
  form.onsubmit = guard(async (e) => {
    e.preventDefault();
    const data = {};
    for (const f of fields) {
      const el = form.elements[f.name];
      data[f.name] = f.type === 'checkbox' ? +el.checked : f.type === 'number' ? num(el.value) : el.value;
      if (f.nullable && data[f.name] === '') data[f.name] = null;
      if (f.type === 'select' && f.int) data[f.name] = data[f.name] === '' ? null : Number(data[f.name]);
    }
    await onSave(data);
    modal.close(); await render();
  });
  form.querySelector('[data-m=cancel]').onclick = () => modal.close();
  const d = form.querySelector('[data-m=delete]');
  if (d) d.onclick = guard(async () => { if (confirm('Delete this permanently?')) { await onDelete(); modal.close(); await render(); } });
  modal.showModal();
  form.querySelector('input,select,textarea')?.focus();
}

// ---------- shared data ----------
const cache = {};
const techs = async () => (cache.techs = await GET('/techs'));
const techOptions = (list, blank = 'Unassigned') => [['', blank], ...list.map((t) => [t.id, t.name])];

// ---------- actions (event delegation) ----------
const actions = {};
document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-act]');
  if (el) { e.preventDefault(); const f = actions[el.dataset.act]; if (f) guard(f)(el.dataset, el); return; }
  const row = e.target.closest('[data-href]');
  if (row && !e.target.closest('a,button')) location.hash = row.dataset.href;
});
document.addEventListener('input', (e) => {
  const lv = e.target.closest('[data-live]');
  if (lv) live[lv.dataset.live]?.(e);
  if (e.target.matches('[data-filter]')) {
    const q = e.target.value.toLowerCase();
    document.querySelectorAll(e.target.dataset.filter).forEach((r) => (r.hidden = !r.textContent.toLowerCase().includes(q)));
  }
});
const live = {};

// ---------- router ----------
const views = {};
async function render() {
  const [name, ...args] = (location.hash.slice(2) || 'dashboard').split('/');
  document.querySelectorAll('nav [data-nav]').forEach((a) => a.classList.toggle('active', a.dataset.nav === (name === 'visit' ? 'route' : name)));
  try {
    const scroll = window.scrollY;
    const v = await (views[name] || views.dashboard)(...args);
    app.innerHTML = v.s;
    window.scrollTo(0, scroll);
  } catch (e) {
    app.innerHTML = html`<div class="empty card"><h2>Something went wrong</h2><p>${e.message}</p></div>`.s;
  }
}
window.addEventListener('hashchange', () => { window.scrollTo(0, 0); render(); });

// ---------- Dashboard ----------
views.dashboard = async () => {
  const d = await GET('/dashboard?date=' + localISO());
  const pct = d.today.total ? Math.round((100 * d.today.done) / d.today.total) : 0;
  return html`<h1>Dashboard</h1>
  <div class="grid">
    <div class="card stat"><div class="n">${d.today.done}/${d.today.total}</div><div class="l">Stops done today</div><div class="bar mt"><i style="width:${pct}%"></i></div></div>
    <div class="card stat"><div class="n">${d.open_work_orders}</div><div class="l">Open work orders</div></div>
    <div class="card stat"><div class="n">${money(d.outstanding)}</div><div class="l">Outstanding${d.overdue ? ` · ${money(d.overdue)} overdue` : ''}</div></div>
    <div class="card stat"><div class="n">${money(d.paid_this_month)}</div><div class="l">Collected this month</div></div>
  </div>
  <h2>Today by technician</h2>
  ${d.today.byTech.length ? html`<div class="grid">${d.today.byTech.map((t) => html`<a class="card" href="#/route" style="color:inherit;text-decoration:none">
      <div class="row"><span class="dot" style="background:${t.color}"></span><b>${t.name}</b><span class="grow"></span><span class="muted">${t.done || 0}/${t.total}</span></div>
      <div class="bar mt"><i style="width:${(100 * (t.done || 0)) / t.total}%;background:${t.color}"></i></div></a>`)}</div>`
    : html`<div class="card empty">No stops scheduled today. <a href="#/customers">Add customers and routes</a> to get started.</div>`}
  <h2>Needs attention</h2>
  ${d.attention.length ? html`<div class="card">${d.attention.map((a) => html`<div class="finding">
      <a href="#/customers/${a.customer_id}"><b>${a.customer_name}</b></a><span class="muted small">${a.pool_name} · ${fmtDate(a.date)}</span>
      <span class="dose row" style="gap:6px;justify-content:flex-end">${a.issues.map((i) => html`<span class="badge ${i.status === 'low' ? 'warn' : 'bad'}">${i.label} ${i.status} (${i.value})</span>`)}</span></div>`)}</div>`
    : html`<div class="card empty">All recent water tests look good. 🎉</div>`}`;
};

// ---------- Route (daily schedule) ----------
let routeDate = localISO();
let routeTech = sessionStorage.getItem('routeTech') || '';
actions.day = ({ d }) => { routeDate = d === 'today' ? localISO() : addDays(routeDate, Number(d)); render(); };
live.routeDate = (e) => { if (e.target.value) { routeDate = e.target.value; render(); } };
live.routeTech = (e) => { routeTech = e.target.value; sessionStorage.setItem('routeTech', routeTech); render(); };

views.route = async () => {
  const [ts, stops] = await Promise.all([techs(), GET(`/day/${routeDate}${routeTech ? '?tech_id=' + routeTech : ''}`)]);
  const done = stops.filter((s) => s.status !== 'scheduled').length;
  const groups = new Map();
  stops.forEach((s) => { const k = s.tech_name || 'Unassigned'; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(s); });
  return html`<div class="row spread"><h1 style="margin:0">Route</h1>
    <button class="btn primary noprint" data-act="addStop">+ One-off stop</button></div>
  <div class="row mt noprint">
    <button class="btn" data-act="day" data-d="-1" aria-label="Previous day">‹</button>
    <input type="date" value="${routeDate}" style="width:auto" data-live="routeDate">
    <button class="btn" data-act="day" data-d="1" aria-label="Next day">›</button>
    <button class="btn" data-act="day" data-d="today">Today</button>
    <span class="grow"></span>
    <select style="width:auto" data-live="routeTech">${techOptions(ts, 'All technicians').map(([k, l]) => html`<option value="${k}" ${raw(String(k) === routeTech ? 'selected' : '')}>${l}</option>`)}</select>
  </div>
  <p class="muted"><b>${fmtDate(routeDate, { weekday: 'long', month: 'long', day: 'numeric' })}</b> — ${done} of ${stops.length} stops complete</p>
  ${stops.length ? [...groups].map(([name, list]) => html`<h2 class="row"><span class="dot" style="background:${list[0].tech_color || '#94a3b8'}"></span>${name} <span class="muted small">${list.length} ${list.length === 1 ? "stop" : "stops"}</span></h2>
    ${list.map((s, i) => html`<div class="card stop ${s.status === 'done' ? 'done' : ''}" style="border-left-color:${s.tech_color || 'var(--line)'};margin-bottom:8px">
      <div class="num">${s.status === 'done' ? '✓' : i + 1}</div>
      <a href="#/visit/${s.id}" class="grow" style="color:inherit;text-decoration:none">
        <b>${s.customer_name}</b> <span class="muted small">${s.pool_name}${s.volume_gal ? ' · ' + s.volume_gal.toLocaleString() + ' gal' : ''}</span><br>
        <span class="small muted">${s.address}, ${s.city}${s.gate_code ? ' · gate ' + s.gate_code : ''}</span></a>
      ${s.status === 'skipped' ? raw('<span class="badge warn">Skipped</span>') : s.status === 'done' ? raw('<span class="badge ok">Done</span>') : ''}
      <span class="row noprint" style="gap:4px">
        <a class="btn sm" target="_blank" rel="noopener" href="https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(s.address + ', ' + s.city)}" title="Navigate">📍</a>
        <button class="btn sm" data-act="move" data-id="${s.id}" data-dir="-1" ${raw(i === 0 ? 'disabled' : '')} aria-label="Move up">↑</button>
        <button class="btn sm" data-act="move" data-id="${s.id}" data-dir="1" ${raw(i === list.length - 1 ? 'disabled' : '')} aria-label="Move down">↓</button>
      </span></div>`)}`)
    : html`<div class="card empty">Nothing scheduled for this day.</div>`}`;
};
actions.move = async ({ id, dir }) => {
  const stops = await GET(`/day/${routeDate}`);
  const me = stops.find((s) => s.id == id);
  const list = stops.filter((s) => s.tech_id === me.tech_id);
  const i = list.indexOf(me), j = i + Number(dir);
  if (j < 0 || j >= list.length) return;
  list.splice(j, 0, list.splice(i, 1)[0]);
  // renumber today's visits and the recurring stops so the order sticks next week too
  await Promise.all(list.flatMap((s, n) => [PUT(`/visits/${s.id}`, { position: (n + 1) * 10 }), s.stop_id ? PUT(`/stops/${s.stop_id}`, { position: (n + 1) * 10 }) : null]));
  render();
};
actions.addStop = async () => {
  const [pools, ts] = await Promise.all([GET('/pools'), techs()]);
  if (!pools.length) return toast('Add a customer and pool first', true);
  openForm({
    title: 'Add one-off stop', saveLabel: 'Add to ' + fmtDate(routeDate), values: { date: routeDate },
    fields: [{ name: 'pool_id', label: 'Pool', type: 'select', int: true, full: true, options: pools.map((p) => [p.id, `${p.customer_name} — ${p.name}`]) },
      { name: 'tech_id', label: 'Technician', type: 'select', int: true, options: techOptions(ts) }, { name: 'date', label: 'Date', type: 'date' }],
    onSave: (d) => POST('/visits', d),
  });
};

// ---------- Visit (tech view) ----------
const TASKS = ['Skim surface', 'Brush walls & steps', 'Vacuum', 'Empty baskets', 'Clean filter', 'Backwash', 'Check equipment', 'Test water'];
const READINGS = [['fc', 'Free Cl', 0.5], ['ph', 'pH', 0.1], ['ta', 'Alkalinity', 5], ['cya', 'Stabilizer', 5], ['ch', 'Calcium', 10], ['salt', 'Salt', 100], ['temp', 'Temp °F', 1]];

const chemRow = (c = {}) => html`<div class="chem"><input placeholder="Chemical" data-c="name" value="${c.name}"><input placeholder="Qty" inputmode="decimal" data-c="qty" value="${c.qty}">
  <input placeholder="Unit" data-c="unit" value="${c.unit}"><input placeholder="$ charge" inputmode="decimal" data-c="charge" value="${c.charge}"><button type="button" class="btn sm" data-act="rmChem" aria-label="Remove">✕</button></div>`;
const findingsHtml = (volume, r) => {
  const list = Dosing.analyze(volume, r);
  if (!list.length) return html`<p class="muted small">Enter readings to see dosing guidance.</p>`;
  return html`${list.map((f) => html`<div class="finding"><span class="badge ${f.status === 'ok' ? 'ok' : f.status === 'low' ? 'warn' : 'bad'}">${f.status.toUpperCase()}</span>
    <span><b>${f.label}</b> ${f.value}${f.unit ? ' ' + f.unit : ''}<br><span class="muted small">${f.message}</span></span>
    ${f.dose ? html`<span class="dose">${f.dose.text}<br><span class="muted small" style="font-weight:400">${f.dose.product}</span></span>` : ''}</div>`)}
    <p class="muted small mt">Estimates for ${Number(volume).toLocaleString()} gal. Add chemicals in stages, circulate, and retest.</p>`;
};
const collectReadings = (root) => Object.fromEntries(READINGS.map(([k]) => [k, num($(`[name=${k}]`, root)?.value)]));

views.visit = async (id) => {
  const [v, ts] = await Promise.all([GET('/visits/' + id), techs()]);
  const locked = !!v.invoice_id;
  const prev = v.previous;
  const lowDose = (k) => (prev && prev[k] != null ? `last: ${prev[k]}` : '');
  return html`<p class="small"><a href="#/route">‹ Back to route</a></p>
  <div class="row spread"><div><h1 style="margin:0">${v.customer_name}</h1>
    <div class="muted">${v.pool_name} · ${v.volume_gal?.toLocaleString()} gal · ${fmtDate(v.date)}</div></div>
    <span class="badge ${v.status === 'done' ? 'ok' : v.status === 'skipped' ? 'warn' : ''}">${v.status}${locked ? ' · invoiced' : ''}</span></div>
  <div class="card mt small">
    <div>📍 <a target="_blank" rel="noopener" href="https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(v.address + ', ' + v.city)}">${v.address}, ${v.city}</a>
      ${v.phone ? html` · <a href="tel:${v.phone}">${v.phone}</a>` : ''} ${v.gate_code ? html` · Gate <b>${v.gate_code}</b>` : ''}</div>
    ${v.customer_notes ? html`<div class="mt">⚠️ ${v.customer_notes}</div>` : ''}${v.pool_notes ? html`<div>🔧 ${v.pool_notes}</div>` : ''}
  </div>
  <form id="vform" data-id="${v.id}" data-volume="${v.volume_gal}">
  <h2>Water chemistry</h2>
  <div class="card" data-live="readings"><div class="reading">${READINGS.map(([k, l, step]) => html`<label>${l}<input name="${k}" type="number" inputmode="decimal" step="${step}" value="${v[k]}" ${raw(locked ? 'disabled' : '')}>
    <div class="hint" id="hint-${k}">${lowDose(k)}</div></label>`)}</div></div>
  <div class="card mt" id="findings">${findingsHtml(v.volume_gal, v)}</div>
  <h2>Tasks</h2>
  <div class="card tasks">${TASKS.map((t) => html`<label class="check"><input type="checkbox" name="task" value="${t}" ${raw(v.tasks.includes(t) ? 'checked' : '')}> ${t}</label>`)}</div>
  <h2>Chemicals added</h2>
  <div class="card"><div id="chems">${(v.chemicals.length ? v.chemicals : []).map(chemRow)}</div>
    <button type="button" class="btn sm" data-act="addChem">+ Add chemical</button> <span class="muted small">Charges are added to the invoice.</span></div>
  <h2>Notes & billing</h2>
  <div class="card fields"><label class="full">Notes<textarea name="notes" rows="3" placeholder="Equipment issues, observations…">${v.notes}</textarea></label>
    <label>Technician<select name="tech_id">${techOptions(ts).map(([k, l]) => html`<option value="${k}" ${raw(String(k) === String(v.tech_id ?? '') ? 'selected' : '')}>${l}</option>`)}</select></label>
    <label>Visit price<input name="price" type="number" step="0.01" value="${v.price}" ${raw(locked ? 'disabled' : '')}></label></div>
  <div class="row mt noprint">
    ${v.status === 'done' ? html`<button type="button" class="btn big primary" data-act="saveVisit" data-status="done">Save changes</button><button type="button" class="btn" data-act="saveVisit" data-status="scheduled" ${raw(locked ? 'disabled' : '')}>Re-open</button>`
      : html`<button type="button" class="btn big primary" data-act="saveVisit" data-status="done">✓ Complete visit</button><button type="button" class="btn" data-act="saveVisit" data-status="scheduled">Save draft</button><button type="button" class="btn" data-act="saveVisit" data-status="skipped">Skip stop</button>`}
    <span class="grow"></span><button type="button" class="btn danger" data-act="delVisit" data-id="${v.id}" ${raw(locked ? 'disabled' : '')}>Delete</button>
  </div></form>
  <div class="row small muted mt noprint">Need a repair? <a href="#" data-act="newWO" data-pool="${v.pool_id}">Create a work order for this pool</a></div>`;
};
live.readings = (e) => {
  const form = e.target.closest('form');
  const r = collectReadings(form);
  $('#findings').innerHTML = findingsHtml(form.dataset.volume, r).s;
};
actions.addChem = () => $('#chems').insertAdjacentHTML('beforeend', chemRow().s);
actions.rmChem = (_, el) => el.closest('.chem').remove();
actions.saveVisit = async ({ status }) => {
  const f = $('#vform');
  const body = {
    status, ...collectReadings(f), notes: f.notes.value, tech_id: f.tech_id.value === '' ? null : Number(f.tech_id.value),
    tasks: [...f.querySelectorAll('[name=task]:checked')].map((c) => c.value),
    chemicals: [...f.querySelectorAll('.chem')].map((r) => Object.fromEntries([...r.querySelectorAll('[data-c]')].map((i) => [i.dataset.c, i.dataset.c === 'name' || i.dataset.c === 'unit' ? i.value.trim() : i.value.trim() === '' ? '' : Number(i.value)]))).filter((c) => c.name),
  };
  if (!f.price.disabled) body.price = num(f.price.value) ?? 0;
  if (f.ph.disabled) for (const k of [...READINGS.map((r) => r[0]), 'price', 'status']) delete body[k]; // invoiced: only notes/tech editable
  if (status === 'done' && !body.tasks.length && !confirm('No tasks checked. Complete the visit anyway?')) return;
  await PUT('/visits/' + f.dataset.id, body);
  toast(status === 'done' ? 'Visit completed' : status === 'skipped' ? 'Stop skipped' : 'Saved');
  if (status !== 'scheduled') location.hash = '#/route'; else render();
};
actions.delVisit = async ({ id }) => { if (confirm('Delete this visit?')) { await DEL('/visits/' + id); location.hash = '#/route'; } };

// ---------- Customers ----------
const CUSTOMER_FIELDS = [
  { name: 'name', label: 'Name', required: true, full: true }, { name: 'phone', label: 'Phone', type: 'tel' }, { name: 'email', label: 'Email', type: 'email' },
  { name: 'address', label: 'Address', full: true }, { name: 'city', label: 'City' }, { name: 'gate_code', label: 'Gate / access code' },
  { name: 'rate', label: 'Price per visit ($)', type: 'number', step: '0.01' }, { name: 'notes', label: 'Notes (dogs, access…)', type: 'textarea', full: true },
];
const customerList = async () => {
  const list = await GET('/customers');
  return html`<div class="row spread"><h1 style="margin:0">Customers</h1><button class="btn primary" data-act="newCustomer">+ Add customer</button></div>
  <div class="mt"><input type="search" placeholder="Search customers…" data-filter="#custtable tbody tr"></div>
  ${list.length ? html`<div class="card mt" style="padding:0;overflow-x:auto"><table id="custtable"><thead><tr><th>Name</th><th class="hide-sm">Address</th><th>Pools</th><th class="right">Rate</th><th class="right">Balance</th></tr></thead><tbody>
    ${list.map((c) => html`<tr class="click" data-href="#/customers/${c.id}"><td><b>${c.name}</b></td><td class="hide-sm muted">${c.address}${c.city ? ', ' + c.city : ''}</td><td>${c.pools}</td><td class="right">${money(c.rate)}</td>
      <td class="right">${c.balance ? html`<span class="badge warn">${money(c.balance)}</span>` : html`<span class="muted">—</span>`}</td></tr>`)}</tbody></table></div>`
    : html`<div class="card empty mt">No customers yet. Add your first one to start building routes.</div>`}`;
};
actions.newCustomer = () => openForm({ title: 'New customer', fields: CUSTOMER_FIELDS, values: { rate: 120 }, onSave: async (d) => { const c = await POST('/customers', d); location.hash = '#/customers/' + c.id; } });
actions.editCustomer = async ({ id }) => openForm({ title: 'Edit customer', fields: CUSTOMER_FIELDS, values: await GET('/customers/' + id), onSave: (d) => PUT('/customers/' + id, d),
  onDelete: async () => { await DEL('/customers/' + id); location.hash = '#/customers'; } });

const POOL_FIELDS = [
  { name: 'name', label: 'Name', default: 'Pool' }, { name: 'type', label: 'Type', type: 'select', options: ['Pool', 'Pool & spa', 'Spa', 'Water feature', 'Lap pool'].map((x) => [x, x]) },
  { name: 'volume_gal', label: 'Volume (gal)', type: 'number' }, { name: 'surface', label: 'Surface', type: 'select', options: ['Plaster', 'Pebble', 'Vinyl', 'Fiberglass', 'Tile'].map((x) => [x, x]) },
  { name: 'sanitizer', label: 'Sanitizer', type: 'select', options: ['Chlorine', 'Salt', 'Bromine', 'Mineral'].map((x) => [x, x]) },
  { name: 'notes', label: 'Equipment & notes', type: 'textarea', full: true },
];
actions.newPool = ({ cid }) => openForm({ title: 'Add pool', fields: POOL_FIELDS, values: { volume_gal: 15000 }, onSave: (d) => POST('/pools', { ...d, customer_id: Number(cid) }) });
actions.editPool = async ({ id }) => openForm({ title: 'Edit pool', fields: POOL_FIELDS, values: await GET('/pools/' + id), onSave: (d) => PUT('/pools/' + id, d), onDelete: () => DEL('/pools/' + id) });

const stopFields = (ts) => [
  { name: 'weekday', label: 'Day of week', type: 'select', int: true, options: WEEKDAYS.map((d, i) => [i, d]) },
  { name: 'frequency', label: 'Repeats', type: 'select', int: true, options: [[1, 'Every week'], [2, 'Every 2 weeks'], [3, 'Every 3 weeks'], [4, 'Every 4 weeks']] },
  { name: 'tech_id', label: 'Technician', type: 'select', int: true, options: techOptions(ts) }, { name: 'start_date', label: 'Starting', type: 'date', required: true },
  { name: 'active', label: 'Active', type: 'checkbox' },
];
actions.newStop = async ({ pool }) => openForm({ title: 'Add to route', fields: stopFields(await techs()), values: { weekday: new Date().getDay() || 1, frequency: 1, active: 1, start_date: localISO() }, onSave: (d) => POST('/stops', { ...d, pool_id: Number(pool) }) });
actions.editStop = async ({ id }) => openForm({ title: 'Edit route stop', fields: stopFields(await techs()), values: await GET('/stops/' + id), onSave: (d) => PUT('/stops/' + id, d), onDelete: () => DEL('/stops/' + id) });

views.customers = async (id) => {
  if (!id) return customerList();
  const c = await GET('/customers/' + id);
  return html`<p class="small"><a href="#/customers">‹ Customers</a></p>
  <div class="row spread"><h1 style="margin:0">${c.name}</h1><button class="btn" data-act="editCustomer" data-id="${c.id}">Edit</button></div>
  <div class="card mt small">
    <div>📍 ${c.address}${c.city ? ', ' + c.city : ''} ${c.gate_code ? html`· Gate <b>${c.gate_code}</b>` : ''}</div>
    <div>${c.phone ? html`📞 <a href="tel:${c.phone}">${c.phone}</a>` : ''} ${c.email ? html`· ✉️ <a href="mailto:${c.email}">${c.email}</a>` : ''} · ${money(c.rate)}/visit</div>
    ${c.notes ? html`<div class="mt">⚠️ ${c.notes}</div>` : ''}</div>
  <div class="row spread"><h2>Pools & route</h2><button class="btn sm" data-act="newPool" data-cid="${c.id}">+ Add pool</button></div>
  ${c.pools.length ? c.pools.map((p) => html`<div class="card" style="margin-bottom:10px">
    <div class="row spread"><div><b>${p.name}</b> <span class="muted small">${p.type} · ${p.volume_gal?.toLocaleString()} gal · ${p.surface} · ${p.sanitizer}</span></div>
      <span class="row"><button class="btn sm" data-act="editPool" data-id="${p.id}">Edit</button><button class="btn sm" data-act="newStop" data-pool="${p.id}">+ Route stop</button></span></div>
    ${p.notes ? html`<div class="muted small mt">🔧 ${p.notes}</div>` : ''}
    ${p.stops.length ? html`<div class="row mt">${p.stops.map((s) => html`<button class="btn sm ${s.active ? '' : 'danger'}" data-act="editStop" data-id="${s.id}">${WEEKDAYS[s.weekday].slice(0, 3)}${s.frequency > 1 ? ` / ${s.frequency}wk` : ''} · ${s.tech_name || 'Unassigned'}${s.active ? '' : ' (paused)'}</button>`)}</div>`
      : html`<div class="muted small mt">Not on a route yet.</div>`}</div>`)
    : html`<div class="card empty">Add a pool, then put it on a route.</div>`}
  <div class="row spread"><h2>Billing</h2>
    <button class="btn sm primary" data-act="genInvoice" data-cid="${c.id}" ${raw(c.unbilled ? '' : 'disabled')}>Invoice unbilled work (${money(c.unbilled)})</button></div>
  ${c.invoices.length ? html`<div class="card" style="padding:0"><table><tbody>${c.invoices.map((i) => html`<tr class="click" data-href="#/invoices/${i.id}"><td>#${i.id}</td><td>${fmtDate(i.issued)}</td>
    <td>${money(i.total)}</td><td><span class="badge ${i.status === 'paid' ? 'ok' : i.due < localISO() ? 'bad' : 'warn'}">${i.status === 'open' && i.due < localISO() ? 'overdue' : i.status}</span></td></tr>`)}</tbody></table></div>`
    : html`<div class="muted small">No invoices yet.</div>`}
  ${c.work_orders.length ? html`<h2>Work orders</h2><div class="card" style="padding:0"><table><tbody>${c.work_orders.map((w) => html`<tr><td><b>${w.title}</b><br><span class="muted small">${w.pool_name}</span></td><td>${money(w.price)}</td><td><span class="badge ${w.status === 'done' ? 'ok' : ''}">${w.status}</span></td></tr>`)}</tbody></table></div>` : ''}
  <h2>Service history</h2>
  ${c.visits.length ? html`<div class="card" style="padding:0;overflow-x:auto"><table><thead><tr><th>Date</th><th>Tech</th><th>Cl</th><th>pH</th><th>TA</th><th>CYA</th><th>Status</th></tr></thead><tbody>
    ${c.visits.map((v) => { const bad = new Set(Dosing.issues(v.volume_gal, v).map((i) => i.key)); const cell = (k) => html`<td ${raw(bad.has(k) ? 'style="color:var(--bad);font-weight:700"' : '')}>${v[k] ?? '—'}</td>`;
      return html`<tr class="click" data-href="#/visit/${v.id}"><td>${fmtDate(v.date)}</td><td>${v.tech_name || '—'}</td>${cell('fc')}${cell('ph')}${cell('ta')}${cell('cya')}<td><span class="badge ${v.status === 'done' ? 'ok' : 'warn'}">${v.status}</span></td></tr>`; })}</tbody></table></div>`
    : html`<div class="muted small">No completed visits yet.</div>`}`;
};
actions.genInvoice = async ({ cid }) => { const inv = await POST('/invoices/generate', { customer_id: Number(cid) }); toast('Invoice #' + inv.id + ' created'); location.hash = '#/invoices/' + inv.id; };

// ---------- Work orders ----------
let woFilter = '';
live.woFilter = (e) => { woFilter = e.target.value; render(); };
const woFields = (pools, ts) => [
  { name: 'pool_id', label: 'Pool', type: 'select', int: true, full: true, options: pools.map((p) => [p.id, `${p.customer_name} — ${p.name}`]) },
  { name: 'title', label: 'Title', required: true, full: true }, { name: 'description', label: 'Details', type: 'textarea', full: true },
  { name: 'price', label: 'Price ($)', type: 'number', step: '0.01' }, { name: 'due_date', label: 'Due', type: 'date', nullable: true },
  { name: 'tech_id', label: 'Technician', type: 'select', int: true, options: techOptions(ts) },
  { name: 'status', label: 'Status', type: 'select', options: [['open', 'Open'], ['scheduled', 'Scheduled'], ['done', 'Done']] },
];
views.workorders = async () => {
  const list = await GET('/work-orders' + (woFilter ? '?status=' + woFilter : ''));
  return html`<div class="row spread"><h1 style="margin:0">Work orders</h1><div class="row">
    <select style="width:auto" data-live="woFilter">${[['', 'All'], ['open', 'Open'], ['scheduled', 'Scheduled'], ['done', 'Done']].map(([k, l]) => html`<option value="${k}" ${raw(k === woFilter ? 'selected' : '')}>${l}</option>`)}</select>
    <button class="btn primary" data-act="newWO">+ New</button></div></div>
  ${list.length ? html`<div class="mt">${list.map((w) => html`<div class="card" style="margin-bottom:8px"><div class="row spread">
    <div><b>${w.title}</b> <span class="badge ${w.status === 'done' ? 'ok' : w.status === 'scheduled' ? 'warn' : ''}">${w.status}${w.invoice_id ? ' · invoiced' : ''}</span><br>
      <a href="#/customers/${w.customer_id}">${w.customer_name}</a> <span class="muted small">· ${w.pool_name}${w.tech_name ? ' · ' + w.tech_name : ''}${w.due_date ? ' · due ' + fmtDate(w.due_date) : ''}</span>
      ${w.description ? html`<div class="muted small">${w.description}</div>` : ''}</div>
    <div class="row"><b>${money(w.price)}</b>
      ${w.status !== 'done' ? html`<button class="btn sm primary" data-act="woDone" data-id="${w.id}">Mark done</button>` : ''}
      <button class="btn sm" data-act="editWO" data-id="${w.id}">Edit</button></div></div></div>`)}</div>`
    : html`<div class="card empty mt">No work orders${woFilter ? ' with that status' : ''}.</div>`}`;
};
actions.newWO = async ({ pool } = {}) => {
  const [pools, ts] = await Promise.all([GET('/pools'), techs()]);
  if (!pools.length) return toast('Add a customer and pool first', true);
  openForm({ title: 'New work order', fields: woFields(pools, ts), values: { pool_id: pool || pools[0].id, status: 'open', price: 0 }, onSave: (d) => POST('/work-orders', d) });
};
actions.editWO = async ({ id }) => {
  const [pools, ts, w] = await Promise.all([GET('/pools'), techs(), GET('/work-orders')]);
  const cur = w.find((x) => x.id == id);
  openForm({ title: 'Edit work order', fields: woFields(pools, ts), values: cur,
    onSave: (d) => { if (cur.invoice_id) { delete d.price; delete d.status; } return PUT('/work-orders/' + id, d); }, onDelete: () => DEL('/work-orders/' + id) });
};
actions.woDone = async ({ id }) => { await PUT('/work-orders/' + id, { status: 'done' }); toast('Marked done — ready to invoice'); render(); };

// ---------- Invoices ----------
let invFilter = '';
live.invFilter = (e) => { invFilter = e.target.value; render(); };
views.invoices = async (id) => {
  if (id) {
    const i = await GET('/invoices/' + id);
    const overdue = i.status === 'open' && i.due < localISO();
    return html`<p class="small noprint"><a href="#/invoices">‹ Invoices</a></p>
    <div class="invoice card"><div class="row spread"><div><h1 style="margin:0">Invoice #${i.id}</h1><span class="badge ${i.status === 'paid' ? 'ok' : overdue ? 'bad' : 'warn'}">${overdue ? 'overdue' : i.status}</span></div>
      <div class="right small muted">Issued ${fmtDate(i.issued)}<br>Due ${fmtDate(i.due)}</div></div>
      <p class="mt"><b>Bill to</b><br>${i.customer_name}<br><span class="muted">${i.address}${i.city ? ', ' + i.city : ''}</span></p>
      <table><thead><tr><th>Description</th><th class="right">Qty</th><th class="right">Price</th><th class="right">Amount</th></tr></thead><tbody>
      ${i.items.map((x) => html`<tr><td>${x.desc}</td><td class="right">${x.qty}</td><td class="right">${money(x.price)}</td><td class="right">${money(x.qty * x.price)}</td></tr>`)}
      <tr><td colspan="3" class="right"><b>Total</b></td><td class="right"><b style="font-size:18px">${money(i.total)}</b></td></tr></tbody></table>
      ${i.status === 'paid' ? html`<p class="mt" style="color:var(--ok)"><b>Paid ${fmtDate(i.paid_at)}</b>${i.method ? ' by ' + i.method : ''}</p>` : ''}
      <div class="row mt noprint">
        ${i.status === 'open' ? html`<button class="btn primary" data-act="payInvoice" data-id="${i.id}">Record payment</button>` : html`<button class="btn" data-act="reopenInvoice" data-id="${i.id}">Mark unpaid</button>`}
        <button class="btn" data-act="print">Print / PDF</button>
        ${i.email ? html`<a class="btn" href="mailto:${i.email}?subject=${encodeURIComponent('Invoice #' + i.id)}&body=${encodeURIComponent('Hi ' + i.customer_name + ',\n\nYour pool service invoice #' + i.id + ' for ' + money(i.total) + ' is due ' + i.due + '.\n\nThank you!')}">Email</a>` : ''}
        <span class="grow"></span><button class="btn danger" data-act="voidInvoice" data-id="${i.id}">Void</button></div></div>`;
  }
  const [list, custs] = await Promise.all([GET('/invoices' + (invFilter ? '?status=' + invFilter : '')), GET('/customers')]);
  const today = localISO();
  return html`<div class="row spread"><h1 style="margin:0">Invoices</h1><div class="row">
    <select style="width:auto" data-live="invFilter">${[['', 'All'], ['open', 'Unpaid'], ['paid', 'Paid']].map(([k, l]) => html`<option value="${k}" ${raw(k === invFilter ? 'selected' : '')}>${l}</option>`)}</select>
    <button class="btn primary" data-act="invoiceAll">Bill all customers</button></div></div>
  <p class="muted small">${custs.length} customers · "Bill all" creates one invoice per customer with unbilled completed work.</p>
  ${list.length ? html`<div class="card" style="padding:0;overflow-x:auto"><table><thead><tr><th>#</th><th>Customer</th><th class="hide-sm">Issued</th><th class="hide-sm">Due</th><th class="right">Total</th><th>Status</th></tr></thead><tbody>
    ${list.map((i) => html`<tr class="click" data-href="#/invoices/${i.id}"><td>${i.id}</td><td><b>${i.customer_name}</b></td><td class="hide-sm">${fmtDate(i.issued)}</td><td class="hide-sm">${fmtDate(i.due)}</td><td class="right">${money(i.total)}</td>
      <td><span class="badge ${i.status === 'paid' ? 'ok' : i.due < today ? 'bad' : 'warn'}">${i.status === 'open' && i.due < today ? 'overdue' : i.status}</span></td></tr>`)}</tbody></table></div>`
    : html`<div class="card empty">No invoices yet. Complete some visits, then bill them from a customer page.</div>`}`;
};
actions.print = () => window.print();
actions.payInvoice = async ({ id }) => {
  openForm({ title: 'Record payment', saveLabel: 'Mark paid', values: { paid_at: localISO(), method: 'Card' },
    fields: [{ name: 'paid_at', label: 'Date', type: 'date' }, { name: 'method', label: 'Method', type: 'select', options: ['Card', 'Check', 'Cash', 'ACH / bank', 'Other'].map((x) => [x, x]) }],
    onSave: (d) => POST(`/invoices/${id}/pay`, d) });
};
actions.reopenInvoice = async ({ id }) => { await POST(`/invoices/${id}/reopen`); render(); };
actions.voidInvoice = async ({ id }) => { if (confirm('Void this invoice? Its visits and work orders become unbilled again.')) { await DEL('/invoices/' + id); location.hash = '#/invoices'; } };
actions.invoiceAll = async () => {
  const custs = await GET('/customers'); let n = 0;
  for (const c of custs) { try { await POST('/invoices/generate', { customer_id: c.id }); n++; } catch { /* nothing to bill */ } }
  toast(n ? `Created ${n} invoice${n > 1 ? 's' : ''}` : 'Nothing to invoice', !n); render();
};

// ---------- Dosing calculator ----------
views.dose = async () => html`<h1>Dosing calculator</h1>
  <p class="muted">Enter a pool's volume and test results to get chemical amounts. Guidance only — add in stages and retest.</p>
  <form id="dform" class="card" data-live="dosecalc"><div class="reading">
    <label>Volume (gal)<input name="volume" type="number" value="15000" inputmode="numeric"></label>
    ${READINGS.filter(([k]) => k !== 'temp').map(([k, l, step]) => html`<label>${l}<input name="${k}" type="number" step="${step}" inputmode="decimal"></label>`)}</div></form>
  <div class="card mt" id="dresult"><p class="muted small">Enter readings to see results.</p></div>`;
live.dosecalc = (e) => {
  const f = e.target.closest('form');
  $('#dresult').innerHTML = findingsHtml(f.volume.value || 0, collectReadings(f)).s;
};

// ---------- Team ----------
const TECH_FIELDS = [{ name: 'name', label: 'Name', required: true, full: true }, { name: 'phone', label: 'Phone', type: 'tel' }, { name: 'color', label: 'Route color', type: 'color' }];
views.team = async () => {
  const ts = await techs();
  return html`<div class="row spread"><h1 style="margin:0">Team</h1><button class="btn primary" data-act="newTech">+ Add technician</button></div>
  ${ts.length ? html`<div class="grid mt">${ts.map((t) => html`<div class="card row spread"><div class="row"><span class="dot" style="background:${t.color};width:16px;height:16px"></span><div><b>${t.name}</b><br><span class="muted small">${t.phone || 'No phone'}</span></div></div>
    <button class="btn sm" data-act="editTech" data-id="${t.id}">Edit</button></div>`)}</div>`
    : html`<div class="card empty mt">Add your technicians, then assign them to route stops.</div>`}`;
};
actions.newTech = () => openForm({ title: 'New technician', fields: TECH_FIELDS, values: { color: '#0ea5e9' }, onSave: (d) => POST('/techs', d) });
actions.editTech = async ({ id }) => openForm({ title: 'Edit technician', fields: TECH_FIELDS, values: await GET('/techs/' + id), onSave: (d) => PUT('/techs/' + id, d), onDelete: () => DEL('/techs/' + id) });

render();
