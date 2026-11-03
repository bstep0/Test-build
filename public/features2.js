'use strict';
/* Money & stock screens: invoices, quotes, inventory, business settings. Loaded after ui.js/features.js. */

// ───────── customer billing fields ─────────
CUSTOMER_FIELDS.push(
  { name: 'billing_mode', label: 'Billing', type: 'select', options: [['visit', 'Per visit'], ['monthly', 'Flat monthly fee']] },
  { name: 'monthly_rate', label: 'Monthly fee ($)', type: 'number', step: '0.01' },
  { name: 'taxable', label: 'Charge sales tax', type: 'checkbox' },
  { name: 'autopay', label: 'Autopay with saved card (turn off to stop)', type: 'checkbox' },
);
const stampHtml = (text, cls = 'ok') => html`<div class="stamp ${cls}">${text}</div>`;
const dueBadge = (i, today = localISO()) => html`<span class="badge ${i.status === 'paid' ? 'ok' : i.due < today ? 'bad' : 'warn'}">${i.status === 'open' && i.due < today ? 'overdue' : i.status === 'open' ? 'unpaid' : i.status}</span>`;

// ───────── invoices ─────────
let invFilter2 = '';
live.invFilter = (e) => { invFilter2 = e.target.value; render(); };
views.invoices = async (id) => {
  const st = await settings();
  if (id) {
    const [i, cfg] = await Promise.all([GET('/invoices/' + id), GET('/stripe/config').catch(() => ({}))]);
    const overdue = i.status === 'open' && i.due < localISO();
    return html`<p class="small noprint"><a href="#/invoices">‹ Invoices</a></p>
    <div class="card invoice">${i.status === 'paid' ? stampHtml('PAID') : overdue ? stampHtml('OVERDUE', 'bad') : ''}
      <div class="row spread" style="align-items:flex-start"><div><div class="row" style="gap:10px"><span class="logo">${icon('wave')}</span><b style="font-size:18px;letter-spacing:-.02em">${st.company_name || 'SplashDesk'}</b></div>
        <div class="muted small mt">${[st.company_email, st.company_phone].filter(Boolean).join(' · ')}</div></div>
        <div class="right"><h1 style="font-size:28px">Invoice #${i.id}</h1><div class="muted small">Issued ${fmtDate(i.issued)}<br>Due ${fmtDate(i.due)}</div></div></div>
      <div class="mt"><div class="muted small" style="font-weight:700;letter-spacing:.08em;text-transform:uppercase">Bill to</div><b>${i.customer_name}</b><div class="muted">${i.address}${i.city ? ', ' + i.city : ''}</div></div>
      <table style="margin-top:18px"><thead><tr><th>Description</th><th class="right">Qty</th><th class="right">Price</th><th class="right">Amount</th></tr></thead><tbody>
        ${i.items.map((x) => html`<tr><td>${x.desc}${x.taxable ? html` <span class="chip" style="padding:0 6px;font-size:10.5px">tax</span>` : ''}</td><td class="right">${x.qty}</td><td class="right">${money(x.price)}</td><td class="right">${money(x.qty * x.price)}</td></tr>`)}
        <tr><td colspan="3" class="right muted">Subtotal</td><td class="right">${money(i.subtotal || i.total)}</td></tr>
        ${i.tax ? html`<tr><td colspan="3" class="right muted">Sales tax (${st.tax_rate}%)</td><td class="right">${money(i.tax)}</td></tr>` : ''}
        <tr><td colspan="3" class="right"><b>Total due</b></td><td class="right"><b style="font-size:22px">${money(i.total)}</b></td></tr></tbody></table>
      ${i.status === 'paid' ? html`<p class="mt" style="color:var(--ok);font-weight:700">Paid ${fmtDate(i.paid_at)}${i.method ? ' · ' + i.method : ''}</p>` : ''}
      ${st.invoice_footer ? html`<p class="muted small mt">${st.invoice_footer}</p>` : ''}
      <div class="row mt noprint">
        ${i.status === 'open' ? html`<button class="btn primary" data-act="payInvoice" data-id="${i.id}">Record payment</button>${i.autopay ? html`<button class="btn" data-act="chargeCard" data-id="${i.id}">Charge saved card</button>` : ''}` : html`<button class="btn" data-act="reopenInvoice" data-id="${i.id}">Mark unpaid</button>`}
        ${i.pay_url ? html`<button class="btn" data-act="copyLink" data-url="${i.pay_url}">${icon('copy')} Copy pay link</button>` : ''}
        <button class="btn" data-act="print">Print / PDF</button>
        ${i.email ? html`<button class="btn" data-act="emailInvoice" data-id="${i.id}">${icon('mail')} Email to customer</button>` : ''}
        <span class="grow"></span><button class="btn danger" data-act="voidInvoice" data-id="${i.id}">Void</button></div>
      ${i.pay_url && !cfg.enabled ? html`<p class="muted small noprint">Online card payments aren't set up. Add a Stripe key in your server settings to let customers pay from the link.</p>` : ''}</div>`;
  }
  const [list, custs] = await Promise.all([GET('/invoices' + (invFilter2 ? '?status=' + invFilter2 : '')), GET('/customers')]);
  const today = localISO(), open = list.filter((i) => i.status === 'open'), od = open.filter((i) => i.due < today);
  const sum = (a) => a.reduce((s, i) => s + i.total, 0);
  return html`${pageHead('Invoices', `${custs.length} customers · bill completed work in one click`, html`<div class="seg">${[['', 'All'], ['open', 'Unpaid'], ['paid', 'Paid']].map(([k, l]) => html`<button class="${k === invFilter2 ? 'on' : ''}" data-act="invFilter" data-v="${k}">${l}</button>`)}</div>
    <a class="btn" href="/api/export/invoices.csv" download>${icon('download')} Export CSV</a><button class="btn primary" data-act="invoiceAll">${icon('zap')} Bill all customers</button>`)}
  <div class="grid stagger">
    <div class="card kpi warn"><div class="ico">${icon('clock')}</div><div><div class="n">${countUp(sum(open), 'money')}</div><div class="l">${open.length} unpaid</div></div></div>
    <div class="card kpi ${od.length ? 'bad' : ''}"><div class="ico">${icon('alert')}</div><div><div class="n">${countUp(sum(od), 'money')}</div><div class="l">${od.length} overdue</div></div></div>
    <div class="card kpi ok"><div class="ico">${icon('check')}</div><div><div class="n">${countUp(sum(list.filter((i) => i.status === 'paid')), 'money')}</div><div class="l">Paid</div></div></div></div>
  <div class="mt">${list.length ? html`<div class="card flush" style="overflow-x:auto"><table><thead><tr><th>Invoice</th><th>Customer</th><th class="hide-sm">Issued</th><th class="hide-sm">Due</th><th class="right">Total</th><th>Status</th></tr></thead><tbody>
    ${list.map((i) => html`<tr class="click" data-href="#/invoices/${i.id}"><td><b>#${i.id}</b></td><td><div class="row" style="gap:10px;flex-wrap:nowrap">${avatar(i.customer_name, 30)}<b>${i.customer_name}</b></div></td><td class="hide-sm">${fmtDate(i.issued)}</td><td class="hide-sm">${fmtDate(i.due)}</td><td class="right"><b>${money(i.total)}</b></td><td>${dueBadge(i, today)}</td></tr>`)}</tbody></table></div>`
    : emptyState('No invoices yet', 'Complete some visits, then bill them from a customer page or all at once.', html`<button class="btn primary" data-act="invoiceAll">${icon('zap')} Bill all customers</button>`)}</div>`;
};
actions.invFilter = ({ v }) => { invFilter2 = v; render(); };
actions.copyLink = async ({ url }) => { try { await navigator.clipboard.writeText(url); toast('Link copied'); } catch { prompt('Copy this link:', url); } };
actions.chargeCard = async ({ id }) => { if (!confirm('Charge the customer’s saved card now?')) return; await POST(`/invoices/${id}/charge`); toast('Card charged — invoice paid'); confetti(); render(); };
actions.emailInvoice = async ({ id }) => { const r = await POST(`/invoices/${id}/email`); toast(r.status === 'sent' ? 'Invoice emailed' : 'Queued in Outbox (email provider not connected)', false); };
actions.invoiceAll = async () => {
  const custs = await GET('/customers'); let n = 0;
  for (const c of custs) { try { await POST('/invoices/generate', { customer_id: c.id, period: localISO().slice(0, 7) }); n++; } catch { /* nothing to bill */ } }
  toast(n ? `Created ${n} invoice${n > 1 ? 's' : ''}` : 'Nothing to invoice', !n); render();
};

