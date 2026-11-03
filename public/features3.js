'use strict';
/* Field & insight features: photos, ETA texts, rescheduling, outbox, reports. Loaded after features2.js. */

CUSTOMER_FIELDS.push(
  { name: 'notify_email', label: 'Email service reports & invoices', type: 'checkbox' },
  { name: 'notify_sms', label: 'Text “on my way” messages', type: 'checkbox' },
);

// ───────── photos ─────────
function photoSection(v, photos) {
  return html`<h2>Photos</h2><div class="card"><div class="photos" id="photostrip">${photos.map((p) => photoThumb(p))}
    <label class="photoadd">${icon('camera')}<span>Add photo</span><input type="file" accept="image/*" capture="environment" multiple hidden data-photo="${v.id}"></label></div>
    <div class="muted small mt">Photos are shared with the customer on their portal page after the visit.</div></div>`;
}
const photoThumb = (p) => html`<div class="thumb" data-pid="${p.id}"><a href="${p.url}" target="_blank" rel="noopener"><img src="${p.url}" alt="${p.caption || 'Visit photo'}" loading="lazy"></a><button type="button" class="x" data-act="delPhoto" data-id="${p.id}" aria-label="Remove photo">✕</button></div>`;
async function shrink(file, max = 1600) {
  const bmp = await createImageBitmap(file), s = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas'); c.width = Math.round(bmp.width * s); c.height = Math.round(bmp.height * s);
  c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', 0.82);
}
document.addEventListener('change', guard(async (e) => {
  const inp = e.target.closest?.('input[data-photo]'); if (!inp || !inp.files.length) return;
  const id = inp.dataset.photo; let queued = 0, ok = 0;
  for (const f of inp.files) {
    try { const r = await POST(`/visits/${id}/photos`, { data: await shrink(f) }); if (r.queued) queued++; else { ok++; inp.closest('.photoadd').insertAdjacentHTML('beforebegin', photoThumb(r).s); } }
    catch (x) { toast(x.message, true); }
  }
  inp.value = '';
  if (queued) toast(`${queued} photo${queued > 1 ? 's' : ''} saved offline — will upload when you're back online`);
  else if (ok) toast(`${ok} photo${ok > 1 ? 's' : ''} added`);
}));
actions.delPhoto = async ({ id }) => { if (!confirm('Remove this photo?')) return; await DEL('/photos/' + id); document.querySelector(`[data-pid="${id}"]`)?.remove(); };

// ───────── field & scheduling actions ─────────
actions.sendEta = async ({ id }) => { const r = await POST(`/visits/${id}/eta`); toast(r.sent ? 'Customer notified' : 'No contact set up for texts or email on this customer', !r.sent); };
actions.reschedule = ({ id, date }) => openForm({ title: 'Reschedule visit', saveLabel: 'Move visit', message: html`The original stop is marked skipped and a one-off visit is created on the new date.`,
  fields: [{ name: 'date', label: 'New date', type: 'date', required: true, full: true }], values: { date: addDays(date, 1) },
  onSave: async (d) => { const r = await POST(`/visits/${id}/reschedule`, d); toast('Moved to ' + fmtDate(r.date)); location.hash = '#/route'; } });
actions.reassignDay = async () => {
  const ts = await techs();
  openForm({ title: 'Reassign a day', saveLabel: 'Reassign', message: html`Move all <b>not-yet-completed</b> stops on ${fmtDate(routeDate)} from one technician to another — handy when someone is out.`,
    fields: [{ name: 'from_tech_id', label: 'From', type: 'select', int: true, options: techOptions(ts, 'Unassigned') }, { name: 'to_tech_id', label: 'To', type: 'select', int: true, options: techOptions(ts, 'Unassigned') }],
    onSave: async (d) => { const r = await POST('/schedule/reassign', { ...d, date: routeDate }); toast(`${r.moved} stop${r.moved === 1 ? '' : 's'} reassigned`); } });
};
actions.portalLink = async ({ id }) => {
  const { url } = await POST(`/customers/${id}/portal-link`);
  openForm({ title: 'Customer portal link', saveLabel: 'Close', onSave: async () => {}, fields: [],
    message: html`<p style="margin-top:0">Anyone with this private link can see this customer's visits, water tests, photos and invoices. Share it only with them.</p>
      <div class="row"><code style="flex:1;word-break:break-all;background:var(--chip);padding:8px 12px;border-radius:10px;font-size:12.5px">${url}</code></div>
      <div class="row mt"><button class="btn primary" data-act="copyLink" data-url="${url}">${icon('copy')} Copy link</button><a class="btn" target="_blank" rel="noopener" href="${url}">Open</a></div>` });
};

