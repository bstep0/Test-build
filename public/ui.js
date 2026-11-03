'use strict';
/* UI layer: app shell, topbar, command palette, motion, charts, gauges. Loaded after app.js (shares its globals). */

// ───────── small visual helpers ─────────
const hueOf = (s) => [...String(s)].reduce((a, c) => (a * 31 + c.charCodeAt(0)) % 360, 7);
const initials = (n) => String(n).split(/[\s,&]+/).filter(Boolean).map((w) => w[0]).join('').slice(0, 2).toUpperCase() || '?';
const avatar = (name, size = 36) => { const h = hueOf(name); return html`<span class="avatar" style="width:${size}px;height:${size}px;font-size:${Math.round(size * 0.38)}px;background:linear-gradient(135deg,hsl(${h} 75% 56%),hsl(${(h + 45) % 360} 70% 42%))">${initials(name)}</span>`; };
const WAVE = 'M0 40 q112.5 -34 225 0 t225 0 t225 0 t225 0 t225 0 t225 0 t225 0 t225 0 V120 H0Z';
const waves = () => raw(`<div class="waves" aria-hidden="true"><svg class="w1" viewBox="0 0 1800 120" preserveAspectRatio="none"><path d="${WAVE}" fill="#fff" fill-opacity=".14"/></svg><svg class="w2" viewBox="0 0 1800 120" preserveAspectRatio="none"><path d="${WAVE}" fill="#fff" fill-opacity=".22"/></svg><svg class="w3" viewBox="0 0 1800 120" preserveAspectRatio="none"><path d="${WAVE}" style="fill:var(--bg)"/></svg></div>`);
const countUp = (n, fmt = 'int', cls = '') => raw(`<span class="${cls}" data-count="${Number(n) || 0}" data-fmt="${fmt}">${esc(fmtCount(n, fmt))}</span>`);
function fmtCount(n, fmt) { n = Number(n) || 0; return fmt === 'money' ? money(n) : fmt === 'mi' ? n.toFixed(1) + ' mi' : fmt === 'pct' ? Math.round(n) + '%' : Math.round(n).toLocaleString(); }

function emptyState(title, text, action = '') {
  return html`<div class="card empty"><svg class="ill" viewBox="0 0 160 110" fill="none" aria-hidden="true"><rect x="14" y="52" width="132" height="48" rx="14" fill="var(--brand-soft)"/><path d="M14 68c14-8 24-8 38 0s24 8 38 0 24-8 38 0 20 6 18 0" stroke="var(--brand)" stroke-width="3" stroke-linecap="round" opacity=".8"/><path d="M14 82c14-8 24-8 38 0s24 8 38 0 24-8 38 0" stroke="var(--brand)" stroke-width="3" stroke-linecap="round" opacity=".4"/><path d="M110 52V24a8 8 0 0 1 16 0M126 52V30M110 38h16" stroke="var(--muted)" stroke-width="3.5" stroke-linecap="round"/><circle cx="52" cy="30" r="9" fill="var(--warn)" opacity=".85"/></svg><b>${title}</b>${text}${action ? html`<div class="mt">${action}</div>` : ''}</div>`;
}

