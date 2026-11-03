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


// ---------- icons, nav, page chrome ----------
const ICONS = {
  grid: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
  route: '<circle cx="6" cy="19" r="2.5"/><circle cx="18" cy="5" r="2.5"/><path d="M8.5 19H15a3.5 3.5 0 0 0 0-7H9a3.5 3.5 0 0 1 0-7h6.5"/>',
  columns: '<rect x="3" y="3" width="18" height="18" rx="2.5"/><path d="M9 3v18M15 3v18"/>',
  users: '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8"/>',
  wrench: '<path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.8-3.8a6 6 0 0 1-7.9 7.9l-6.9 6.9a2.1 2.1 0 0 1-3-3l6.9-6.9a6 6 0 0 1 7.9-7.9z"/>',
  file: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M8 13h8M8 17h8"/>',
  drop: '<path d="M12 2.7s7 6.6 7 11.3a7 7 0 0 1-14 0C5 9.3 12 2.7 12 2.7z"/>',
  badge: '<path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="8.5" cy="7" r="4"/><path d="M17 11l2 2 4-4"/>',
  sliders: '<path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6"/>',
  check: '<path d="M22 11.1V12a10 10 0 1 1-5.9-9.1"/><path d="M22 4 12 14l-3-3"/>',
  dollar: '<path d="M12 1v22M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>',
  alert: '<path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0zM12 9v4M12 17h.01"/>',
  clock: '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>',
  zap: '<path d="M13 2 3 14h9l-1 8 10-12h-9z"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  pin: '<path d="M21 10c0 7-9 13-9 13S3 17 3 10a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/>',
  trend: '<path d="M23 6l-9.5 9.5-5-5L1 18"/><path d="M17 6h6v6"/>',
  wave: '<path d="M3 16c3-3 5-3 8 0s5 3 8 0M3 9c3-3 5-3 8 0s5 3 8 0"/>',
};
const icon = (n) => raw(`<svg class="i" viewBox="0 0 24 24" aria-hidden="true">${ICONS[n] || ''}</svg>`);
const NAV = [
  ['Operations', [['dashboard', 'Dashboard', 'grid'], ['route', 'Daily route', 'route'], ['builder', 'Route builder', 'columns']]],
  ['Business', [['customers', 'Customers', 'users'], ['workorders', 'Work orders', 'wrench'], ['invoices', 'Invoices', 'file']]],
  ['Tools', [['dose', 'Dosing', 'drop'], ['team', 'Team', 'badge'], ['settings', 'Settings', 'sliders']]],
];
$('#nav').innerHTML = html`<a class="brand" href="#/dashboard"><span class="logo">${icon('wave')}</span><span>SplashDesk<small>Pool service</small></span></a>
  ${NAV.map(([sec, items]) => html`<div class="sec">${sec}</div>${items.map(([k, l, ic]) => html`<a class="item" href="#/${k}" data-nav="${k}">${icon(ic)}<span>${l}</span></a>`)}`)}
  <div class="foot"><b>Pro tip</b>Drag pools onto days in the Route builder, then hit Optimize to cut drive time.</div>`.s;

const pageHead = (title, sub, actions = '') => html`<div class="page-head"><div><h1>${title}</h1>${sub ? html`<div class="sub">${sub}</div>` : ''}</div><div class="row noprint">${actions}</div></div>`;
const fmtMi = (n) => (n || 0).toFixed(1) + ' mi';
const fmtMin = (m) => { m = Math.round(m || 0); return m >= 60 ? `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m` : `${m}m`; };

// settings (depot, speeds) are cached; saving them clears the cache
let settingsCache = null;
const settings = async () => settingsCache || (settingsCache = await GET('/settings'));
const depotOf = (s) => (Geo.has({ lat: s.depot_lat, lng: s.depot_lng }) ? { lat: s.depot_lat, lng: s.depot_lng } : null);
const statOpts = (s) => ({ roundTrip: !!s.round_trip, speed: s.speed_mph, serviceMin: s.service_min });
const groupByTech = (stops) => {
  const m = new Map();
  for (const s of stops) { const k = s.tech_id ?? 0; if (!m.has(k)) m.set(k, { key: k, name: s.tech_name || 'Unassigned', color: s.tech_color || '#64748b', stops: [] }); m.get(k).stops.push(s); }
  return [...m.values()];
};
const sumStats = (groups, depot, st) => groups.reduce((a, g) => { const x = Geo.stats(depot, g.stops, statOpts(st)); return { miles: a.miles + x.miles, min: a.min + x.totalMin, drive: a.drive + x.driveMin }; }, { miles: 0, min: 0, drive: 0 });

