'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT);
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

function open(file = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'splashdesk.db')) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('PRAGMA foreign_keys = ON;');
  if (file !== ':memory:') db.exec('PRAGMA journal_mode = WAL;');
  db.exec(SCHEMA);
  // migrate databases created before map coordinates existed
  const cols = db.prepare('PRAGMA table_info(customers)').all().map((c) => c.name);
  if (!cols.includes('lat')) db.exec('ALTER TABLE customers ADD COLUMN lat REAL; ALTER TABLE customers ADD COLUMN lng REAL;');
  return db;
}

module.exports = { open };