// ───────── charts ─────────
function sparkline(values, color = 'var(--brand)') {
  if (!values || values.length < 2) return '';
  const w = 84, h = 34, max = Math.max(...values), min = Math.min(...values), r = max - min || 1;
  const pts = values.map((v, i) => [(i / (values.length - 1)) * w, h - 3 - ((v - min) / r) * (h - 8)]);
  const d = pts.map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join(' ');
  return raw(`<svg class="chart spark" viewBox="0 0 ${w} ${h}" aria-hidden="true"><path class="area" d="${d} L${w} ${h} L0 ${h}Z" fill="${color}" fill-opacity=".14"/><path class="line" pathLength="1" d="${d}" stroke="${color}" stroke-width="2"/></svg>`);
}
// Multi-series area/line chart. series: [{name,color,values}], labels: x labels
function areaChart(series, labels, { height = 220, money: isMoney = false } = {}) {
  const W = 640, H = height, P = { l: 44, r: 12, t: 12, b: 26 };
  const maxV = Math.max(1, ...series.flatMap((s) => s.values)) * 1.15;
  const step = Math.pow(10, Math.floor(Math.log10(maxV))), nice = Math.ceil(maxV / step) * step;
  const X = (i) => P.l + (i / Math.max(1, labels.length - 1)) * (W - P.l - P.r), Y = (v) => P.t + (1 - v / nice) * (H - P.t - P.b);
  const grid = [0, 0.25, 0.5, 0.75, 1].map((f) => { const v = nice * f, y = Y(v); return `<line class="gridl" x1="${P.l}" x2="${W - P.r}" y1="${y}" y2="${y}"/><text x="${P.l - 8}" y="${y + 3}" text-anchor="end">${isMoney ? '$' + (v >= 1000 ? (v / 1000).toFixed(v % 1000 ? 1 : 0) + 'k' : Math.round(v)) : Math.round(v)}</text>`; }).join('');
  const xl = labels.map((l, i) => (labels.length < 10 || i % 2 === 0 ? `<text x="${X(i)}" y="${H - 6}" text-anchor="middle">${esc(l)}</text>` : '')).join('');
  const paths = series.map((s, k) => {
    const d = s.values.map((v, i) => (i ? 'L' : 'M') + X(i).toFixed(1) + ' ' + Y(v).toFixed(1)).join(' ');
    return `<defs><linearGradient id="ag${k}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${s.color}" stop-opacity=".35"/><stop offset="1" stop-color="${s.color}" stop-opacity="0"/></linearGradient></defs>
      <path class="area" d="${d} L${X(s.values.length - 1)} ${Y(0)} L${X(0)} ${Y(0)}Z" fill="url(#ag${k})"/><path class="line" pathLength="1" d="${d}" stroke="${s.color}"/>
      ${s.values.map((v, i) => `<circle class="pt" style="--i:${i}" cx="${X(i)}" cy="${Y(v)}" r="3.5" fill="var(--card)" stroke="${s.color}" stroke-width="2"><title>${esc(s.name)}: ${isMoney ? money(v) : v}</title></circle>`).join('')}`;
  }).join('');
  return raw(`<svg class="chart" viewBox="0 0 ${W} ${H}" role="img">${grid}${xl}${paths}</svg>`);
}
// One water-chemistry metric over time with the healthy range shaded.
function metricChart(visits, key) {
  const R = Dosing.RANGES[key], pts = visits.filter((v) => v[key] != null).slice().reverse();
  if (pts.length < 2) return html`<div class="muted small" style="padding:30px;text-align:center">Not enough ${R.label.toLowerCase()} readings yet.</div>`;
  const W = 640, H = 200, P = { l: 40, r: 12, t: 12, b: 26 };
  const vals = pts.map((p) => +p[key]), lo = Math.min(R.min, ...vals), hi = Math.max(R.max, ...vals), pad = (hi - lo) * 0.18 || 1;
  const a = lo - pad, b = hi + pad;
  const X = (i) => P.l + (i / (pts.length - 1)) * (W - P.l - P.r), Y = (v) => P.t + (1 - (v - a) / (b - a)) * (H - P.t - P.b);
  const d = vals.map((v, i) => (i ? 'L' : 'M') + X(i).toFixed(1) + ' ' + Y(v).toFixed(1)).join(' ');
  const dots = vals.map((v, i) => { const c = v < R.min ? 'var(--warn)' : v > R.max ? 'var(--bad)' : 'var(--ok)'; return `<circle class="pt" style="--i:${i}" cx="${X(i)}" cy="${Y(v)}" r="4.5" fill="${c}" stroke="var(--card)" stroke-width="2"><title>${esc(fmtDate(pts[i].date))}: ${v}</title></circle>`; }).join('');
  const labels = pts.map((p, i) => (pts.length < 9 || i % 2 === 0 ? `<text x="${X(i)}" y="${H - 6}" text-anchor="middle">${esc(fmtDate(p.date, { month: 'numeric', day: 'numeric' }))}</text>` : '')).join('');
  return raw(`<svg class="chart" viewBox="0 0 ${W} ${H}" role="img"><rect x="${P.l}" y="${Y(R.max)}" width="${W - P.l - P.r}" height="${Y(R.min) - Y(R.max)}" rx="6" fill="var(--ok)" opacity=".12"/>
    <text x="${P.l - 6}" y="${Y(R.max) + 3}" text-anchor="end">${R.max}</text><text x="${P.l - 6}" y="${Y(R.min) + 3}" text-anchor="end">${R.min}</text>${labels}
    <path class="line" pathLength="1" d="${d}" stroke="var(--brand)"/>${dots}</svg>`);
}
// Range gauge for a water reading: green band = healthy range, marker = current value.
const GAUGE = { fc: [0, 8], ph: [6.4, 8.4], ta: [0, 200], cya: [0, 120], ch: [0, 600], salt: [0, 5000] };
function gaugeParts(key, value) {
  const R = Dosing.RANGES[key], [lo, hi] = GAUGE[key] || [0, 100], pc = (v) => Math.max(0, Math.min(100, ((v - lo) / (hi - lo)) * 100));
  const has = value !== null && value !== undefined && value !== '' && !isNaN(Number(value));
  const status = !has ? '' : Number(value) < R.min ? 'low' : Number(value) > R.max ? 'high' : 'ok';
  return { band: [pc(R.min), pc(R.max) - pc(R.min)], mark: has ? pc(Number(value)) : null, status };
}
const gaugeHtml = (key, value) => {
  const g = gaugeParts(key, value);
  return html`<div class="gauge" data-g="${key}"><span class="band" style="left:${g.band[0]}%;width:${g.band[1]}%"></span>${g.mark === null ? '' : html`<span class="mark ${g.status}" style="left:${g.mark}%"></span>`}</div>`;
};
function updateGauges(form) {
  for (const el of form.querySelectorAll('.gauge[data-g]')) {
    const key = el.dataset.g, input = form.elements[key], g = gaugeParts(key, input?.value);
    let m = el.querySelector('.mark');
    if (g.mark === null) { m?.remove(); continue; }
    if (!m) { m = document.createElement('span'); m.className = 'mark'; m.style.left = '0%'; el.appendChild(m); requestAnimationFrame(() => (m.style.left = g.mark + '%')); }
    m.style.left = g.mark + '%'; m.className = 'mark ' + g.status;
  }
}