// ───────── quotes ─────────
const QSTATUS = { draft: ['', 'Draft'], sent: ['warn', 'Awaiting reply'], approved: ['ok', 'Approved'], declined: ['bad', 'Declined'] };
const qRow = (it = {}) => html`<div class="chem qrow" style="grid-template-columns:3fr 70px 100px auto"><input placeholder="Description" data-q="desc" value="${it.desc}"><input placeholder="Qty" inputmode="decimal" data-q="qty" value="${it.qty ?? 1}"><input placeholder="Price" inputmode="decimal" data-q="price" value="${it.price}"><button type="button" class="btn sm" data-act="rmQRow" aria-label="Remove">✕</button></div>`;
const readQ = () => [...document.querySelectorAll('#qitems .qrow')].map((r) => ({ desc: r.querySelector('[data-q=desc]').value, qty: Number(r.querySelector('[data-q=qty]').value || 1), price: Number(r.querySelector('[data-q=price]').value || 0) })).filter((i) => i.desc.trim());
const qTotal = () => { const t = readQ().reduce((s, i) => s + i.qty * i.price, 0); const el = $('#qtotal'); if (el) el.textContent = money(t); };
live.qitems = qTotal;
actions.addQRow = () => { $('#qitems').insertAdjacentHTML('beforeend', qRow().s); };
actions.rmQRow = (_, el) => { el.closest('.qrow').remove(); qTotal(); };
views.quotes = async () => {
  const list = await GET('/quotes'), money_ = (s) => list.filter((q) => q.status === s).reduce((a, q) => a + q.total, 0);
  return html`${pageHead('Quotes', 'Send estimates customers approve with one click — approved quotes become work orders.', html`<button class="btn primary" data-act="newQuote">${icon('plus')} New quote</button>`)}
  <div class="grid stagger">${[['sent', 'Awaiting reply', 'clock', 'warn'], ['approved', 'Approved', 'check', 'ok'], ['declined', 'Declined', 'alert', '']].map(([k, l, ic, cls]) => html`<div class="card kpi ${cls}"><div class="ico">${icon(ic)}</div><div><div class="n">${countUp(money_(k), 'money')}</div><div class="l">${l} · ${list.filter((q) => q.status === k).length}</div></div></div>`)}</div>
  <div class="mt">${list.length ? html`<div class="card flush" style="overflow-x:auto"><table><thead><tr><th>Quote</th><th>Customer</th><th class="right">Total</th><th>Status</th><th class="hide-sm">Created</th></tr></thead><tbody>
    ${list.map((q) => html`<tr class="click" data-act="openQuote" data-id="${q.id}"><td><b>${q.title}</b></td><td><div class="row" style="gap:10px;flex-wrap:nowrap">${avatar(q.customer_name, 30)}${q.customer_name}</div></td><td class="right"><b>${money(q.total)}</b></td>
      <td><span class="badge ${QSTATUS[q.status][0]}">${QSTATUS[q.status][1]}</span></td><td class="hide-sm muted">${fmtDate(q.created_at)}</td></tr>`)}</tbody></table></div>`
    : emptyState('No quotes yet', 'Quote a repair or upgrade and let the customer approve it online.', html`<button class="btn primary" data-act="newQuote">${icon('plus')} New quote</button>`)}</div>`;
};
async function quoteForm(q) {
  const [pools] = await Promise.all([GET('/pools')]);
  if (!pools.length) return toast('Add a customer and pool first', true);
  const locked = q && !['draft', 'sent'].includes(q.status);
  openForm({
    title: q ? `Quote: ${q.title}` : 'New quote', saveLabel: q ? 'Save changes' : 'Save draft', values: q || {},
    message: q ? html`<span class="badge ${QSTATUS[q.status][0]}">${QSTATUS[q.status][1]}</span> ${q.status === 'approved' ? 'Approved — a work order was created.' : ''}` : html`Add line items; the customer sees the total (tax is added at invoicing).`,
    fields: locked ? [] : [{ name: 'pool_id', label: 'Customer & pool', type: 'select', int: true, full: true, options: pools.map((p) => [p.id, `${p.customer_name} — ${p.name}`]) },
      { name: 'title', label: 'Title', required: true, full: true }, { name: 'note', label: 'Note to customer', type: 'textarea', full: true }],
    footer: html`<div data-live="qitems" style="margin-top:14px"><label>Line items</label><div id="qitems" style="margin-top:6px">${(q?.items?.length ? q.items : [{}]).map(qRow)}</div>
      ${locked ? '' : html`<button type="button" class="btn sm" data-act="addQRow">${icon('plus')} Add line</button>`}<div class="right mt"><span class="muted">Total </span><b id="qtotal" style="font-size:20px">${money(q?.total || 0)}</b></div>
      ${q ? html`<div class="row mt"><button type="button" class="btn accent" data-act="sendQuote" data-id="${q.id}" ${raw(locked ? 'disabled' : '')}>${icon('send')} ${q.status === 'sent' ? 'Resend to customer' : 'Send to customer'}</button><button type="button" class="btn" data-act="copyLink" data-url="${q.public_url}">${icon('copy')} Copy link</button></div>` : ''}</div>`,
    onSave: async (d) => {
      if (locked) return;
      const items = readQ(); if (!items.length) throw new Error('Add at least one line item');
      if (q) await PUT('/quotes/' + q.id, { ...d, items });
      else { const pool = pools.find((p) => p.id === d.pool_id); await POST('/quotes', { ...d, customer_id: pool.customer_id, items }); }
    },
    onDelete: q ? () => DEL('/quotes/' + q.id) : undefined,
  });
}
actions.newQuote = () => quoteForm();
actions.openQuote = async ({ id }) => quoteForm(await GET('/quotes/' + id));
actions.sendQuote = async ({ id }) => { const items = readQ(); if (items.length) await PUT('/quotes/' + id, { items, title: $('#mform [name=title]')?.value, note: $('#mform [name=note]')?.value }); const q = await POST(`/quotes/${id}/send`); modal.close(); toast('Quote sent'); render(); };

