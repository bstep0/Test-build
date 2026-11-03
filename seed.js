'use strict';
// Demo data: 3 techs, 42 customers (with map locations) on deliberately unoptimised weekly routes, 4 weeks of history, work orders, invoices.
const { ensureVisits } = require('./lib/schedule');

function rng(seed) { // deterministic PRNG so the demo looks the same every time
  return () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const iso = (d) => d.toISOString().slice(0, 10);

function seed(db, today = new Date()) {
  const rand = rng(42);
  const pick = (a) => a[Math.floor(rand() * a.length)];
  const between = (lo, hi, step = 1) => +(Math.round((lo + rand() * (hi - lo)) / step) * step).toFixed(2);
  const ins = (sql, ...a) => Number(db.prepare(sql).run(...a).lastInsertRowid);

  const techs = [['Maria Lopez', '#0ea5e9'], ['Dan Whitaker', '#f97316'], ['Priya Nair', '#22c55e']]
    .map(([n, c], i) => ins('INSERT INTO techs (name, phone, color) VALUES (?,?,?)', n, `555-010${i}`, c));

  const hand = [
    ['Harper Residence', '1204 Palm Ave', 'Sunnyvale', 135], ['The Okafor Family', '88 Cedar Ct', 'Sunnyvale', 120],
    ['Lindqvist, Erik', '9 Marlin Way', 'Sunnyvale', 140], ['Ramirez Household', '312 Orchard Ln', 'Cupertino', 125],
    ['Bayview HOA', '1 Bayview Dr', 'Cupertino', 260], ['Chen & Park', '47 Willow Creek Rd', 'Cupertino', 150],
    ['Dr. Abrams', '700 Summit Ridge', 'Los Altos', 180], ['Greenfield Residence', '23 Alder St', 'Los Altos', 130],
    ['Moreau, Claire', '510 Vista Pl', 'Los Altos', 145], ['Kowalski Family', '66 Birch Hollow', 'Mountain View', 120],
    ['Nguyen Residence', '1801 Sierra Vista', 'Mountain View', 135], ['Tanaka Household', '29 Laurel Ct', 'Mountain View', 125],
    ['Sullivan, Pat', '402 Hillcrest Blvd', 'Sunnyvale', 150], ['Delgado Family', '77 Meadowlark Ln', 'Cupertino', 130],
  ];
  const surnames = ['Abernathy', 'Baptiste', 'Carver', 'Dhillon', 'Eriksen', 'Fontaine', 'Gallagher', 'Hoshino', 'Iyer', 'Jankowski', 'Kessler', 'Lombardi', 'Mbeki', 'Novak', "O'Neill", 'Petrov', 'Quintero', 'Rosenberg', 'Salazar', 'Thackeray', 'Underhill', 'Varga', 'Whitfield', 'Xu', 'Yamamoto', 'Zielinski', 'Brandt', 'Castellano'];
  const streets = ['Oak', 'Maple', 'Juniper', 'Sycamore', 'Magnolia', 'Redwood', 'Aspen', 'Cypress', 'Hawthorn', 'Poplar'];
  const kinds = ['Ct', 'Ln', 'Way', 'Dr', 'St', 'Pl'];
  const cities = ['Sunnyvale', 'Cupertino', 'Los Altos', 'Mountain View'];
  const people = hand.concat(surnames.map((n, i) => [`${n} Residence`, `${100 + Math.floor(rand() * 1800)} ${streets[i % 10]} ${kinds[i % 6]}`, cities[i % 4], between(115, 170, 5)]));
  // approximate city centres so the demo map looks plausible
  const centre = { Sunnyvale: [37.3688, -122.0363], Cupertino: [37.323, -122.0322], 'Los Altos': [37.3852, -122.1141], 'Mountain View': [37.3861, -122.0839] };
  const jitter = (c) => [centre[c][0] + (rand() - 0.5) * 0.045, centre[c][1] + (rand() - 0.5) * 0.06];
  const put = db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)');
  put.run('depot_name', JSON.stringify('Shop')); put.run('depot_address', JSON.stringify('Sunnyvale, CA'));
  put.run('depot_lat', JSON.stringify(37.3688)); put.run('depot_lng', JSON.stringify(-122.0363));
  put.run('company_name', JSON.stringify('Crystal Clear Pool Co.')); put.run('company_email', JSON.stringify('service@crystalclear.example'));
  put.run('company_phone', JSON.stringify('(408) 555-0142')); put.run('tax_rate', JSON.stringify(8.25));
  put.run('invoice_footer', JSON.stringify('Thank you for choosing Crystal Clear! Pay online with the link above, or by check within 14 days.'));
  const products = [['Liquid chlorine 10%', 'gal', 3.2, 8.5, 42, 15], ['Muriatic acid', 'gal', 6.5, 14, 18, 6], ['Stabilizer (CYA)', 'lb', 4.1, 9.5, 60, 20], ['Pool salt 40 lb', 'bag', 6.8, 14, 9, 10], ['Baking soda', 'lb', 0.9, 3, 80, 25]]
    .map(([n, u, c, p, st, low]) => ({ name: n, unit: u, cost: c, price: p, id: Number(db.prepare('INSERT INTO products (name, unit, cost, price, stock, low_stock) VALUES (?,?,?,?,?,?)').run(n, u, c, p, st, low).lastInsertRowid) }));
  const start = new Date(today); start.setUTCDate(start.getUTCDate() - 28);
  const startDate = iso(start);

  people.forEach(([name, address, city, rate], i) => {
    const slug = name.toLowerCase().replace(/[^a-z]+/g, '.').replace(/^\.|\.$/g, '');
    const [lat, lng] = jitter(city);
    const c = ins('INSERT INTO customers (name, phone, email, address, city, gate_code, notes, rate, lat, lng, billing_mode, monthly_rate, notify_sms) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)',
      name, `555-02${String(10 + i).padStart(2, '0')}`, `${slug}@example.com`, address, city,
      i % 3 === 0 ? String(1000 + i * 37) : '', i % 4 === 1 ? 'Dog in backyard — text before arriving.' : '', rate, lat, lng,
      i % 7 === 3 ? 'monthly' : 'visit', i % 7 === 3 ? Math.round(rate * 4.1) : 0, i % 2);
    const p = ins('INSERT INTO pools (customer_id, name, type, volume_gal, surface, sanitizer, notes) VALUES (?,?,?,?,?,?,?)',
      c, i % 5 === 4 ? 'Lap pool' : 'Pool', i % 5 === 2 ? 'Pool & spa' : 'Pool', between(10000, 30000, 1000),
      pick(['Plaster', 'Pebble', 'Vinyl', 'Fiberglass']), i % 3 === 0 ? 'Salt' : 'Chlorine',
      i % 3 === 0 ? 'Salt cell — inspect every month.' : '');
    ins('INSERT INTO stops (pool_id, tech_id, weekday, frequency, position, start_date) VALUES (?,?,?,?,?,?)',
      p, techs[Math.floor(rand() * 3)], 1 + Math.floor(rand() * 5), i === 13 ? 2 : 1, 10 + i, startDate); // deliberately unoptimised
  });

  // demo logins (only created by the demo seed)
  const { hashPassword } = require('./lib/auth');
  const addUser = db.prepare('INSERT INTO users (email, name, role, password_hash, tech_id) VALUES (?,?,?,?,?)');
  addUser.run('owner@demo.test', 'Demo Owner', 'owner', hashPassword('demo1234'), null);
  addUser.run('office@demo.test', 'Demo Office', 'office', hashPassword('demo1234'), null);
  addUser.run('tech@demo.test', 'Maria Lopez', 'tech', hashPassword('demo1234'), techs[0]);

  // history: complete all past visits with plausible readings
  const done = db.prepare(`UPDATE visits SET status='done', arrived_at=?, completed_at=?, fc=?, ph=?, ta=?, cya=?, ch=?, salt=?, temp=?, tasks=?, notes=? WHERE id=?`);
  const todayStr = iso(today);
  for (let d = new Date(start); iso(d) < todayStr; d.setUTCDate(d.getUTCDate() + 1)) {
    const date = iso(d);
    ensureVisits(db, date);
    for (const v of db.prepare('SELECT v.id, p.sanitizer FROM visits v JOIN pools p ON p.id=v.pool_id WHERE v.date=?').all(date)) {
      if (rand() < 0.05) { db.prepare(`UPDATE visits SET status='skipped', notes='Customer away' WHERE id=?`).run(v.id); continue; }
      const t = `${date}T${String(8 + Math.floor(rand() * 8)).padStart(2, '0')}:15:00.000Z`;
      done.run(t, t, between(1, 5.5, 0.5), between(7.0, 8.0, 0.1), between(60, 130, 5), between(25, 70, 5),
        between(180, 420, 10), v.sanitizer === 'Salt' ? between(2600, 3500, 100) : null, between(68, 86),
        JSON.stringify(['Skim surface', 'Brush walls & steps', 'Empty baskets', 'Test water']), '', v.id);
      if (rand() < 0.4) {                       // chemicals used (billed + costed)
        const pr = pick(products), qty = pr.unit === 'gal' ? between(0.5, 2, 0.5) : between(1, 4, 1);
        db.prepare('UPDATE visits SET chemicals=?, cost=? WHERE id=?').run(JSON.stringify([{ product_id: pr.id, name: pr.name, qty, unit: pr.unit, charge: +(qty * pr.price).toFixed(2), cost: pr.cost }]), +(qty * pr.cost).toFixed(2), v.id);
      }
    }
  }

  const poolId = (n) => db.prepare('SELECT id FROM pools ORDER BY id LIMIT 1 OFFSET ?').get(n).id;
  const wo = (pool, tech, title, description, price, status, due) =>
    ins('INSERT INTO work_orders (pool_id, tech_id, title, description, price, status, due_date, completed_at) VALUES (?,?,?,?,?,?,?,?)',
      poolId(pool), techs[tech], title, description, price, status, due, status === 'done' ? iso(new Date(today - 3 * 864e5)) + 'T16:00:00.000Z' : null);
  wo(0, 0, 'Replace pump motor', 'Motor is humming but not spinning. Quote approved by phone.', 640, 'scheduled', iso(new Date(+today + 2 * 864e5)));
  wo(3, 1, 'Re-grout waterline tile', 'Approx. 12 linear feet.', 380, 'open', null);
  wo(4, 2, 'Replace cartridge filter', 'Pentair Clean & Clear Plus 520.', 295, 'open', iso(new Date(+today + 6 * 864e5)));
  wo(6, 0, 'Replace salt cell', 'Cell reading low output after acid wash.', 520, 'done', null);

  // one paid and one open invoice from history
  const bill = (cid, status) => {
    const visits = db.prepare(`SELECT v.id, v.date, v.price FROM visits v JOIN pools p ON p.id=v.pool_id WHERE p.customer_id=? AND v.status='done' AND v.invoice_id IS NULL AND v.date < ? ORDER BY v.date`).all(cid, iso(new Date(today - 10 * 864e5)));
    if (!visits.length) return;
    const items = visits.map((v) => ({ desc: `Pool service (${v.date})`, qty: 1, price: v.price }));
    const total = items.reduce((s, i) => s + i.price, 0);
    const id = ins('INSERT INTO invoices (customer_id, issued, due, status, items, total, paid_at, method) VALUES (?,?,?,?,?,?,?,?)',
      cid, iso(new Date(today - 9 * 864e5)), iso(new Date(today + 5 * 864e5)), status, JSON.stringify(items), total, status === 'paid' ? iso(new Date(today - 4 * 864e5)) : null, status === 'paid' ? 'Card' : '');
    for (const v of visits) db.prepare('UPDATE visits SET invoice_id=? WHERE id=?').run(id, v.id);
  };
  bill(1, 'paid'); bill(2, 'open'); bill(5, 'open');
  const crypto = require('node:crypto');
  const quote = (cust, title, items, status) => ins('INSERT INTO quotes (customer_id, pool_id, token, title, note, items, total, status) VALUES (?,?,?,?,?,?,?,?)', cust, poolId(cust - 1), crypto.randomBytes(16).toString('hex'), title,
    'Includes parts, labor and disposal of the old equipment. 1-year warranty on the new unit.', JSON.stringify(items), items.reduce((s, i) => s + i.qty * i.price, 0), status);
  quote(8, 'Variable-speed pump upgrade', [{ desc: 'Variable-speed pump (1.5 HP)', qty: 1, price: 1080 }, { desc: 'Installation labor', qty: 3, price: 85 }], 'sent');
  quote(9, 'Replace pool light (LED)', [{ desc: 'LED color light', qty: 1, price: 285 }, { desc: 'Labor', qty: 1, price: 140 }], 'approved');
  quote(11, 'Resurface coping tile', [{ desc: 'Tile & grout, 24 ft', qty: 1, price: 920 }], 'draft');
  db.prepare("UPDATE customers SET portal_token=? WHERE id=1").run(crypto.randomBytes(16).toString('hex'));
}

module.exports = { seed };

if (require.main === module) {
  const { open } = require('./lib/db');
  const db = open();
  if (db.prepare('SELECT 1 FROM techs LIMIT 1').get()) { console.error('Database already has data; delete data/splashdesk.db to reseed.'); process.exit(1); }
  seed(db);
  console.log('Seeded demo data.');
}
