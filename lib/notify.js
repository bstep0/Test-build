'use strict';
// Customer messaging: every message is recorded in the outbox, then delivered by email (Resend) and/or SMS (Twilio)
// when credentials are configured. Without credentials messages are logged, so nothing is silently lost.
function register(ctx) {
  const { db, route, one, all, run, bad, notFound, opts, hooks, baseUrl, getSettings, invoiceFull, VISIT_SELECT, VJSON, parseJson, utcToday, addDays } = ctx;
  const doFetch = (...a) => (opts.mailFetch || fetch)(...a);
  const env = (k) => opts[k] ?? process.env[k.toUpperCase()];
  const company = () => getSettings().company_name || 'Your pool service';

  async function deliver(row) {
    const fail = (error) => run(`UPDATE outbox SET status='failed', error=? WHERE id=?`, String(error).slice(0, 300), row.id);
    try {
      if (row.channel === 'email') {
        const key = env('resend_api_key');
        if (!key) return run(`UPDATE outbox SET status='logged', error='No email provider configured (set RESEND_API_KEY)' WHERE id=?`, row.id);
        const r = await doFetch('https://api.resend.com/emails', { method: 'POST', headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' },
          body: JSON.stringify({ from: env('email_from') || 'SplashDesk <onboarding@resend.dev>', to: [row.to_addr], subject: row.subject, text: row.body, reply_to: getSettings().company_email || undefined }) });
        if (!r.ok) return fail('Email provider returned ' + r.status);
      } else {
        const sid = env('twilio_account_sid'), tok = env('twilio_auth_token'), from = env('twilio_from');
        if (!sid || !tok || !from) return run(`UPDATE outbox SET status='logged', error='No SMS provider configured (set TWILIO_*)' WHERE id=?`, row.id);
        const r = await doFetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, { method: 'POST',
          headers: { Authorization: 'Basic ' + Buffer.from(`${sid}:${tok}`).toString('base64'), 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({ To: row.to_addr, From: from, Body: row.body.slice(0, 600) }).toString() });
        if (!r.ok) return fail('SMS provider returned ' + r.status);
      }
      run(`UPDATE outbox SET status='sent', error='' WHERE id=?`, row.id);
    } catch (e) { fail(e.message); }
  }

  // Queue + deliver a message. Either `customer_id` (uses their contact details and notification preferences)
  // or an explicit `to` + `channel`. Resolves to the outbox rows created (delivery runs in the background).
  ctx.sendMessage = ({ customer_id, to, channel = 'email', channels = ['email', 'sms'], subject = '', body, kind = '' }) => {
    const targets = [];
    if (customer_id) {
      const c = one('SELECT email, phone, notify_email, notify_sms FROM customers WHERE id=?', customer_id);
      if (c?.email && c.notify_email && channels.includes('email')) targets.push(['email', c.email]);
      if (c?.phone && c.notify_sms && channels.includes('sms')) targets.push(['sms', c.phone]);
    } else if (to) targets.push([channel, to]);
    const rows = targets.map(([ch, addr]) => {
      const id = Number(run('INSERT INTO outbox (channel, to_addr, subject, body, kind) VALUES (?,?,?,?,?)', ch, addr, ch === 'email' ? subject : '', body, kind).lastInsertRowid);
      return one('SELECT * FROM outbox WHERE id=?', id);
    });
    const done = Promise.all(rows.map(deliver));
    ctx.pendingMail = done;                    // lets tests await delivery
    return rows;
  };

  const portalUrl = (req, customerId) => {
    let c = one('SELECT portal_token FROM customers WHERE id=?', customerId);
    if (!c.portal_token) { const t = require('node:crypto').randomBytes(16).toString('hex'); run('UPDATE customers SET portal_token=? WHERE id=?', t, customerId); c = { portal_token: t }; }
    return `${baseUrl(req)}/portal/${c.portal_token}`;
  };
  ctx.portalUrl = portalUrl;

  // ---- automatic messages ----
  hooks.visitDone.push(async (v) => {
    if (!getSettings().auto_reports) return;
    const cust = one('SELECT id, name, email, notify_email FROM customers WHERE id=?', v.customer_id);
    if (!cust?.email || !cust.notify_email) return;
    const issues = require('../public/dosing').analyze(v.volume_gal, v);
    const lines = issues.map((i) => `  • ${i.label}: ${i.value}${i.unit ? ' ' + i.unit : ''}${i.status === 'ok' ? '' : ` (${i.status})`}`);
    const body = [`Hi ${cust.name},`, '', `Your pool was serviced today by ${v.tech_name || 'our team'}.`, '', lines.length ? 'Water test:' : '', ...lines, '',
      v.tasks?.length ? 'Completed: ' + v.tasks.join(', ') : '', v.chemicals?.length ? 'Added: ' + v.chemicals.map((c) => `${c.qty || ''} ${c.unit || ''} ${c.name}`.trim()).join(', ') : '', v.notes ? 'Notes: ' + v.notes : '', '',
      `See your full service history anytime: ${portalUrl(ctx.currentReq || { headers: { host: 'localhost' } }, cust.id)}`, '', `— ${company()}`].filter((l, i, a) => l !== '' || a[i - 1] !== '').join('\n');
    ctx.sendMessage({ customer_id: cust.id, channels: ['email'], kind: 'service_report', subject: `Pool service report — ${v.date}`, body });
    run('UPDATE visits SET report_sent_at=datetime(\'now\') WHERE id=?', v.id);
  });
  hooks.invoiceCreated.push(async (inv, req) => {
    if (!getSettings().auto_invoice_email || inv.status === 'paid') return;
    ctx.sendMessage({ customer_id: inv.customer_id, channels: ['email'], channels: ['email'], kind: 'invoice', subject: `Invoice #${inv.id} from ${company()} — ${inv.total.toFixed(2)} due ${inv.due}`,
      body: `Hi ${inv.customer_name},\n\nYour invoice #${inv.id} for $${inv.total.toFixed(2)} is ready (due ${inv.due}).\nView and pay online: ${inv.pay_url || baseUrl(req) + '/pay/' + inv.token}\n\nThank you!\n— ${company()}` });
  });

  route('POST', '/api/invoices/:id/email', ({ params, req }) => {
    const inv = invoiceFull(params.id, req);
    const rows = ctx.sendMessage({ customer_id: inv.customer_id, channels: ['email'], kind: 'invoice', subject: `Invoice #${inv.id} from ${company()} — $${inv.total.toFixed(2)}`,
      body: `Hi ${inv.customer_name},\n\nHere is invoice #${inv.id} for $${inv.total.toFixed(2)} (due ${inv.due}).\n${inv.pay_url ? 'View and pay online: ' + inv.pay_url + '\n' : ''}\nThank you!\n— ${company()}` });
    if (!rows.length) throw bad('This customer has no email address (or has email notifications turned off)');
    return { status: rows[0].status, queued: rows.length };
  });
  route('POST', '/api/visits/:id/eta', ({ params, user }) => {
    const v = parseJson(one(`${VISIT_SELECT} WHERE v.id=?`, params.id), VJSON);
    if (!v) throw notFound();
    if (user.role === 'tech' && v.tech_id !== user.tech_id) throw new ctx.HttpError(403, 'That stop is not assigned to you');
    const pref = one('SELECT phone, notify_sms FROM customers WHERE id=?', v.customer_id);
    const rows = ctx.sendMessage({ customer_id: v.customer_id, kind: 'eta', channels: pref?.notify_sms && pref.phone ? ['sms'] : ['email'], subject: `${v.tech_name || 'Your technician'} is on the way`,
      body: `Hi ${v.customer_name}, ${v.tech_name || 'your technician'} from ${company()} is heading to your pool now.` });
    run(`UPDATE visits SET eta_sent_at=datetime('now') WHERE id=?`, v.id);
    return { sent: rows.length };
  });

  // Overdue-invoice reminders: at most once a week per invoice.
  ctx.runReminders = () => {
    if (!getSettings().auto_reminders) return { sent: 0 };
    const today = utcToday(), cutoff = addDays(today, -7);
    const due = all(`SELECT id FROM invoices WHERE status='open' AND due < ? AND (reminded_at IS NULL OR substr(reminded_at,1,10) <= ?)`, today, cutoff);
    let sent = 0;
    for (const { id } of due) {
      const inv = invoiceFull(id);
      const rows = ctx.sendMessage({ customer_id: inv.customer_id, channels: ['email'], kind: 'reminder', subject: `Reminder: invoice #${inv.id} is past due`,
        body: `Hi ${inv.customer_name},\n\nInvoice #${inv.id} ($${inv.total.toFixed(2)}) was due ${inv.due}. ${inv.token ? 'Pay online: ' + (process.env.PUBLIC_URL || '') + '/pay/' + inv.token : ''}\n\nIf you've already paid, thank you!\n— ${company()}` });
      run(`UPDATE invoices SET reminded_at=datetime('now') WHERE id=?`, id);
      if (rows.length) sent++;
    }
    return { sent, overdue: due.length };
  };
  route('POST', '/api/reminders/run', () => ctx.runReminders());

  // ---- outbox (what was sent / logged) ----
  route('GET', '/api/outbox', ({ query }) => all('SELECT * FROM outbox ORDER BY id DESC LIMIT ?', Math.min(300, Number(query.limit) || 100)));
  route('POST', '/api/outbox/:id/retry', async ({ params }) => {
    const row = one('SELECT * FROM outbox WHERE id=?', params.id);
    if (!row) throw notFound();
    await deliver(row);
    return one('SELECT * FROM outbox WHERE id=?', params.id);
  });
  route('POST', '/api/customers/:id/portal-link', ({ params, req }) => {
    if (!one('SELECT id FROM customers WHERE id=?', params.id)) throw notFound();
    return { url: portalUrl(req, Number(params.id)) };
  });
}
module.exports = { register };