// ───────── inventory ─────────
const PROD_FIELDS = [{ name: 'name', label: 'Product', required: true, full: true }, { name: 'unit', label: 'Unit (gal, lb, each…)' }, { name: 'stock', label: 'In stock', type: 'number', step: 'any' },
  { name: 'cost', label: 'Your cost per unit ($)', type: 'number', step: '0.01' }, { name: 'price', label: 'Customer price per unit ($)', type: 'number', step: '0.01' }, { name: 'low_stock', label: 'Low-stock alert at', type: 'number', step: 'any' }, { name: 'active', label: 'Active', type: 'checkbox' }];
views.inventory = async () => {
  const list = await GET('/products'), value = list.reduce((s, p) => s + p.stock * p.cost, 0), low = list.filter((p) => p.low && p.active).length;
  return html`${pageHead('Inventory', 'Track chemicals and parts. Stock drops automatically when visits are completed.', html`<button class="btn primary" data-act="newProduct">${icon('plus')} Add product</button>`)}
  <div class="grid stagger"><div class="card kpi"><div class="ico">${icon('box')}</div><div><div class="n">${countUp(list.length)}</div><div class="l">Products</div></div></div>
    <div class="card kpi ${low ? 'bad' : 'ok'}"><div class="ico">${icon('alert')}</div><div><div class="n">${countUp(low)}</div><div class="l">Low on stock</div></div></div>
    <div class="card kpi ok"><div class="ico">${icon('dollar')}</div><div><div class="n">${countUp(value, 'money')}</div><div class="l">Stock value at cost</div></div></div></div>
  <div class="mt">${list.length ? html`<div class="card flush" style="overflow-x:auto"><table><thead><tr><th>Product</th><th>Stock</th><th class="hide-sm right">Cost</th><th class="hide-sm right">Price</th><th class="hide-sm right">Margin</th><th></th></tr></thead><tbody>
    ${list.map((p) => { const m = p.price ? Math.round(((p.price - p.cost) / p.price) * 100) : 0; return html`<tr ${raw(p.active ? '' : 'style="opacity:.55"')}><td><b>${p.name}</b> ${p.active ? '' : raw('<span class="badge">inactive</span>')}</td>
      <td><span class="badge ${p.low ? 'bad' : 'ok'}">${+p.stock.toFixed(2)} ${p.unit}</span>${p.low ? html` <span class="small" style="color:var(--bad);font-weight:700">low</span>` : ''}</td>
      <td class="hide-sm right">${money(p.cost)}</td><td class="hide-sm right">${money(p.price)}</td><td class="hide-sm right"><b>${m}%</b></td>
      <td class="right"><button class="btn sm" data-act="adjustStock" data-id="${p.id}">Adjust</button> <button class="btn sm" data-act="editProduct" data-id="${p.id}">Edit</button></td></tr>`; })}</tbody></table></div>`
    : emptyState('No products yet', 'Add the chemicals you use to track stock and margin.', html`<button class="btn primary" data-act="newProduct">${icon('plus')} Add product</button>`)}</div>`;
};
actions.newProduct = () => openForm({ title: 'Add product', fields: PROD_FIELDS, values: { unit: 'gal', active: 1, stock: 0, cost: 0, price: 0, low_stock: 0 }, onSave: (d) => POST('/products', d) });
actions.editProduct = async ({ id }) => openForm({ title: 'Edit product', fields: PROD_FIELDS, values: (await GET('/products')).find((p) => p.id == id), onSave: (d) => PUT('/products/' + id, d), onDelete: () => DEL('/products/' + id) });
actions.adjustStock = async ({ id }) => { const p = (await GET('/products')).find((x) => x.id == id);
  openForm({ title: `Adjust stock: ${p.name}`, saveLabel: 'Apply', message: html`Currently <b>${p.stock} ${p.unit}</b>. Enter a positive number to add stock (a delivery) or negative to remove (spill, count correction).`,
    fields: [{ name: 'delta', label: `Change (${p.unit})`, type: 'number', step: 'any', required: true, full: true }], onSave: (d) => POST(`/products/${id}/adjust`, d) }); };