// ───────── outbox ─────────
views.outbox = async () => {
  const list = await GET('/outbox?limit=150');
  const tone = { sent: 'ok', logged: 'warn', failed: 'bad', queued: '' };
  return html`${pageHead('Outbox', 'Every email and text SplashDesk sends to customers. Connect a provider to deliver them for real.', html`<button class="btn" data-act="runReminders">${icon('clock')} Send overdue reminders</button>`)}
  ${list.some((m) => m.status === 'logged') ? html`<div class="banner">${icon('alert')}<span>No email/SMS provider is connected, so messages are only logged here. Set <code>RESEND_API_KEY</code> (email) and <code>TWILIO_*</code> (SMS) on your server.</span></div>` : ''}
  ${list.length ? html`<div class="card flush" style="overflow-x:auto"><table><thead><tr><th>When</th><th>To</th><th>Message</th><th>Status</th><th></th></tr></thead><tbody>
    ${list.map((m) => html`<tr><td class="muted small" style="white-space:nowrap">${m.created_at.slice(5, 16)}</td><td><span class="chip">${m.channel}</span> ${m.to_addr}</td><td><b>${m.subject || m.kind}</b><div class="muted small" style="max-width:420px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${m.body.replace(/\n+/g, ' ')}</div></td>
      <td><span class="badge ${tone[m.status] || ''}" title="${m.error}">${m.status}</span></td><td class="right">${m.status === 'failed' || m.status === 'logged' ? html`<button class="btn sm" data-act="retryMsg" data-id="${m.id}">Retry</button>` : ''}</td></tr>`)}</tbody></table></div>`
    : emptyState('Nothing sent yet', 'Service reports, invoices, ETA texts and reminders will show up here.')}`;
};
actions.retryMsg = async ({ id }) => { const r = await POST(`/outbox/${id}/retry`); toast(r.status === 'sent' ? 'Delivered' : 'Status: ' + r.status, r.status === 'failed'); render(); };
actions.runReminders = async () => { const r = await POST('/reminders/run'); toast(r.overdue ? `${r.sent} reminder${r.sent === 1 ? '' : 's'} sent for ${r.overdue} overdue invoice${r.overdue === 1 ? '' : 's'}` : 'No overdue invoices need a reminder'); render(); };

