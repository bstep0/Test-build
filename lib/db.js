'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT);
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY, email TEXT NOT NULL UNIQUE COLLATE NOCASE, name TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'tech',
  password_hash TEXT NOT NULL, tech_id INTEGER REFERENCES techs(id) ON DELETE SET NULL, active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, expires_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS audit (
  id INTEGER PRIMARY KEY, at TEXT DEFAULT (datetime('now')), user_id INTEGER, user_name TEXT, method TEXT, path TEXT, summary TEXT
);
CREATE TABLE IF NOT EXISTS photos (
  id INTEGER PRIMARY KEY, visit_id INTEGER NOT NULL REFERENCES visits(id) ON DELETE CASCADE, file TEXT NOT NULL,
  caption TEXT DEFAULT '', user_id INTEGER, created_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS products (
  id INTEGER PRIMARY KEY, name TEXT NOT NULL, unit TEXT DEFAULT 'each', cost REAL NOT NULL DEFAULT 0, price REAL NOT NULL DEFAULT 0,
  stock REAL NOT NULL DEFAULT 0, low_stock REAL NOT NULL DEFAULT 0, active INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS quotes (
  id INTEGER PRIMARY KEY, customer_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  pool_id INTEGER REFERENCES pools(id) ON DELETE SET NULL, token TEXT NOT NULL UNIQUE, title TEXT NOT NULL,
  note TEXT DEFAULT '', items TEXT NOT NULL DEFAULT '[]', total REAL NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'draft',        -- draft | sent | approved | declined
  created_at TEXT DEFAULT (datetime('now')), responded_at TEXT, work_order_id INTEGER REFERENCES work_orders(id) ON DELETE SET NULL
);
CREATE TABLE IF NOT EXISTS outbox (
  id INTEGER PRIMARY KEY, created_at TEXT DEFAULT (datetime('now')), channel TEXT NOT NULL, to_addr TEXT NOT NULL,
  subject TEXT DEFAULT '', body TEXT NOT NULL, kind TEXT DEFAULT '', status TEXT NOT NULL DEFAULT 'queued', error TEXT DEFAULT ''
);
CREATE TABLE IF NOT EXISTS techs (
  id INTEGER PRIMARY KEY, name TEXT NOT NULL, phone TEXT DEFAULT '', color TEXT DEFAULT '#0ea5e9'
);
CREATE TABLE IF NOT EXISTS customers (
  id INTEGER PRIMARY KEY, name TEXT NOT NULL, phone TEXT DEFAULT '', email TEXT DEFAULT '',
  address TEXT DEFAULT '', city TEXT DEFAULT '', gate_code TEXT DEFAULT '', notes TEXT DEFAULT '',
  rate REAL NOT NULL DEFAULT 0,            -- price per regular service visit
  lat REAL, lng REAL,                      -- map location (route optimisation)
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS pools (
  id INTEGER PRIMARY KEY, customer_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  name TEXT NOT NULL DEFAULT 'Pool', type TEXT DEFAULT 'Pool', volume_gal INTEGER DEFAULT 15000,
  surface TEXT DEFAULT 'Plaster', sanitizer TEXT DEFAULT 'Chlorine', notes TEXT DEFAULT ''
);
CREATE TABLE IF NOT EXISTS stops (            -- recurring route stop
  id INTEGER PRIMARY KEY, pool_id INTEGER NOT NULL REFERENCES pools(id) ON DELETE CASCADE,
  tech_id INTEGER REFERENCES techs(id) ON DELETE SET NULL,
  weekday INTEGER NOT NULL, frequency INTEGER NOT NULL DEFAULT 1,  -- every N weeks
  position INTEGER NOT NULL DEFAULT 100, active INTEGER NOT NULL DEFAULT 1,
  start_date TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS invoices (
  id INTEGER PRIMARY KEY, customer_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  issued TEXT NOT NULL, due TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'open',
  items TEXT NOT NULL DEFAULT '[]', total REAL NOT NULL DEFAULT 0, paid_at TEXT, method TEXT DEFAULT ''
);
CREATE TABLE IF NOT EXISTS visits (
  id INTEGER PRIMARY KEY, stop_id INTEGER REFERENCES stops(id) ON DELETE SET NULL,
  pool_id INTEGER NOT NULL REFERENCES pools(id) ON DELETE CASCADE,
  tech_id INTEGER REFERENCES techs(id) ON DELETE SET NULL,
  date TEXT NOT NULL, position INTEGER NOT NULL DEFAULT 100,
  status TEXT NOT NULL DEFAULT 'scheduled',  -- scheduled | done | skipped
  arrived_at TEXT, completed_at TEXT,
  fc REAL, ph REAL, ta REAL, cya REAL, ch REAL, salt REAL, temp REAL,
  tasks TEXT NOT NULL DEFAULT '[]', chemicals TEXT NOT NULL DEFAULT '[]',
  notes TEXT DEFAULT '', price REAL NOT NULL DEFAULT 0,
  invoice_id INTEGER REFERENCES invoices(id) ON DELETE SET NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS visits_stop_date ON visits(stop_id, date);
CREATE INDEX IF NOT EXISTS visits_date ON visits(date);
CREATE TABLE IF NOT EXISTS work_orders (
  id INTEGER PRIMARY KEY, pool_id INTEGER NOT NULL REFERENCES pools(id) ON DELETE CASCADE,
  tech_id INTEGER REFERENCES techs(id) ON DELETE SET NULL,
  title TEXT NOT NULL, description TEXT DEFAULT '', price REAL NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'open',       -- open | scheduled | done
  due_date TEXT, created_at TEXT DEFAULT (datetime('now')), completed_at TEXT,
  invoice_id INTEGER REFERENCES invoices(id) ON DELETE SET NULL
);
`;

// Idempotent column additions so databases from older versions upgrade in place.
function addCol(db, table, col, def) {
  if (!db.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === col)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${def}`);
}
function migrate(db) {
  addCol(db, 'customers', 'lat', 'REAL'); addCol(db, 'customers', 'lng', 'REAL');
  addCol(db, 'customers', 'archived', 'INTEGER NOT NULL DEFAULT 0');
  addCol(db, 'customers', 'billing_mode', "TEXT NOT NULL DEFAULT 'visit'");   // visit | monthly
  addCol(db, 'customers', 'monthly_rate', 'REAL NOT NULL DEFAULT 0');
  addCol(db, 'customers', 'portal_token', 'TEXT');
  addCol(db, 'customers', 'notify_email', 'INTEGER NOT NULL DEFAULT 1');
  addCol(db, 'customers', 'notify_sms', 'INTEGER NOT NULL DEFAULT 0');
  addCol(db, 'customers', 'taxable', 'INTEGER NOT NULL DEFAULT 1');
  addCol(db, 'customers', 'autopay', 'INTEGER NOT NULL DEFAULT 0');
  addCol(db, 'customers', 'stripe_customer', 'TEXT');
  addCol(db, 'customers', 'stripe_pm', 'TEXT');
  addCol(db, 'stops', 'end_date', 'TEXT');
  addCol(db, 'visits', 'cost', 'REAL NOT NULL DEFAULT 0');
  addCol(db, 'visits', 'stock_applied', "TEXT NOT NULL DEFAULT '[]'");
  addCol(db, 'visits', 'eta_sent_at', 'TEXT');
  addCol(db, 'visits', 'report_sent_at', 'TEXT');
  addCol(db, 'invoices', 'period', 'TEXT');
  addCol(db, 'invoices', 'subtotal', 'REAL NOT NULL DEFAULT 0');
  addCol(db, 'invoices', 'tax', 'REAL NOT NULL DEFAULT 0');
  addCol(db, 'invoices', 'stripe_session', 'TEXT');
  addCol(db, 'invoices', 'reminded_at', 'TEXT');
  addCol(db, 'invoices', 'token', 'TEXT');
  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS invoices_period ON invoices(customer_id, period) WHERE period IS NOT NULL');
}

function open(file = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'splashdesk.db')) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('PRAGMA foreign_keys = ON;');
  if (file !== ':memory:') db.exec('PRAGMA journal_mode = WAL;');
  db.exec(SCHEMA);
  migrate(db);
  return db;
}

module.exports = { open, migrate };
