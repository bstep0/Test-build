'use strict';
/* Customer-facing pages: pay an invoice, approve a quote, portal. No login — the unguessable link is the credential. */
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = (n) => new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD' }).format(n || 0);
const fmtDate = (s) => (s ? new Date(s.slice(0, 10) + 'T12:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : '—');
const root = document.getElementById('pub');
const WAVE = 'M0 40 q112.5 -34 225 0 t225 0 t225 0 t225 0 t225 0 t225 0 t225 0 t225 0 V120 H0Z';
const waves = `<div class="waves" aria-hidden="true"><svg class="w1" viewBox="0 0 1800 120" preserveAspectRatio="none"><path d="${WAVE}" fill="#fff" fill-opacity=".14"/></svg><svg class="w2" viewBox="0 0 1800 120" preserveAspectRatio="none"><path d="${WAVE}" fill="#fff" fill-opacity=".22"/></svg><svg class="w3" viewBox="0 0 1800 120" preserveAspectRatio="none"><path d="${WAVE}" style="fill:var(--bg)"/></svg></div>`;
async function api(method, url, body) {
  const r = await fetch('/api/public' + url, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error || 'Something went wrong');
  return d;
}
function confetti() {
  if (matchMedia('(prefers-reduced-motion:reduce)').matches) return;
  const colors = ['#22d3ee', '#2563eb', '#34d399', '#fbbf24', '#f472b6'];
  for (let i = 0; i < 40; i++) {
    const p = document.createElement('i'), a = Math.random() * Math.PI * 2, s = 140 + Math.random() * 260; p.className = 'confetti';
    p.style.cssText = `left:50%;top:30%;background:${colors[i % 5]};--dx:${Math.cos(a) * s}px;--dy:${Math.sin(a) * s + 160}px;--rot:${Math.random() * 720 - 360}deg`;
    document.body.appendChild(p); setTimeout(() => p.remove(), 1500);
  }
}
const shell = (company, title, sub, body) => `<div class="pub"><section class="hero" style="margin:0 0 -34px;border-radius:0 0 28px 28px;padding:30px 20px 74px"><div class="pubin"><div class="row" style="gap:10px"><span class="logo"><svg class="i" viewBox="0 0 24 24" style="stroke:#fff"><path d="M3 16c3-3 5-3 8 0s5 3 8 0M3 9c3-3 5-3 8 0s5 3 8 0"/></svg></span><b style="font-size:17px">${esc(company.name)}</b></div>
  <h1 style="margin-top:22px">${title}</h1><div class="sub">${sub}</div></div>${waves}</section><div class="pubin" style="position:relative;z-index:2">${body}</div>
  <p class="muted small" style="text-align:center;margin:26px 0 40px">${esc([company.email, company.phone].filter(Boolean).join(' · '))}</p></div>`;
const itemsTable = (items, subtotal, tax, total, taxLabel) => `<table><thead><tr><th>Description</th><th class="right">Qty</th><th class="right">Amount</th></tr></thead><tbody>
  ${items.map((i) => `<tr><td>${esc(i.desc)}</td><td class="right">${i.qty}</td><td class="right">${money(i.qty * i.price)}</td></tr>`).join('')}
  ${tax ? `<tr><td colspan="2" class="right muted">Subtotal</td><td class="right">${money(subtotal)}</td></tr><tr><td colspan="2" class="right muted">${taxLabel}</td><td class="right">${money(tax)}</td></tr>` : ''}
  <tr><td colspan="2" class="right"><b>Total</b></td><td class="right"><b style="font-size:20px">${money(total)}</b></td></tr></tbody></table>`;

async function payPage(token) {
  const d = await api('GET', `/pay/${token}`), i = d.invoice, paidNow = new URLSearchParams(location.search).get('paid') === '1';
  const paid = i.status === 'paid';
  root.innerHTML = shell(d.company, paid ? 'Payment received' : `Invoice #${i.id}`, paid ? `Thank you, ${esc(i.customer_name)}!` : `${esc(i.customer_name)} · due ${fmtDate(i.due)}`,
    `<div class="card" style="padding:0;overflow:hidden;position:relative">${paid ? `<div class="stamp ok">PAID</div>` : ''}<div style="overflow-x:auto">${itemsTable(i.items, i.subtotal, i.tax, i.total, 'Sales tax')}</div>
      <div style="padding:20px">${paid ? `<p style="color:var(--ok);font-weight:700;margin:0">Paid ${fmtDate(i.paid_at)}. A receipt is available from your card issuer.</p>`
        : d.payable ? `<label class="check" style="margin-bottom:14px"><input type="checkbox" id="save"> Save my card for automatic payments</label><button class="btn primary big" id="pay" style="width:100%">Pay ${money(i.total)} securely</button><p class="muted small" style="text-align:center;margin:10px 0 0">Card details are handled by Stripe — we never see them.</p><div class="error" id="err"></div>`
        : `<p class="muted" style="margin:0">Online payment isn't available for this invoice. Please contact us to arrange payment.</p>`}
      ${paidNow && !paid ? `<p class="muted small mt">Thanks! Your payment is being confirmed — this page will update shortly.</p>` : ''}</div></div>`);
  if (paid && paidNow) confetti();
  document.getElementById('pay')?.addEventListener('click', async (e) => {
    e.target.classList.add('busy');
    try { const r = await api('POST', `/pay/${token}/checkout`, { save_card: document.getElementById('save').checked }); location.href = r.url; }
    catch (x) { e.target.classList.remove('busy'); document.getElementById('err').textContent = x.message; }
  });
  if (paidNow && !paid) setTimeout(() => location.replace(location.pathname), 4000);
}

async function quotePage(token) {
  const d = await api('GET', `/quote/${token}`), q = d.quote;
  const done = q.status !== 'sent';
  root.innerHTML = shell(d.company, esc(q.title), `Prepared for ${esc(d.customer_name)}${q.pool_name ? ' · ' + esc(q.pool_name) : ''}`,
    `<div class="card" style="padding:0;overflow:hidden;position:relative">${q.status === 'approved' ? '<div class="stamp ok">APPROVED</div>' : q.status === 'declined' ? '<div class="stamp bad">DECLINED</div>' : ''}
      ${q.note ? `<p style="padding:18px 20px 0;margin:0">${esc(q.note)}</p>` : ''}<div style="overflow-x:auto">${itemsTable(q.items, q.total, 0, q.total)}</div>
      <div style="padding:20px">${done ? `<p class="muted" style="margin:0">${q.status === 'approved' ? 'Thank you! We’ll be in touch to schedule the work.' : 'You declined this quote. Reply to us any time if you change your mind.'}</p>`
        : `<p class="muted small" style="margin-top:0">${d.tax_rate ? `Sales tax (${d.tax_rate}%) is added to parts and materials when invoiced.` : ''}</p><label>Your name (acts as your signature)<input id="sig" autocomplete="name"></label>
          <div class="row mt"><button class="btn primary big grow" id="ok">Approve quote</button><button class="btn big" id="no">Decline</button></div><div class="error" id="err"></div>`}</div></div>`);
  const respond = async (action) => {
    try { const r = await api('POST', `/quote/${token}/respond`, { action, name: document.getElementById('sig')?.value }); if (action === 'approve') confetti(); await quotePage(token); }
    catch (x) { document.getElementById('err').textContent = x.message; }
  };
  document.getElementById('ok')?.addEventListener('click', () => { if (!document.getElementById('sig').value.trim()) return (document.getElementById('err').textContent = 'Please type your name to approve.'); respond('approve'); });
  document.getElementById('no')?.addEventListener('click', () => respond('decline'));
}

const [, kind, token] = location.pathname.split('/');
(async () => {
  try {
    if (kind === 'pay') await payPage(token);
    else if (kind === 'quote') await quotePage(token);
    else if (kind === 'portal' && window.portalPage) await window.portalPage(token);
    else throw new Error('Page not found');
  } catch (e) {
    root.innerHTML = `<div class="pub"><div class="pubin"><div class="card empty" style="margin-top:80px"><b>This link isn't valid</b>${esc(e.message)}<div class="muted small mt">It may have expired or been mistyped. Please contact your pool service.</div></div></div></div>`;
  }
})();