// ───────── celebration ─────────
function confetti(x = innerWidth / 2, y = innerHeight / 2) {
  if (matchMedia('(prefers-reduced-motion:reduce)').matches) return;
  const colors = ['#22d3ee', '#2563eb', '#34d399', '#fbbf24', '#f472b6', '#a78bfa'];
  for (let i = 0; i < 34; i++) {
    const p = document.createElement('i'); p.className = 'confetti';
    const a = Math.random() * Math.PI * 2, s = 120 + Math.random() * 220;
    p.style.cssText = `left:${x}px;top:${y}px;background:${colors[i % colors.length]};--dx:${Math.cos(a) * s}px;--dy:${Math.sin(a) * s + 140}px;--rot:${Math.random() * 720 - 360}deg`;
    document.body.appendChild(p); setTimeout(() => p.remove(), 1500);
  }
}

// ───────── shell: sidebar + topbar ─────────
const PAGE_TITLES = { dashboard: 'Dashboard', route: 'Daily route', visit: 'Visit', builder: 'Route builder', customers: 'Customers', workorders: 'Work orders', invoices: 'Invoices',
  quotes: 'Quotes', inventory: 'Inventory', reports: 'Reports', dose: 'Dosing', team: 'Team', settings: 'Settings', account: 'Account' };
