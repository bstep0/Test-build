'use strict';
// Stripe Checkout (pay an invoice by card), signed webhooks, and optional autopay with a saved card.
// Talks to Stripe's REST API directly; enabled only when STRIPE_SECRET_KEY is set.
const crypto = require('node:crypto');

// Stripe expects form-encoded nested keys: a[b][0][c]=1
function flatten(obj, prefix = '', out = []) {
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}[${k}]` : k;
    if (v === undefined || v === null) continue;
    if (typeof v === 'object') flatten(v, key, out); else out.push([key, String(v)]);
  }
  return out;
}

function verifySignature(raw, header, secret, toleranceSec = 300, now = Date.now()) {
  if (!header || !secret) return false;
  const parts = Object.fromEntries(header.split(',').map((p) => p.split('=')).filter((p) => p.length === 2).map(([k, v]) => [k.trim(), v]));
  const sigs = header.split(',').filter((p) => p.trim().startsWith('v1=')).map((p) => p.trim().slice(3));
  if (!parts.t || !sigs.length || Math.abs(now / 1000 - Number(parts.t)) > toleranceSec) return false;
  const expected = crypto.createHmac('sha256', secret).update(`${parts.t}.${raw}`).digest('hex');
  return sigs.some((s) => s.length === expected.length && crypto.timingSafeEqual(Buffer.from(s), Buffer.from(expected)));
}

function register(ctx) {
  const { route, one, run, bad, HttpError, notFound, opts, invoiceFull, markPaid, baseUrl, hooks, getSettings } = ctx;
  const key = () => opts.stripeKey ?? process.env.STRIPE_SECRET_KEY;
  const whsec = () => opts.stripeWebhookSecret ?? process.env.STRIPE_WEBHOOK_SECRET;
  const doFetch = (...a) => (opts.stripeFetch || fetch)(...a);
  async function stripe(method, path, params) {
    const r = await doFetch('https://api.stripe.com/v1' + path, {
      method, headers: { Authorization: 'Bearer ' + key(), 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params ? new URLSearchParams(flatten(params)).toString() : undefined,
    });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error?.message || 'Stripe error ' + r.status);
    return j;
  }
  const cents = (n) => Math.round(n * 100);
  const company = () => { const s = getSettings(); return { name: s.company_name || 'Your pool service', email: s.company_email, phone: s.company_phone, footer: s.invoice_footer }; };
  const byToken = (token) => {
    const inv = one('SELECT id FROM invoices WHERE token=?', token);
    if (!inv) throw notFound('That payment link is not valid');
    return invoiceFull(inv.id);
  };

  route('GET', '/api/stripe/config', ({ req }) => ({ enabled: !!key(), webhookConfigured: !!whsec(), webhookUrl: `${baseUrl(req)}/api/stripe/webhook` }));

  route('GET', '/api/public/pay/:token', ({ params }) => {
    const i = byToken(params.token);
    return { invoice: { id: i.id, customer_name: i.customer_name, issued: i.issued, due: i.due, items: i.items, subtotal: i.subtotal, tax: i.tax, total: i.total, status: i.status, paid_at: i.paid_at },
      company: company(), payable: !!key() && i.status === 'open' };
  });
  route('POST', '/api/public/pay/:token/checkout', async ({ params, body, req }) => {
    if (!key()) throw bad('Online payments are not set up yet — please contact us to pay');
    const i = byToken(params.token);
    if (i.status !== 'open') throw bad('This invoice has already been paid');
    const base = baseUrl(req), save = !!body.save_card;
    const session = await stripe('POST', '/checkout/sessions', {
      mode: 'payment', client_reference_id: String(i.id), customer_email: i.email || undefined,
      success_url: `${base}/pay/${i.token}?paid=1`, cancel_url: `${base}/pay/${i.token}`,
      line_items: [{ quantity: 1, price_data: { currency: 'usd', unit_amount: cents(i.total), product_data: { name: `Invoice #${i.id} — ${company().name}` } } }],
      metadata: { invoice_id: i.id, save_card: save ? '1' : '0', customer_id: i.customer_id },
      ...(save ? { customer_creation: 'always', payment_intent_data: { setup_future_usage: 'off_session' } } : {}),
    });
    run('UPDATE invoices SET stripe_session=? WHERE id=?', session.id, i.id);
    return { url: session.url };
  });

  route('POST', '/api/stripe/webhook', async ({ req, rawBody }) => {
    if (!whsec()) throw bad('Webhook secret is not configured');
    if (!verifySignature(rawBody, req.headers['stripe-signature'], whsec())) throw new HttpError(400, 'Bad signature');
    const event = JSON.parse(rawBody);
    if (event.type === 'checkout.session.completed') {
      const s = event.data.object, invoiceId = Number(s.metadata?.invoice_id);
      if (invoiceId && s.payment_status === 'paid' && one('SELECT id FROM invoices WHERE id=?', invoiceId)) {
        markPaid(invoiceId, 'Card (Stripe)');
        if (s.metadata?.save_card === '1' && s.customer && s.payment_intent && s.metadata.customer_id) {
          try {
            const pi = await stripe('GET', '/payment_intents/' + s.payment_intent);
            if (pi.payment_method) run('UPDATE customers SET stripe_customer=?, stripe_pm=?, autopay=1 WHERE id=?', s.customer, pi.payment_method, Number(s.metadata.customer_id));
          } catch { /* card stays unsaved; the payment itself is already recorded */ }
        }
      }
    }
    return { received: true };
  });

  async function chargeSavedCard(inv) {
    const c = one('SELECT * FROM customers WHERE id=?', inv.customer_id);
    if (!key() || !c?.stripe_customer || !c?.stripe_pm) throw bad('No saved card on file for this customer');
    if (inv.status !== 'open') throw bad('Invoice is not open');
    const pi = await stripe('POST', '/payment_intents', { amount: cents(inv.total), currency: 'usd', customer: c.stripe_customer, payment_method: c.stripe_pm,
      off_session: 'true', confirm: 'true', description: `Invoice #${inv.id}`, metadata: { invoice_id: inv.id } });
    if (pi.status !== 'succeeded') throw new Error('Card payment status: ' + pi.status);
    markPaid(inv.id, 'Autopay (Stripe)');
    return true;
  }
  hooks.invoiceCreated.push(async (inv) => {
    if (inv.autopay && key()) {
      try { await chargeSavedCard(inv); }
      catch (e) { ctx.sendMessage?.({ customer_id: inv.customer_id, channels: ['email'], kind: 'payment_failed', subject: `Payment for invoice #${inv.id} didn't go through`, body: `We couldn't charge your saved card for invoice #${inv.id}. Please use the payment link to pay.` }); }
    }
  });
  route('POST', '/api/invoices/:id/charge', async ({ params, req }) => {
    const inv = invoiceFull(params.id);
    try { await chargeSavedCard(inv); } catch (e) { throw e instanceof HttpError ? e : bad(e.message); }
    return invoiceFull(params.id, req);
  });
}

module.exports = { register, verifySignature, flatten };