// Schematic route map: no tile server needed. Numbered stops, direction arrows, shop marker.
function mapSvg(depot, groups, { roundTrip = true } = {}) {
  const all = []; if (depot) all.push(depot);
  groups.forEach((g) => g.stops.forEach((s) => Geo.has(s) && all.push(s)));
  if (!all.length) return html`<div class="map-empty">${icon('pin')}<div class="mt"><b>No map locations yet</b><br>Add coordinates to customers (or use “Locate missing customers” in <a href="#/settings">Settings</a>) to see routes here.</div></div>`;
  const W = 760, H = 440, P = 40, k = Math.cos((all.reduce((a, p) => a + +p.lat, 0) / all.length) * Math.PI / 180);
  const xs = all.map((p) => p.lng * k), ys = all.map((p) => -p.lat);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
  const sc = Math.min((W - 2 * P) / (maxX - minX || 1e-4), (H - 2 * P) / (maxY - minY || 1e-4));
  const ox = (W - (maxX - minX) * sc) / 2, oy = (H - (maxY - minY) * sc) / 2;
  const X = (p) => +(ox + (p.lng * k - minX) * sc).toFixed(1), Y = (p) => +(oy + (-p.lat - minY) * sc).toFixed(1);
  const paths = groups.map((g) => {
    const pts = g.stops.filter(Geo.has); if (!pts.length) return '';
    const seq = (depot ? [depot] : []).concat(pts, roundTrip && depot ? [depot] : []);
    const d = seq.map((p, i) => (i ? 'L' : 'M') + X(p) + ' ' + Y(p)).join(' ');
    const arrows = seq.slice(1).map((b, i) => {
      const a = seq[i], x1 = X(a), y1 = Y(a), x2 = X(b), y2 = Y(b);
      if (Math.hypot(x2 - x1, y2 - y1) < 26) return '';
      return `<path d="M-4.5,-3.6 L4.5,0 L-4.5,3.6z" fill="${esc(g.color)}" transform="translate(${(x1 + x2) / 2},${(y1 + y2) / 2}) rotate(${(Math.atan2(y2 - y1, x2 - x1) * 180) / Math.PI})"/>`;
    }).join('');
    const dots = pts.map((s, i) => `<g><title>${esc(s.title || '')}</title><circle cx="${X(s)}" cy="${Y(s)}" r="11.5" fill="${esc(g.color)}" stroke="#fff" stroke-width="2.2"/><text x="${X(s)}" y="${Y(s)}">${esc(s.label ?? i + 1)}</text></g>`).join('');
    return `<path d="${d}" fill="none" stroke="${esc(g.color)}" stroke-width="2.6" stroke-linejoin="round" stroke-linecap="round" opacity=".8"/>${arrows}${dots}`;
  }).join('');
  const home = depot ? `<g><title>Shop</title><rect x="${X(depot) - 12}" y="${Y(depot) - 12}" width="24" height="24" rx="7" fill="#0a2540" stroke="#fff" stroke-width="2.2"/><path d="M${X(depot) - 6} ${Y(depot) + 1}l6-5.5 6 5.5M${X(depot) - 4} ${Y(depot)}v5.5h8V${Y(depot)}" fill="none" stroke="#67e8f9" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></g>` : '';
  return raw(`<svg class="map" viewBox="0 0 ${W} ${H}" role="img" aria-label="Route map"><defs><pattern id="g" width="40" height="40" patternUnits="userSpaceOnUse"><path d="M40 0H0V40" fill="none" style="stroke:var(--map-grid)" stroke-width="1"/></pattern></defs>
    <rect width="${W}" height="${H}" style="fill:var(--map-bg)"/><rect width="${W}" height="${H}" fill="url(#g)"/>${paths}${home}</svg>`);
}
const legend = (groups, depot, st) => html`<div class="legend">${groups.map((g) => { const x = Geo.stats(depot, g.stops, statOpts(st)); return html`<span><i class="dot" style="background:${g.color}"></i><b>${g.name}</b> <span class="muted">${g.stops.length} ${g.stops.length === 1 ? "stop" : "stops"} · ${fmtMi(x.miles)} · ${fmtMin(x.totalMin)}</span></span>`; })}</div>`;