const BADGES = { invoices: 'invoices_overdue', workorders: 'work_orders_open', quotes: 'quotes_waiting', inventory: 'low_stock' };
function buildNav() {
  const tech = me?.role === 'tech';
  document.body.classList.toggle('role-tech', tech);
  const sections = tech ? [['Field', [['route', 'My route', 'route'], ['dose', 'Dosing', 'drop'], ['account', 'Account', 'badge']]]] : window.NAV_SECTIONS();
  $('#nav').innerHTML = html`<a class="brand" href="#/${tech ? 'route' : 'dashboard'}"><span class="logo">${icon('wave')}</span><span>SplashDesk<small>Pool service</small></span></a>
    ${sections.map(([sec, items]) => html`<div class="sec">${sec}</div><div class="links">${items.map(([k, l, ic]) => html`<a class="item" href="#/${k}" data-nav="${k}">${icon(ic)}<span>${l}</span>${BADGES[k] ? raw(`<span class="count" data-badge="${BADGES[k]}" hidden></span>`) : ''}</a>`)}</div>`)}
    <div class="foot">${avatar(me?.name || '?', 34)}<div><b>${me?.name}</b><span>${me?.role}</span></div></div>
    <button class="collapse" data-act="collapseNav" aria-label="Collapse sidebar"><svg class="i" viewBox="0 0 24 24" style="width:14px;height:14px"><path d="m15 6-6 6 6 6"/></svg></button>`.s;
  buildTopbar();
  if (localStorage.getItem('navCollapsed') === '1') document.body.classList.add('collapsed');
}
window.NAV_SECTIONS = () => [
  ['Operations', [['dashboard', 'Dashboard', 'grid'], ['route', 'Daily route', 'route'], ['builder', 'Route builder', 'columns']]],
  ['Business', [['customers', 'Customers', 'users'], ['quotes', 'Quotes', 'file'], ['workorders', 'Work orders', 'wrench'], ['invoices', 'Invoices', 'dollar'], ['inventory', 'Inventory', 'box'], ['reports', 'Reports', 'trend']]],
  ['Tools', [['dose', 'Dosing', 'drop'], ['team', 'Team', 'badge'], ['settings', 'Settings', 'sliders'], ['account', 'Account', 'user']]],
];
Object.assign(ICONS, {
  box: '<path d="M21 8 12 3 3 8v8l9 5 9-5z"/><path d="m3 8 9 5 9-5M12 13v8"/>', user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>', bell: '<path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9M13.7 21a2 2 0 0 1-3.4 0"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  moon: '<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/>', logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/>',
  mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/>', camera: '<path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/>',
  download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/>', copy: '<rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
  edit: '<path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>', send: '<path d="m22 2-7 20-4-9-9-4zM22 2 11 13"/>', phone: '<path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 1.9.7 2.8a2 2 0 0 1-.5 2.1L8.1 9.9a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.8.7a2 2 0 0 1 1.7 2z"/>',
});
function buildTopbar() {
  const tech = me?.role === 'tech';
  const dark = (document.documentElement.dataset.theme || (matchMedia('(prefers-color-scheme:dark)').matches ? 'dark' : 'light')) === 'dark';
  $('#topbar').innerHTML = html`<div class="crumb"><span>SplashDesk</span><span class="sep">/</span><span id="crumb">Dashboard</span></div>
    ${tech ? '' : html`<button class="searchbtn" data-act="openPalette">${icon('search')}<span>Search customers, pages, actions…</span><kbd>${/Mac|iPhone|iPad/.test(navigator.platform) ? '⌘K' : 'Ctrl K'}</kbd></button>`}
    <div class="tools"><div class="netpill" id="netpill"><i></i><span>Online</span></div>
      <button class="iconbtn" data-act="toggleTheme" aria-label="Toggle dark mode">${icon(dark ? 'sun' : 'moon')}</button>
      ${tech ? '' : html`<div style="position:relative"><button class="iconbtn" data-act="menu" data-menu="bell" aria-label="Notifications">${icon('bell')}<span class="dot-n" id="belln" hidden></span></button><div id="menu-bell" class="popover" hidden></div></div>`}
      <div style="position:relative"><button class="iconbtn" data-act="menu" data-menu="user" aria-label="Account menu" style="width:auto;padding:0 4px">${avatar(me?.name || '?', 30)}</button>
        <div id="menu-user" class="popover" hidden><div class="ph">${me?.name} · ${me?.role}</div><a href="#/account">${icon('user')} Account</a><button data-act="toggleTheme">${icon(dark ? 'sun' : 'moon')} ${dark ? 'Light' : 'Dark'} mode</button><hr><button data-act="logout">${icon('logout')} Sign out</button></div></div></div>`.s;
  syncNet();
}
const syncNet = () => { const p = $('#netpill'); if (!p) return; p.classList.toggle('off', !navigator.onLine); p.lastElementChild.textContent = navigator.onLine ? 'Online' : 'Offline'; };
window.addEventListener('online', syncNet); window.addEventListener('offline', syncNet);
actions.collapseNav = () => { const c = document.body.classList.toggle('collapsed'); try { localStorage.setItem('navCollapsed', c ? '1' : '0'); } catch { /* private mode */ } };
actions.toggleTheme = () => { const cur = document.documentElement.dataset.theme || (matchMedia('(prefers-color-scheme:dark)').matches ? 'dark' : 'light'); const next = cur === 'dark' ? 'light' : 'dark'; try { localStorage.setItem('theme', next); } catch { /* */ } document.documentElement.dataset.theme = next; buildTopbar(); decorateCrumb(); refreshBadges(true); };
actions.menu = ({ menu }) => { const el = $('#menu-' + menu), open = !el.hidden; closeMenus(); el.hidden = open; };
const closeMenus = () => document.querySelectorAll('.popover').forEach((p) => (p.hidden = true));
document.addEventListener('click', (e) => { if (!e.target.closest('[data-act=menu],.popover')) closeMenus(); });