// ───────── reports ─────────
let repDays = 90;
actions.repDays = ({ d }) => { repDays = Number(d); render(); };
const hbar = (label, value, max, color = 'var(--brand)', right = '') => html`<div class="hb"><div class="row spread"><span>${label}</span><b>${right || money(value)}</b></div><div class="bar"><i style="width:${max ? (100 * value) / max : 0}%;background:${color}"></i></div></div>`;
views.reports = async () => {
  const r = await GET('/reports/summary?days=' + repDays), t = r.totals;
  const maxRoute = Math.max(1, ...r.routes.map((x) => x.per_hour)), ag = r.aging, agMax = Math.max(1, ...Object.values(ag));
  const labels = r.revenue.map((m) => new Date(m.month + '-01T12:00:00').toLocaleString(undefined, { month: 'short', year: '2-digit' }));
  const margin = t.billed ? Math.round((100 * (t.billed - t.chemical_cost)) / t.billed) : 0;
  return html`${pageHead('Reports', `${fmtDate(r.from)} – ${fmtDate(r.to)}`, html`<div class="seg">${[[30, '30 days'], [90, '90 days'], [180, '6 months'], [365, '1 year']].map(([d, l]) => html`<button class="${d === repDays ? 'on' : ''}" data-act="repDays" data-d="${d}">${l}</button>`)}</div>
    <a class="btn" href="/api/export/invoices.csv?from=${r.from}&to=${r.to}" download>${icon('download')} Invoices CSV</a><button class="btn" data-act="print">Print</button>`)}
  <div class="grid stagger">
    <div class="card kpi"><div class="ico">${icon('file')}</div><div><div class="n">${countUp(t.billed, 'money')}</div><div class="l">Billed</div></div></div>
    <div class="card kpi ok"><div class="ico">${icon('trend')}</div><div><div class="n">${countUp(t.collected, 'money')}</div><div class="l">Collected</div></div></div>
    <div class="card kpi warn"><div class="ico">${icon('clock')}</div><div><div class="n">${countUp(t.outstanding, 'money')}</div><div class="l">Outstanding now</div></div></div>
    <div class="card kpi"><div class="ico">${icon('check')}</div><div><div class="n">${countUp(t.visits)}</div><div class="l">Visits completed · ${margin}% after chemicals</div></div></div></div>
  <div class="split mt" style="margin-top:20px">
    <div class="card"><div class="row spread"><h3>Revenue</h3><div class="legend" style="margin:0"><span><i class="dot" style="background:var(--brand)"></i>Billed</span><span><i class="dot" style="background:var(--ok)"></i>Collected</span></div></div>
      ${r.revenue.length > 1 ? areaChart([{ name: 'Billed', color: '#0891b2', values: r.revenue.map((m) => m.billed) }, { name: 'Collected', color: '#0f9d58', values: r.revenue.map((m) => m.collected) }], labels, { money: true }) : html`<div class="muted small" style="padding:40px 0;text-align:center">Revenue appears here once invoices span more than one month.</div>`}</div>
    <div class="card"><h3>Receivables aging</h3><div class="stagger mt" style="display:grid;gap:14px">
      ${hbar('Not yet due', ag.current, agMax, 'var(--ok)')}${hbar('1–30 days late', ag.d30, agMax, 'var(--warn)')}${hbar('31–60 days late', ag.d60, agMax, '#ea580c')}${hbar('60+ days late', ag.d90, agMax, 'var(--bad)')}</div></div></div>
  <h2>Route profitability <span class="muted small" style="font-weight:500">— weekly template, revenue per hour of drive + service time</span></h2>
  ${r.routes.length ? html`<div class="card flush" style="overflow-x:auto"><table><thead><tr><th>Route</th><th>Stops</th><th class="right">Revenue / wk</th><th class="right">Miles</th><th class="right">Hours</th><th style="min-width:160px">Revenue / hour</th><th class="right">Net of mileage</th></tr></thead><tbody>
    ${r.routes.map((x) => html`<tr><td><b>${x.tech}</b> <span class="muted">${WEEKDAYS[x.weekday]}</span></td><td>${x.stops}</td><td class="right">${money(x.revenue)}</td><td class="right">${x.miles}</td><td class="right">${x.hours}</td>
      <td><div class="row" style="gap:8px;flex-wrap:nowrap"><div class="bar grow"><i style="width:${(100 * x.per_hour) / maxRoute}%"></i></div><b style="min-width:62px;text-align:right">${money(x.per_hour)}</b></div></td><td class="right">${money(x.net)}</td></tr>`)}</tbody></table></div>
    <div class="muted small mt">Low revenue-per-hour routes are the best candidates to optimize or rebalance in the <a href="#/builder">Route builder</a>. Mileage cost uses ${money(st_cpm())}/mile.</div>` : emptyState('No routes yet', 'Schedule stops in the Route builder to see profitability.')}
  <div class="split mt" style="margin-top:20px"><div><h2>Technicians</h2>${r.technicians.length ? html`<div class="card flush" style="overflow-x:auto"><table><thead><tr><th>Technician</th><th class="right">Visits</th><th class="right">Revenue</th><th class="right">Out-of-range tests</th></tr></thead><tbody>
      ${r.technicians.map((x) => html`<tr><td><div class="row" style="gap:10px;flex-wrap:nowrap">${avatar(x.tech, 30)}<b>${x.tech}</b></div></td><td class="right">${x.visits}</td><td class="right">${money(x.revenue)}</td><td class="right"><span class="badge ${x.flagged_pct > 40 ? 'bad' : x.flagged_pct > 20 ? 'warn' : 'ok'}">${x.flagged_pct}%</span></td></tr>`)}</tbody></table></div>` : emptyState('No completed visits', 'Complete some visits to see technician performance.')}</div>
    <div><h2>Chemicals</h2>${r.chemicals.length ? html`<div class="card flush" style="overflow-x:auto"><table><thead><tr><th>Product</th><th class="right">Used</th><th class="right">Billed</th><th class="right">Margin</th></tr></thead><tbody>
      ${r.chemicals.slice(0, 8).map((c) => html`<tr><td><b>${c.name}</b></td><td class="right">${c.qty} ${c.unit}</td><td class="right">${money(c.charge)}</td><td class="right"><b style="color:${c.margin >= 0 ? 'var(--ok)' : 'var(--bad)'}">${money(c.margin)}</b></td></tr>`)}</tbody></table></div>` : emptyState('No chemicals logged', 'Chemicals added on visits show usage and margin here.')}</div></div>
  ${r.top_customers.length ? html`<h2>Top customers</h2><div class="card flush">${r.top_customers.map((c) => html`<a href="#/customers/${c.id}" style="color:inherit;text-decoration:none;display:flex;align-items:center;gap:12px;padding:12px 20px;border-bottom:1px solid var(--line)">${avatar(c.name, 32)}<b class="grow">${c.name}</b><b>${money(c.total)}</b></a>`)}</div>` : ''}`;
};
const st_cpm = () => (settingsCache && settingsCache.cost_per_mile) || 0.67;