// Preview → confirm → apply for the optimiser. items: [{label, body}] posted to /routes/optimize.
async function optimizeFlow(items, title) {
  const previews = await Promise.all(items.map((i) => POST('/routes/optimize', { ...i.body, apply: false })));
  const rows = []; let b = 0, a = 0, bm = 0, am = 0, assumed = false, missing = 0;
  previews.forEach((r, k) => {
    assumed ||= r.depot_assumed; missing += r.missing;
    r.groups.filter((g) => g.count >= 2).forEach((g) => { rows.push({ label: items[k].label, ...g }); b += g.before_miles; a += g.after_miles; bm += g.before_min; am += g.after_min; });
  });
  if (!rows.length) return toast('Need at least 2 stops to optimize', true);
  const saved = b - a, can = saved > 0.05;
  const message = html`${can ? html`<div class="card" style="background:var(--okbg);border-color:transparent;margin-bottom:12px"><span class="save">Saves ${fmtMi(saved)} (${Math.round((100 * saved) / b)}%)</span> and about <b>${fmtMin(bm - am)}</b> of drive time.</div>`
      : html`<div class="card" style="margin-bottom:12px"><b>Already about as efficient as it gets.</b> No change needed.</div>`}
    <table class="sumtable"><thead><tr><th>Route</th><th>Stops</th><th>Miles</th><th>Time</th></tr></thead><tbody>${rows.map((g) => html`<tr><td><b>${g.tech_name}</b>${items.length > 1 ? html`<br><span class="muted small">${g.label}</span>` : ''}</td><td>${g.count}</td>
      <td>${g.before_miles.toFixed(1)} → <b>${g.after_miles.toFixed(1)}</b></td><td>${fmtMin(g.before_min)} → <b>${fmtMin(g.after_min)}</b></td></tr>`)}</tbody></table>
    ${assumed ? html`<p class="small muted mt">⚠ No shop location set, so routes start from the middle of the stops. Set it in <a href="#/settings">Settings</a>.</p>` : ''}
    ${missing ? html`<p class="small muted">${missing} stop(s) without a map location stay at the end of the route.</p>` : ''}
    <p class="small muted">Distances use straight-line miles × 1.3 for roads. Time includes service time per stop.</p>`;
  openForm({ title, message, fields: [], saveLabel: can ? 'Apply new order' : 'Close',
    onSave: async () => { if (can) { await Promise.all(items.map((i) => POST('/routes/optimize', { ...i.body, apply: true }))); toast('Route optimized'); } } });
}

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
  if (f.type === 'geobtn') return html`<div class="full"><button type="button" class="btn sm" data-act="geoForm">${icon('pin')} Find map location from address</button></div>`;
  if (f.type === 'checkbox') return html`<label class="check full"><input type="checkbox" name="${f.name}" ${raw(val_ ? 'checked' : '')}> ${f.label}</label>`;
  let input;
  if (f.type === 'select') input = html`<select name="${f.name}">${(f.options || []).map(([k, l]) => html`<option value="${k}" ${raw(String(k) === String(val_) ? 'selected' : '')}>${l}</option>`)}</select>`;
  else if (f.type === 'textarea') input = html`<textarea name="${f.name}" rows="3">${val_}</textarea>`;
  else input = html`<input name="${f.name}" type="${f.type || 'text'}" value="${val_}" ${raw(f.step ? `step="${f.step}"` : '')} ${raw(f.required ? 'required' : '')} ${raw(f.type === 'tel' ? 'inputmode="tel"' : '')}>`;
  return html`<label${raw(cls)}>${f.label}${input}</label>`;
}
function openForm({ title, fields, values = {}, onSave, onDelete, saveLabel = 'Save', message }) {
  modal.innerHTML = html`<form method="dialog" id="mform"><h3 class="dt">${title}</h3>${message ? html`<div class="msg">${message}</div>` : html`<div style="height:12px"></div>`}
    ${fields.length ? html`<div class="fields">${fields.map((f) => fieldHtml(f, values))}</div>` : ''}
    <div class="row spread mt"><div>${onDelete ? raw('<button type="button" class="btn danger" data-m="delete">Delete</button>') : ''}</div>
    <div class="row"><button type="button" class="btn" data-m="cancel">Cancel</button><button class="btn primary">${saveLabel}</button></div></div></form>`.s;
  const form = $('#mform', modal);
  form.onsubmit = guard(async (e) => {
    e.preventDefault();
    const data = {};
    for (const f of fields) {
      if (f.type === 'geobtn') continue;
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
  const h = new Date().getHours();
  const kpi = (cls, ic, n, l) => html`<div class="card kpi ${cls}"><div class="ico">${icon(ic)}</div><div><div class="n">${n}</div><div class="l">${l}</div></div></div>`;
  return html`${pageHead(`${h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening'} 👋`, fmtDate(d.date, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }),
    html`<a class="btn" href="#/builder">${icon('columns')} Route builder</a><button class="btn primary" data-act="optToday">${icon('zap')} Optimize today</button>`)}
  <div class="grid">
    ${kpi('', 'check', `${d.today.done}/${d.today.total}`, `Stops done today · ${pct}%`)}
    ${kpi('warn', 'wrench', d.open_work_orders, 'Open work orders')}
    ${kpi(d.overdue ? 'bad' : '', 'dollar', money(d.outstanding), d.overdue ? `Outstanding · ${money(d.overdue)} overdue` : 'Outstanding invoices')}
    ${kpi('ok', 'trend', money(d.paid_this_month), 'Collected this month')}
  </div>
  <div class="split mt" style="margin-top:20px">
    <div><h2 style="margin-top:6px">Today's routes</h2>
    ${d.today.byTech.length ? html`<div class="card flush">${d.today.byTech.map((t) => html`<a href="#/route" style="color:inherit;text-decoration:none;display:flex;gap:12px;align-items:center;padding:14px 18px;border-bottom:1px solid var(--line)">
      <span class="avatar" style="background:${t.color}">${t.name.split(' ').map((w) => w[0]).join('').slice(0, 2)}</span>
      <div class="grow"><div class="row spread"><b>${t.name}</b><span class="muted small">${t.done || 0} of ${t.total} stops</span></div><div class="bar" style="margin-top:7px"><i style="width:${(100 * (t.done || 0)) / t.total}%;background:${t.color}"></i></div></div></a>`)}</div>`
      : html`<div class="card empty">No stops scheduled today. <a href="#/builder">Build your routes</a> to get started.</div>`}</div>
    <div><h2 style="margin-top:6px">Needs attention</h2>
    ${d.attention.length ? html`<div class="card flush">${d.attention.slice(0, 8).map((a) => html`<div class="finding" style="padding:12px 18px;flex-wrap:wrap"><div><a href="#/customers/${a.customer_id}"><b>${a.customer_name}</b></a><br><span class="muted small">${a.pool_name} · tested ${fmtDate(a.date)}</span></div>
      <span class="dose row" style="gap:6px;justify-content:flex-end">${a.issues.map((i) => html`<span class="badge ${i.status === 'low' ? 'warn' : 'bad'}">${i.label.replace('Total ', '').replace(' (CYA)', '')} ${i.status} · ${i.value}</span>`)}</span></div>`)}</div>`
      : html`<div class="card empty">${icon('check')}<div class="mt">All recent water tests look good.</div></div>`}</div>
  </div>`;
};
actions.optToday = async () => optimizeFlow([{ label: 'Today', body: { date: localISO() } }], 'Optimize today’s routes');

// ---------- Daily route ----------
let routeDate = localISO();
let routeTech = sessionStorage.getItem('routeTech') || '';
actions.day = ({ d }) => { routeDate = d === 'today' ? localISO() : addDays(routeDate, Number(d)); render(); };
live.routeDate = (e) => { if (e.target.value) { routeDate = e.target.value; render(); } };
live.routeTech = (e) => { routeTech = e.target.value; sessionStorage.setItem('routeTech', routeTech); render(); };
actions.optDay = () => optimizeFlow([{ label: fmtDate(routeDate), body: { date: routeDate, ...(routeTech ? { tech_id: Number(routeTech) } : {}) } }], 'Optimize ' + fmtDate(routeDate, { weekday: 'long', month: 'short', day: 'numeric' }));

views.route = async () => {
  const [ts, stops, st] = await Promise.all([techs(), GET(`/day/${routeDate}${routeTech ? '?tech_id=' + routeTech : ''}`), settings()]);
  const depot = depotOf(st), done = stops.filter((s) => s.status !== 'scheduled').length;
  const groups = groupByTech(stops), tot = sumStats(groups, depot, st);
  const mapGroups = groups.map((g) => ({ color: g.color, name: g.name, stops: g.stops.map((s, i) => ({ lat: s.lat, lng: s.lng, label: i + 1, title: s.customer_name })) }));
  return html`${pageHead('Daily route', fmtDate(routeDate, { weekday: 'long', month: 'long', day: 'numeric' }) + ` · ${done} of ${stops.length} stops complete`,
    html`<button class="btn" data-act="optDay" ${raw(stops.length < 2 ? 'disabled' : '')}>${icon('zap')} Optimize</button><button class="btn primary" data-act="addStop">${icon('plus')} One-off stop</button>`)}
  <div class="row noprint" style="margin-bottom:6px">
    <button class="btn icon" data-act="day" data-d="-1" aria-label="Previous day">‹</button>
    <input type="date" value="${routeDate}" style="width:auto" data-live="routeDate">
    <button class="btn icon" data-act="day" data-d="1" aria-label="Next day">›</button>
    <button class="btn" data-act="day" data-d="today">Today</button><span class="grow"></span>
    <select style="width:auto" data-live="routeTech">${techOptions(ts, 'All technicians').map(([k, l]) => html`<option value="${k}" ${raw(String(k) === routeTech ? 'selected' : '')}>${l}</option>`)}</select></div>
  ${stops.length ? html`<div class="split">
    <div>${groups.map((g) => { const x = Geo.stats(depot, g.stops, statOpts(st)); return html`<div class="grouphead"><span class="dot" style="background:${g.color}"></span><h3>${g.name}</h3>
        <span class="chip">${g.stops.length} ${g.stops.length === 1 ? "stop" : "stops"}</span><span class="chip">${icon('route')} ${fmtMi(x.miles)}</span><span class="chip">${icon('clock')} ${fmtMin(x.totalMin)}</span></div>
      ${g.stops.map((s, i) => html`<div class="card stop ${s.status === 'done' ? 'done' : ''}" style="border-left-color:${g.color}">
        <div class="num">${s.status === 'done' ? '✓' : i + 1}</div>
        <a href="#/visit/${s.id}" class="grow" style="color:inherit;text-decoration:none"><b>${s.customer_name}</b> <span class="muted small">${s.pool_name}${s.volume_gal ? ' · ' + s.volume_gal.toLocaleString() + ' gal' : ''}</span><br>
          <span class="small muted">${s.address}, ${s.city}${s.gate_code ? ' · gate ' + s.gate_code : ''}</span></a>
        ${s.status === 'skipped' ? raw('<span class="badge warn">Skipped</span>') : s.status === 'done' ? raw('<span class="badge ok">Done</span>') : ''}
        <span class="row noprint" style="gap:4px;flex-wrap:nowrap">
          <a class="btn sm icon" target="_blank" rel="noopener" href="https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(s.address + ', ' + s.city)}" title="Navigate" aria-label="Navigate">${icon('pin')}</a>
          <button class="btn sm icon" data-act="move" data-id="${s.id}" data-dir="-1" ${raw(i === 0 ? 'disabled' : '')} aria-label="Move up">↑</button>
          <button class="btn sm icon" data-act="move" data-id="${s.id}" data-dir="1" ${raw(i === g.stops.length - 1 ? 'disabled' : '')} aria-label="Move down">↓</button></span></div>`)}`; })}</div>
    <div class="card" style="position:sticky;top:16px"><div class="row spread" style="margin-bottom:12px"><h3>Route map</h3><span class="muted small">${fmtMi(tot.miles)} · ${fmtMin(tot.min)} total</span></div>
      ${mapSvg(depot, mapGroups, { roundTrip: !!st.round_trip })}${legend(groups, depot, st)}</div></div>`
    : html`<div class="card empty mt">Nothing scheduled for this day.</div>`}`;
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

// ---------- Route builder ----------
const BDAYS = [1, 2, 3, 4, 5, 6, 0];
let bTech = sessionStorage.getItem('bTech') || '';
let bDay = new Date().getDay() || 1;
let board = null;
live.bTech = (e) => { bTech = e.target.value; sessionStorage.setItem('bTech', bTech); render(); };
actions.selDay = ({ day }) => { bDay = Number(day); render(); };

views.builder = async () => {
  const [ts, b] = await Promise.all([techs(), GET('/board' + (bTech ? '?tech_id=' + bTech : ''))]);
  board = b;
  const st = b.settings, depot = depotOf(st);
  const byDay = new Map(BDAYS.map((d) => [d, []]));
  b.stops.forEach((s) => byDay.get(s.weekday).push(s));
  const days = BDAYS.filter((d) => d !== 0 || byDay.get(0).length);
  if (!days.includes(bDay)) bDay = days[0];
  const dayStats = (d) => sumStats(groupByTech(byDay.get(d)), depot, st);
  const week = days.reduce((a, d) => { const x = dayStats(d); return { miles: a.miles + x.miles, min: a.min + x.min }; }, { miles: 0, min: 0 });
  const revenue = b.stops.reduce((s, x) => s + (x.rate || 0) / (x.frequency || 1), 0);
  const noLoc = new Set([...b.stops, ...b.unassigned].filter((x) => !Geo.has(x)).map((x) => x.customer_id)).size;
  const sel = byDay.get(bDay), selGroups = groupByTech(sel);
  const card = (s, i) => html`<div class="bcard" draggable="true" data-stop="${s.id}" style="border-left-color:${s.tech_color || 'var(--line2)'}">
    <div class="num">${i + 1}</div><div><div class="t">${s.customer_name}${Geo.has(s) ? '' : raw('<span class="nopin" title="No map location"></span>')}</div>
    <div class="s">${s.city}${s.frequency > 1 ? ' · every ' + s.frequency + ' wks' : ''}${bTech ? '' : ' · ' + (s.tech_name || 'Unassigned')}</div></div>
    <div class="acts"><button data-act="bMove" data-id="${s.id}" data-dir="-1" aria-label="Move up">▲</button><button data-act="bMove" data-id="${s.id}" data-dir="1" aria-label="Move down">▼</button><button data-act="editStop" data-id="${s.id}" aria-label="Edit stop">⋯</button></div></div>`;
  return html`${pageHead('Route builder', 'Drag pools onto a day to schedule them, reorder stops, then optimize each route.',
    html`<select style="width:auto" data-live="bTech">${techOptions(ts, 'All technicians').map(([k, l]) => html`<option value="${k}" ${raw(String(k) === bTech ? 'selected' : '')}>${l}</option>`)}</select>
    <button class="btn primary" data-act="optAll">${icon('zap')} Optimize all days</button>`)}
  ${noLoc ? html`<div class="banner">${icon('alert')}<span>${noLoc} customer${noLoc > 1 ? 's have' : ' has'} no map location, so they can’t be optimized.</span><span class="grow"></span><button class="btn sm" data-act="geoMissing">Locate automatically</button><a class="btn sm" href="#/settings">Settings</a></div>` : ''}
  ${!depot ? html`<div class="banner">${icon('pin')}<span>Set your shop location so routes start and end at the right place.</span><span class="grow"></span><a class="btn sm" href="#/settings">Set location</a></div>` : ''}
  <div class="grid" style="margin-bottom:16px">
    <div class="card kpi"><div class="ico">${icon('route')}</div><div><div class="n">${b.stops.length}</div><div class="l">Stops on the schedule</div></div></div>
    <div class="card kpi warn"><div class="ico">${icon('pin')}</div><div><div class="n">${fmtMi(week.miles)}</div><div class="l">Est. weekly driving</div></div></div>
    <div class="card kpi"><div class="ico">${icon('clock')}</div><div><div class="n">${fmtMin(week.min)}</div><div class="l">Est. weekly drive + service</div></div></div>
    <div class="card kpi ok"><div class="ico">${icon('dollar')}</div><div><div class="n">${money(revenue)}</div><div class="l">Weekly recurring revenue</div></div></div></div>
  <div class="builder">
    <div class="card flush rail"><div class="card-head"><h3>Unscheduled pools</h3><span class="chip">${b.unassigned.length}</span></div>
      <div class="list">${b.unassigned.length ? b.unassigned.map((p) => html`<div class="bcard" draggable="true" data-pool="${p.pool_id}"><div><div class="t">${p.customer_name}${Geo.has(p) ? '' : raw('<span class="nopin"></span>')}</div><div class="s">${p.pool_name} · ${p.city}</div></div></div>`)
        : html`<div class="drop-hint">Every pool is on a route 🎉</div>`}</div>
      ${bTech ? '' : html`<div class="small muted" style="padding:0 14px 12px">Pick a technician above to drag new pools onto days.</div>`}</div>
    <div>
      <div class="days">${days.map((d) => { const list = byDay.get(d), x = dayStats(d); return html`<div class="col ${d === bDay ? 'sel' : ''}" data-day="${d}">
        <div class="col-head" data-act="selDay" data-day="${d}"><div class="row spread"><b>${WEEKDAYS[d]}</b><span class="chip">${list.length}</span></div>
          <div class="meta"><span>${fmtMi(x.miles)}</span><span>${fmtMin(x.min)}</span></div></div>
        ${list.length ? list.map(card) : html`<div class="drop-hint">Drop pools here</div>`}
        <button class="btn sm accent" data-act="optWeekday" data-day="${d}" ${raw(list.length < 2 ? 'disabled' : '')}>${icon('zap')} Optimize</button></div>`; })}</div>
      <div class="card mt"><div class="row spread" style="margin-bottom:12px"><h3>${WEEKDAYS[bDay]} map</h3><span class="muted small">${sel.length} stops</span></div>
        ${mapSvg(depot, selGroups.map((g) => ({ color: g.color, name: g.name, stops: g.stops.map((s, i) => ({ lat: s.lat, lng: s.lng, label: i + 1, title: s.customer_name })) })), { roundTrip: !!st.round_trip })}
        ${legend(selGroups, depot, st)}</div>
    </div></div>`;
};
actions.optWeekday = ({ day }) => optimizeFlow([{ label: WEEKDAYS[day], body: { weekday: Number(day), ...(bTech ? { tech_id: Number(bTech) } : {}) } }], 'Optimize ' + WEEKDAYS[day] + ' route');
actions.optAll = () => {
  const counts = new Map(); board.stops.forEach((s) => counts.set(s.weekday, (counts.get(s.weekday) || 0) + 1));
  const items = BDAYS.filter((d) => counts.get(d) > 1).map((d) => ({ label: WEEKDAYS[d], body: { weekday: d, ...(bTech ? { tech_id: Number(bTech) } : {}) } }));
  if (!items.length) return toast('No day has two or more stops yet', true);
  return optimizeFlow(items, 'Optimize all days');
};
actions.bMove = async ({ id, dir }) => {
  const s = board.stops.find((x) => x.id == id);
  const list = board.stops.filter((x) => x.weekday === s.weekday);
  const i = list.indexOf(s), j = i + Number(dir);
  if (j < 0 || j >= list.length) return;
  list.splice(j, 0, list.splice(i, 1)[0]);
  await Promise.all(list.map((x, n) => PUT('/stops/' + x.id, { position: (n + 1) * 10 })));
  render();
};
actions.geoMissing = async () => {
  toast('Looking up addresses…');
  const r = await POST('/geocode-missing');
  toast(`Located ${r.updated} customer${r.updated === 1 ? '' : 's'}${r.remaining ? ` · ${r.remaining} still missing` : ''}`, !r.updated && r.remaining > 0);
  render();
};

// drag & drop (pools onto days, stops between/within days)
const dnd = {
  start(e) {
    const c = e.target.closest?.('.bcard[draggable]'); if (!c) return;
    e.dataTransfer.setData('text/plain', c.dataset.stop ? 'stop:' + c.dataset.stop : 'pool:' + c.dataset.pool);
    e.dataTransfer.effectAllowed = 'move'; c.classList.add('dragging');
  },
  over(e) { const col = e.target.closest?.('.col'); if (col) { e.preventDefault(); col.classList.add('over'); } },
  leave(e) { const col = e.target.closest?.('.col'); if (col && !col.contains(e.relatedTarget)) col.classList.remove('over'); },
  end() { document.querySelectorAll('.dragging,.over').forEach((x) => x.classList.remove('dragging', 'over')); },
  drop: guard(async (e) => {
    const col = e.target.closest?.('.col'); if (!col) return;
    e.preventDefault();
    const [kind, rawId] = (e.dataTransfer.getData('text/plain') || ':').split(':'), id = Number(rawId), day = Number(col.dataset.day);
    dnd.end(); if (!id) return;
    const cards = [...col.querySelectorAll('.bcard:not(.dragging)')];
    let idx = cards.findIndex((c) => e.clientY < c.getBoundingClientRect().top + c.offsetHeight / 2);
    if (idx < 0) idx = cards.length;
    const ids = cards.map((c) => Number(c.dataset.stop));
    let sid = id;
    if (kind === 'pool') {
      if (!bTech) return toast('Pick a technician (top right) before scheduling a new pool', true);
      sid = (await POST('/stops', { pool_id: id, tech_id: Number(bTech), weekday: day, position: 9999 })).id;
    } else {
      const cur = board.stops.find((s) => s.id === id);
      if (cur && cur.weekday !== day) await PUT('/stops/' + id, { weekday: day });
    }
    ids.splice(idx, 0, sid);
    await Promise.all(ids.map((x, n) => PUT('/stops/' + x, { position: (n + 1) * 10 })));
    render();
  }),
};
document.addEventListener('dragstart', dnd.start); document.addEventListener('dragover', dnd.over); document.addEventListener('dragleave', dnd.leave);
document.addEventListener('dragend', dnd.end); document.addEventListener('drop', dnd.drop);

// ---------- Settings ----------
views.settings = async () => {
  const [st, custs] = await Promise.all([settings(), GET('/customers')]);
  const located = custs.filter(Geo.has).length;
  return html`${pageHead('Settings', 'Your shop location and routing assumptions.')}
  <div class="split">
  <form id="sform" class="card" data-act-submit="saveSettings"><h3>Shop &amp; routing</h3>
    <div class="fields mt">
      <label class="full">Shop name<input name="depot_name" value="${st.depot_name}"></label>
      <label class="full">Shop address<input name="depot_address" value="${st.depot_address}" placeholder="123 Main St, Sunnyvale, CA"></label>
      <label>Latitude<input name="depot_lat" type="number" step="any" value="${st.depot_lat}"></label>
      <label>Longitude<input name="depot_lng" type="number" step="any" value="${st.depot_lng}"></label>
      <div class="full"><button type="button" class="btn sm" data-act="geoDepot">${icon('pin')} Look up address</button> <span class="muted small">Uses OpenStreetMap; the address is sent to their service.</span></div>
      <label>Average driving speed (mph)<input name="speed_mph" type="number" step="1" min="1" value="${st.speed_mph}"></label>
      <label>Service time per stop (min)<input name="service_min" type="number" step="1" min="1" value="${st.service_min}"></label>
      <label class="check full"><input type="checkbox" name="round_trip" ${raw(st.round_trip ? 'checked' : '')}> Technicians return to the shop at the end of the day</label></div>
    <div class="row mt"><button class="btn primary">Save settings</button></div></form>
  <div class="card"><h3>Customer map locations</h3>
    <div class="row mt"><div class="kpi" style="padding:0"><div class="ico">${icon('pin')}</div><div><div class="n">${located}/${custs.length}</div><div class="l">customers located</div></div></div></div>
    <div class="bar mt"><i style="width:${custs.length ? (100 * located) / custs.length : 0}%"></i></div>
    <p class="muted small mt">The optimizer needs a location for each customer. You can enter coordinates on the customer page, or look them up from their address.</p>
    <button class="btn" data-act="geoMissing" ${raw(located === custs.length ? 'disabled' : '')}>Locate missing customers</button></div></div>`;
};
document.addEventListener('submit', guard(async (e) => {
  if (e.target.id !== 'sform') return;
  e.preventDefault();
  const f = e.target;
  await PUT('/settings', { depot_name: f.depot_name.value, depot_address: f.depot_address.value, depot_lat: f.depot_lat.value, depot_lng: f.depot_lng.value,
    speed_mph: f.speed_mph.value, service_min: f.service_min.value, round_trip: +f.round_trip.checked });
  settingsCache = null; toast('Settings saved'); render();
}));
actions.geoDepot = async () => {
  const f = $('#sform'); const q = f.depot_address.value.trim();
  if (!q) return toast('Enter an address first', true);
  const r = await POST('/geocode', { query: q });
  f.depot_lat.value = r.lat.toFixed(6); f.depot_lng.value = r.lng.toFixed(6); toast('Location found — remember to save');
};
actions.geoForm = async () => {
  const f = $('#mform'); const q = [f.address.value, f.city.value].filter(Boolean).join(', ');
  if (!q) return toast('Enter an address first', true);
  const r = await POST('/geocode', { query: q });
  f.lat.value = r.lat.toFixed(6); f.lng.value = r.lng.toFixed(6); toast('Location found');
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
  { name: 'rate', label: 'Price per visit ($)', type: 'number', step: '0.01' },
  { name: 'lat', label: 'Latitude', type: 'number', step: 'any' }, { name: 'lng', label: 'Longitude', type: 'number', step: 'any' }, { type: 'geobtn' }, { name: 'notes', label: 'Notes (dogs, access…)', type: 'textarea', full: true },
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