let badgeAt = 0, badgeData = null;
async function refreshBadges(force) {
  if (me?.role === 'tech' || !me) return;
  if (force || Date.now() - badgeAt > 20000) { try { badgeData = await GET('/badges?date=' + localISO()); badgeAt = Date.now(); } catch { return; } }
  const b = badgeData || {};
  document.querySelectorAll('[data-badge]').forEach((el) => { const n = b[el.dataset.badge] || 0; el.hidden = !n; el.textContent = n; el.classList.toggle('soft', el.dataset.badge !== 'invoices_overdue'); });
  const total = (b.invoices_overdue || 0) + (b.quotes_waiting || 0) + (b.low_stock || 0), dot = $('#belln');
  if (dot) { dot.hidden = !total; dot.textContent = total; }
  const m = $('#menu-bell');
  if (m) m.innerHTML = html`<div class="ph">Notifications</div>${total ? '' : html`<div class="ph" style="font-weight:500">You're all caught up ✨</div>`}
    ${b.invoices_overdue ? html`<a href="#/invoices">${icon('dollar')} ${b.invoices_overdue} overdue invoice${b.invoices_overdue > 1 ? 's' : ''}</a>` : ''}
    ${b.quotes_waiting ? html`<a href="#/quotes">${icon('file')} ${b.quotes_waiting} quote${b.quotes_waiting > 1 ? 's' : ''} awaiting a reply</a>` : ''}
    ${b.low_stock ? html`<a href="#/inventory">${icon('box')} ${b.low_stock} product${b.low_stock > 1 ? 's' : ''} low on stock</a>` : ''}
    ${b.work_orders_open ? html`<a href="#/workorders">${icon('wrench')} ${b.work_orders_open} open work order${b.work_orders_open > 1 ? 's' : ''}</a>` : ''}`.s;
}

// ───────── command palette (⌘K) ─────────
let palCustomers = null, palAt = 0;
actions.openPalette = async () => {
  if (me?.role === 'tech' || document.querySelector('.palette')) return;
  if (!palCustomers || Date.now() - palAt > 60000) { try { palCustomers = await GET('/customers'); palAt = Date.now(); } catch { palCustomers = []; } }
  const pages = window.NAV_SECTIONS().flatMap(([, items]) => items).map(([k, l, ic]) => ({ g: 'Go to', label: l, icon: ic, run: () => (location.hash = '#/' + k) }));
  const acts = [
    { g: 'Actions', label: 'New customer', icon: 'plus', run: () => { location.hash = '#/customers'; setTimeout(() => actions.newCustomer(), 250); } },
    { g: 'Actions', label: 'New work order', icon: 'wrench', run: () => actions.newWO() },
    { g: 'Actions', label: 'Optimize today’s routes', icon: 'zap', run: () => actions.optToday() },
    { g: 'Actions', label: 'Toggle dark mode', icon: 'moon', run: () => actions.toggleTheme() },
  ];
  const custs = palCustomers.map((c) => ({ g: 'Customers', label: c.name, sub: [c.address, c.city].filter(Boolean).join(', '), icon: 'user', run: () => (location.hash = '#/customers/' + c.id) }));
  const all = [...pages, ...acts, ...custs];
  const el = document.createElement('div'); el.className = 'palette';
  el.innerHTML = '<div class="box" role="dialog" aria-label="Command palette"><input placeholder="Type to search…" autocomplete="off" aria-label="Search"><ul></ul></div>';
  document.body.appendChild(el);
  const input = el.querySelector('input'), ul = el.querySelector('ul'); let sel = 0, shown = [];
  const draw = () => {
    const q = input.value.trim().toLowerCase();
    shown = (q ? all.filter((x) => (x.label + ' ' + (x.sub || '')).toLowerCase().includes(q)) : all.filter((x) => x.g !== 'Customers')).slice(0, 40);
    sel = Math.min(sel, Math.max(0, shown.length - 1)); let last = '';
    ul.innerHTML = shown.map((x, i) => `${x.g !== last ? `<div class="grp">${last = x.g}</div>` : ''}<li class="${i === sel ? 'sel' : ''}" data-i="${i}">${icon(x.icon).s}<span>${esc(x.label)}</span>${x.sub ? `<small>${esc(x.sub)}</small>` : ''}</li>`).join('') || '<li class="muted">No results</li>';
    ul.querySelector('.sel')?.scrollIntoView({ block: 'nearest' });
  };
  const close = () => { el.remove(); document.removeEventListener('keydown', onKey, true); };
  const go = (i) => { const x = shown[i]; if (x) { close(); x.run(); } };
  const onKey = (e) => {
    if (e.key === 'Escape') { e.preventDefault(); close(); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); sel = Math.min(shown.length - 1, sel + 1); draw(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); sel = Math.max(0, sel - 1); draw(); }
    else if (e.key === 'Enter') { e.preventDefault(); go(sel); }
  };
  document.addEventListener('keydown', onKey, true);
  input.addEventListener('input', () => { sel = 0; draw(); });
  ul.addEventListener('click', (e) => { const li = e.target.closest('li[data-i]'); if (li) go(+li.dataset.i); });
  el.addEventListener('mousedown', (e) => { if (e.target === el) close(); });
  draw(); input.focus();
};
document.addEventListener('keydown', (e) => { if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); actions.openPalette(); } });

// ───────── motion: transitions, skeletons, ripple, count-up ─────────
const skeleton = () => html`<div><div class="skel" style="height:34px;width:240px;margin-bottom:20px"></div><div class="grid"><div class="skel" style="height:92px"></div><div class="skel" style="height:92px"></div><div class="skel" style="height:92px"></div><div class="skel" style="height:92px"></div></div><div class="skel" style="height:260px;margin-top:20px"></div></div>`.s;
const _render = window.render; let lastHash = null, lastDoneAt = 0;
window.render = async function () {
  // An in-place refresh (same page, shortly after the last render) skips entrance animations so the UI doesn't flash.
  const appEl = $('#app'), same = location.hash === lastHash && performance.now() - lastDoneAt > 1200; lastHash = location.hash; lastDoneAt = performance.now();
  appEl.classList.toggle('no-anim', same);
  let finished = false;
  const t = setTimeout(() => { if (!finished && !same && me) appEl.innerHTML = skeleton(); }, 160);
  try { await _render(); } finally { finished = true; clearTimeout(t); }
  lastDoneAt = performance.now();
  decorate(same);
};
function decorateCrumb() { const name = (location.hash.slice(2) || (me?.role === 'tech' ? 'route' : 'dashboard')).split('/')[0], c = $('#crumb'); if (c) c.textContent = PAGE_TITLES[name] || 'SplashDesk'; document.title = (PAGE_TITLES[name] || 'SplashDesk') + ' · SplashDesk'; }
function decorate(same) {
  const appEl = $('#app');
  [...appEl.children].forEach((el, i) => el.style.setProperty('--i', i));
  appEl.querySelectorAll('.stagger').forEach((p) => [...p.children].forEach((el, i) => el.style.setProperty('--i', i)));
  decorateCrumb(); refreshBadges();
  if (!same && !matchMedia('(prefers-reduced-motion:reduce)').matches) appEl.querySelectorAll('[data-count]').forEach((el) => {
    const end = Number(el.dataset.count), fmt = el.dataset.fmt, t0 = performance.now(), dur = 900;
    const tick = (t) => { const p = Math.min(1, (t - t0) / dur), e = 1 - Math.pow(1 - p, 3); el.textContent = fmtCount(end * e, fmt); if (p < 1) requestAnimationFrame(tick); };
    el.textContent = fmtCount(0, fmt); requestAnimationFrame(tick);
  });
}
document.addEventListener('pointerdown', (e) => {
  const b = e.target.closest('.btn'); if (!b || b.disabled || b.classList.contains('ghost')) return;
  const r = b.getBoundingClientRect(), d = Math.max(r.width, r.height), s = document.createElement('span');
  s.className = 'ripple'; s.style.cssText = `width:${d}px;height:${d}px;left:${e.clientX - r.left - d / 2}px;top:${e.clientY - r.top - d / 2}px`;
  b.appendChild(s); setTimeout(() => s.remove(), 620);
});