// business settings: automation toggles (extends the form from features2.js)
const baseSettings3 = views.settings;
views.settings = async () => {
  const out = await baseSettings3();
  if (me.role !== 'owner') return out;
  const st = await settings();
  const extra = html`<h2>Automation</h2><form id="aform" class="card"><div class="fields">
    <label class="check full"><input type="checkbox" name="auto_reports" ${raw(st.auto_reports ? 'checked' : '')}> Email customers a service report after each visit</label>
    <label class="check full"><input type="checkbox" name="auto_invoice_email" ${raw(st.auto_invoice_email ? 'checked' : '')}> Email invoices (with a pay link) when they're created</label>
    <label class="check full"><input type="checkbox" name="auto_reminders" ${raw(st.auto_reminders ? 'checked' : '')}> Remind customers weekly about overdue invoices</label>
    <label>Mileage cost used in reports ($/mile)<input name="cost_per_mile" type="number" step="0.01" min="0" value="${st.cost_per_mile}"></label></div>
    <div class="row mt"><button class="btn primary">Save</button></div></form>`;
  return html`${out}${extra}`;
};
document.addEventListener('submit', guard(async (e) => {
  if (e.target.id !== 'aform') return;
  e.preventDefault(); const f = e.target;
  await PUT('/settings', { auto_reports: +f.auto_reports.checked, auto_invoice_email: +f.auto_invoice_email.checked, auto_reminders: +f.auto_reminders.checked, cost_per_mile: f.cost_per_mile.value || 0 });
  settingsCache = null; toast('Automation settings saved');
}));

// ───────── street map (Leaflet + OpenStreetMap tiles, loaded on demand) ─────────
let leafletLoad = null;
const loadLeaflet = () => leafletLoad ||= new Promise((ok, fail) => {
  const css = document.createElement('link'); css.rel = 'stylesheet'; css.href = 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css'; document.head.appendChild(css);
  const js = document.createElement('script'); js.src = 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js'; js.onload = ok; js.onerror = () => { leafletLoad = null; fail(new Error('Could not load the street map — check your connection')); }; document.head.appendChild(js);
});
let leafletMap = null;
actions.streetMap = async (_, btn) => {
  const box = $('#mapbox'), M = window.__routeMap;
  if (!box || !M) return;
  if (leafletMap) { leafletMap.remove(); leafletMap = null; box.innerHTML = M.svg; btn.textContent = 'Street map'; return; }
  await loadLeaflet();
  M.svg = box.innerHTML;
  box.innerHTML = '<div id="lmap" style="height:440px;border-radius:14px;overflow:hidden;border:1px solid var(--line)"></div>';
  leafletMap = L.map('lmap', { scrollWheelZoom: false });
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap contributors' }).addTo(leafletMap);
  const bounds = [];
  const pin = (lat, lng, html_, color) => L.marker([lat, lng], { icon: L.divIcon({ className: '', iconSize: [28, 28], iconAnchor: [14, 14], html: `<div style="width:28px;height:28px;border-radius:50%;background:${color};color:#fff;border:2.5px solid #fff;box-shadow:0 2px 8px rgba(0,0,0,.35);display:grid;place-items:center;font:800 12px system-ui">${html_}</div>` }) }).addTo(leafletMap);
  if (M.depot) { pin(M.depot.lat, M.depot.lng, '⌂', '#0a2540'); bounds.push([M.depot.lat, M.depot.lng]); }
  for (const g of M.mapGroups) {
    const pts = g.stops.filter((s) => Geo.has(s)); if (!pts.length) continue;
    const line = (M.depot ? [[M.depot.lat, M.depot.lng]] : []).concat(pts.map((s) => [+s.lat, +s.lng]), M.roundTrip && M.depot ? [[M.depot.lat, M.depot.lng]] : []);
    L.polyline(line, { color: g.color, weight: 4, opacity: 0.85 }).addTo(leafletMap);
    pts.forEach((s, i) => { pin(+s.lat, +s.lng, i + 1, g.color).bindTooltip(String(s.title || '')); bounds.push([+s.lat, +s.lng]); });
  }
  if (bounds.length) leafletMap.fitBounds(bounds, { padding: [30, 30] }); else leafletMap.setView([37.4, -122.1], 11);
  btn.textContent = 'Schematic';
};
window.addEventListener('hashchange', () => { if (leafletMap) { leafletMap.remove(); leafletMap = null; } });
