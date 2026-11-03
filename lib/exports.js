'use strict';
// CSV exports for accounting (QuickBooks / Xero / spreadsheets can import these).
function csvCell(v) {
  let s = v === null || v === undefined ? '' : String(v);
  if (/^[=+\-@\t\r]/.test(s) && isNaN(Number(s))) s = "'" + s;          // neutralise spreadsheet formula injection
  return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}
const toCsv = (headers, rows) => [headers.join(','), ...rows.map((r) => r.map(csvCell).join(','))].join('\r\n') + '\r\n';

function register(ctx) {
  const { route, all, isDate } = ctx;
  const file = (name, body) => ({ __raw: { status: 200, headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="${name}"` }, body } });
  const range = (q, col) => {
    const w = [], a = [];
    if (isDate(q.from)) { w.push(`${col} >= ?`); a.push(q.from); }
    if (isDate(q.to)) { w.push(`${col} <= ?`); a.push(q.to); }
    return [w.length ? 'WHERE ' + w.join(' AND ') : '', a];
  };

  route('GET', '/api/export/invoices.csv', ({ query }) => {
    const [where, args] = range(query, 'i.issued');
    const rows = [];
    for (const i of all(`SELECT i.*, c.name AS customer_name FROM invoices i JOIN customers c ON c.id=i.customer_id ${where} ORDER BY i.id`, ...args))
      for (const it of JSON.parse(i.items)) rows.push([i.id, i.customer_name, i.issued, i.due, it.desc, it.qty, it.price, (it.qty * it.price).toFixed(2), it.taxable ? 'Y' : 'N', i.subtotal, i.tax, i.total, i.status, i.paid_at, i.method]);
    return file('invoices.csv', toCsv(['InvoiceNo', 'Customer', 'InvoiceDate', 'DueDate', 'Description', 'Qty', 'Rate', 'Amount', 'Taxable', 'Subtotal', 'Tax', 'Total', 'Status', 'PaidDate', 'PaymentMethod'], rows));
  });
  route('GET', '/api/export/payments.csv', ({ query }) => {
    const [where, args] = range(query, 'i.paid_at');
    const rows = all(`SELECT i.id, i.paid_at, i.total, i.method, c.name AS customer_name FROM invoices i JOIN customers c ON c.id=i.customer_id ${where ? where + " AND i.status='paid'" : "WHERE i.status='paid'"} ORDER BY i.paid_at, i.id`, ...args)
      .map((i) => [i.paid_at, i.id, i.customer_name, i.total, i.method]);
    return file('payments.csv', toCsv(['Date', 'InvoiceNo', 'Customer', 'Amount', 'Method'], rows));
  });
  route('GET', '/api/export/customers.csv', () => file('customers.csv',
    toCsv(['Name', 'Email', 'Phone', 'Address', 'City', 'BillingMode', 'MonthlyRate', 'VisitRate'],
      all('SELECT * FROM customers WHERE archived=0 ORDER BY name COLLATE NOCASE').map((c) => [c.name, c.email, c.phone, c.address, c.city, c.billing_mode, c.monthly_rate, c.rate]))));
}
module.exports = { register, toCsv, csvCell };