// ───────── business & billing settings ─────────
const baseSettings2 = views.settings;
views.settings = async () => {
  const base = await baseSettings2();
  if (me.role !== 'owner') return base;
  const [st, cfg] = await Promise.all([settings(), GET('/stripe/config').catch(() => ({}))]);
  return html`${base}<h2>Business &amp; billing</h2><div class="split">
    <form id="bform" class="card"><h3>Company &amp; invoices</h3><div class="fields mt">
      <label class="full">Company name<input name="company_name" value="${st.company_name}"></label>
      <label>Email<input name="company_email" type="email" value="${st.company_email}"></label><label>Phone<input name="company_phone" type="tel" value="${st.company_phone}"></label>
      <label>Sales tax (%)<input name="tax_rate" type="number" step="0.001" min="0" max="30" value="${st.tax_rate}"></label><label>Payment terms (days)<input name="due_days" type="number" min="1" value="${st.due_days}"></label>
      <label class="check full"><input type="checkbox" name="tax_services" ${raw(st.tax_services ? 'checked' : '')}> Also charge tax on service labor (chemicals and repairs are always taxed)</label>
      <label class="full">Invoice footer<textarea name="invoice_footer" rows="2" placeholder="Thanks for your business! Pay by card at the link above.">${st.invoice_footer}</textarea></label>
      <label class="full">Days with no service (holidays)<textarea name="skip_dates" rows="2" placeholder="2026-12-25, 2027-01-01">${(st.skip_dates || []).join(', ')}</textarea><span class="muted small">Comma-separated YYYY-MM-DD. Routes skip these dates.</span></label></div>
      <div class="row mt"><button class="btn primary">Save</button></div></form>
    <div class="card"><h3>Integrations</h3>
      <div class="row mt" style="gap:12px"><span class="badge ${cfg.enabled ? 'ok' : ''}">Stripe ${cfg.enabled ? 'connected' : 'not connected'}</span><span class="badge ${cfg.webhookConfigured ? 'ok' : ''}">Webhook ${cfg.webhookConfigured ? 'ready' : 'not set'}</span></div>
      <p class="muted small mt">Set <code>STRIPE_SECRET_KEY</code> and <code>STRIPE_WEBHOOK_SECRET</code> on your server, then add this webhook endpoint in Stripe (event: <code>checkout.session.completed</code>):</p>
      <div class="row"><code style="word-break:break-all;background:var(--chip);padding:6px 10px;border-radius:8px;font-size:12px">${cfg.webhookUrl}</code><button class="btn sm" data-act="copyLink" data-url="${cfg.webhookUrl}">${icon('copy')}</button></div>
      <div class="mt"><label>Road-routing server (optional)<input id="osrm" value="${st.osrm_url}" placeholder="https://router.project-osrm.org"><span class="muted small">Uses real road distances for the optimizer. Leave blank for straight-line estimates.</span></label>
      <button class="btn sm mt" data-act="saveOsrm">Save routing server</button></div>
      <div class="row mt"><a class="btn sm" href="/api/export/payments.csv" download>${icon('download')} Payments CSV</a><a class="btn sm" href="/api/export/customers.csv" download>${icon('download')} Customers CSV</a></div></div></div>`;
};
document.addEventListener('submit', guard(async (e) => {
  if (e.target.id !== 'bform') return;
  e.preventDefault(); const f = e.target;
  await PUT('/settings', { company_name: f.company_name.value, company_email: f.company_email.value, company_phone: f.company_phone.value, tax_rate: f.tax_rate.value || 0,
    due_days: f.due_days.value, tax_services: +f.tax_services.checked, invoice_footer: f.invoice_footer.value, skip_dates: f.skip_dates.value });
  settingsCache = null; toast('Business settings saved'); render();
}));
actions.saveOsrm = async () => { await PUT('/settings', { osrm_url: $('#osrm').value.trim() }); settingsCache = null; toast('Routing server saved'); };
