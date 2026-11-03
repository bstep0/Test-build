'use strict';
// Business reports: revenue trend, receivables aging, technician and route profitability, chemical usage/margins.
const Geo = require('../public/geo');
const Dosing = require('../public/dosing');

function register(ctx) {
  const { route, all, one, bad, getSettings, utcToday, addDays, round2, parseJson } = ctx;
  const num = (n) => round2(Number(n) || 0);

  route('GET', '/api/reports/summary', ({ query }) => {
    const days = [30, 90, 180, 365].includes(Number(query.days)) ? Number(query.days) : 90;
    const to = utcToday(), from = addDays(to, -days + 1), st = getSettings();

    // revenue by month
    const months = new Map();
    const bucket = (m) => { if (!months.has(m)) months.set(m, { month: m, billed: 0, collected: 0 }); return months.get(m); };
    for (const i of all(`SELECT issued, total FROM invoices WHERE issued BETWEEN ? AND ?`, from, to)) bucket(i.issued.slice(0, 7)).billed += i.total;
    for (const i of all(`SELECT paid_at, total FROM invoices WHERE status='paid' AND paid_at BETWEEN ? AND ?`, from, to)) bucket(i.paid_at.slice(0, 7)).collected += i.total;
    const revenue = [...months.values()].sort((a, b) => a.month.localeCompare(b.month)).map((m) => ({ ...m, billed: num(m.billed), collected: num(m.collected) }));

    // receivables aging
    const aging = { current: 0, d30: 0, d60: 0, d90: 0 };
    for (const i of all(`SELECT due, total FROM invoices WHERE status='open'`)) {
      const late = Math.floor((new Date(to) - new Date(i.due)) / 864e5);
      aging[late <= 0 ? 'current' : late <= 30 ? 'd30' : late <= 60 ? 'd60' : 'd90'] += i.total;
    }

    // technicians (visits completed in range)
    const visits = all(`SELECT v.*, p.volume_gal, t.name AS tech_name FROM visits v JOIN pools p ON p.id=v.pool_id LEFT JOIN techs t ON t.id=v.tech_id WHERE v.status='done' AND v.date BETWEEN ? AND ?`, from, to).map((v) => parseJson(v, ['tasks', 'chemicals']));
    const techs = new Map(), chems = new Map();
    for (const v of visits) {
      const k = v.tech_id ?? 0;
      if (!techs.has(k)) techs.set(k, { tech: v.tech_name || 'Unassigned', visits: 0, revenue: 0, chem_cost: 0, flagged: 0 });
      const t = techs.get(k), charges = v.chemicals.reduce((s, c) => s + (Number(c.charge) || 0), 0);
      t.visits++; t.revenue += v.price + charges; t.chem_cost += v.cost || 0;
      if (Dosing.issues(v.volume_gal, v).length) t.flagged++;
      for (const c of v.chemicals) {
        const key = String(c.name || '').trim().toLowerCase(); if (!key) continue;
        const x = chems.get(key) || { name: c.name, unit: c.unit || '', qty: 0, charge: 0, cost: 0, uses: 0 };
        x.qty += Number(c.qty) || 0; x.charge += Number(c.charge) || 0; x.cost += (Number(c.qty) || 0) * (Number(c.cost) || 0); x.uses++; chems.set(key, x);
      }
    }
    const technicians = [...techs.values()].map((t) => ({ ...t, revenue: num(t.revenue), chem_cost: num(t.chem_cost), flagged_pct: t.visits ? Math.round((100 * t.flagged) / t.visits) : 0 })).sort((a, b) => b.revenue - a.revenue);
    const chemicals = [...chems.values()].map((c) => ({ ...c, qty: round2(c.qty), charge: num(c.charge), cost: num(c.cost), margin: num(c.charge - c.cost) })).sort((a, b) => b.charge - a.charge);

    // route profitability: the recurring weekly template, per technician and weekday
    const depot = Geo.has({ lat: st.depot_lat, lng: st.depot_lng }) ? { lat: st.depot_lat, lng: st.depot_lng } : null;
    const stops = all(`SELECT s.tech_id, s.weekday, s.frequency, c.rate, c.lat, c.lng, t.name AS tech_name FROM stops s JOIN pools p ON p.id=s.pool_id JOIN customers c ON c.id=p.customer_id LEFT JOIN techs t ON t.id=s.tech_id
      WHERE s.active=1 AND c.archived=0 ORDER BY s.tech_id, s.weekday, s.position`);
    const groups = new Map();
    for (const s of stops) { const k = `${s.tech_id}|${s.weekday}`; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(s); }
    const routes = [...groups.values()].map((g) => {
      const x = Geo.stats(depot, g, { roundTrip: !!st.round_trip, speed: st.speed_mph, serviceMin: st.service_min });
      const revenue = g.reduce((s, r) => s + r.rate / (r.frequency || 1), 0), hours = x.totalMin / 60, driveCost = x.miles * (Number(st.cost_per_mile) || 0);
      return { tech: g[0].tech_name || 'Unassigned', weekday: g[0].weekday, stops: g.length, revenue: num(revenue), miles: round2(x.miles), hours: round2(hours),
        per_hour: hours ? num(revenue / hours) : 0, drive_cost: num(driveCost), net: num(revenue - driveCost) };
    }).sort((a, b) => b.per_hour - a.per_hour);

    const top = all(`SELECT c.id, c.name, SUM(i.total) AS total FROM invoices i JOIN customers c ON c.id=i.customer_id WHERE i.issued BETWEEN ? AND ? GROUP BY c.id ORDER BY total DESC LIMIT 5`, from, to).map((r) => ({ ...r, total: num(r.total) }));
    const sum = (k) => num(revenue.reduce((s, m) => s + m[k], 0));
    return { days, from, to, totals: { billed: sum('billed'), collected: sum('collected'), outstanding: num(one(`SELECT COALESCE(SUM(total),0) AS n FROM invoices WHERE status='open'`).n), visits: visits.length, chemical_cost: num(visits.reduce((s, v) => s + (v.cost || 0), 0)) },
      revenue, aging: Object.fromEntries(Object.entries(aging).map(([k, v]) => [k, num(v)])), technicians, chemicals, routes, top_customers: top };
  });
}
module.exports = { register };
