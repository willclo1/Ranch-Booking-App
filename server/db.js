// Database layer — uses Node's built-in node:sqlite (Node 22.5+), zero native deps.
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
export const DB_PATH = process.env.RANCH_DB || join(__dirname, '..', 'data', 'ranch.db');

let db = null;

/** Close the cached handle so the next getDb() opens the file fresh (used by reset-db). */
export function closeDb() {
  if (!db) return;
  try {
    db.close();
  } catch {
    /* already closed */
  }
  db = null;
}

export function getDb() {
  if (db) return db;
  mkdirSync(dirname(DB_PATH), { recursive: true });
  db = new DatabaseSync(DB_PATH);
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA foreign_keys = ON;');
  migrate(db);
  seed(db);
  return db;
}

function migrate(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE COLLATE NOCASE,
      family TEXT CHECK (family IN ('clore','gabriel') OR family IS NULL),
      role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user','admin','sysadmin')),
      pin_hash TEXT,
      phone TEXT,
      -- guests are bookable names only: no sign-in, hidden from the login dropdown
      is_guest INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      expires_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS rooms (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      key TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      side TEXT NOT NULL CHECK (side IN ('clore','gabriel','shared')),
      sort_order INTEGER NOT NULL DEFAULT 0,
      requires_approval INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS bookings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      created_by INTEGER NOT NULL REFERENCES users(id),
      start_date TEXT NOT NULL,  -- YYYY-MM-DD arrival (inclusive)
      end_date TEXT NOT NULL,    -- YYYY-MM-DD departure day (exclusive; same-day turnover allowed)
      is_full_ranch INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','cancelled')),
      notes TEXT,
      is_holiday INTEGER NOT NULL DEFAULT 0,
      holiday_name TEXT,
      needs_clore INTEGER NOT NULL DEFAULT 0,
      needs_gabriel INTEGER NOT NULL DEFAULT 0,
      needs_either INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS booking_rooms (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      booking_id INTEGER NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
      room_id INTEGER NOT NULL REFERENCES rooms(id),
      UNIQUE (booking_id, room_id)
    );

    CREATE TABLE IF NOT EXISTS booking_guests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      booking_id INTEGER NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
      room_id INTEGER NOT NULL REFERENCES rooms(id),
      user_id INTEGER NOT NULL REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS approvals (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      booking_id INTEGER NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
      admin_id INTEGER NOT NULL REFERENCES users(id),
      side TEXT NOT NULL CHECK (side IN ('clore','gabriel','both')),
      decision TEXT NOT NULL CHECK (decision IN ('approved','rejected')),
      note TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE (booking_id, admin_id)
    );

    CREATE TABLE IF NOT EXISTS grocery_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      text TEXT NOT NULL,
      added_by INTEGER NOT NULL REFERENCES users(id),
      added_at TEXT NOT NULL DEFAULT (datetime('now')),
      bought_by INTEGER REFERENCES users(id),
      bought_at TEXT
    );

    CREATE TABLE IF NOT EXISTS todo_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      text TEXT NOT NULL,
      added_by INTEGER NOT NULL REFERENCES users(id),
      added_at TEXT NOT NULL DEFAULT (datetime('now')),
      completed_by INTEGER REFERENCES users(id),
      completed_at TEXT
    );

    CREATE TABLE IF NOT EXISTS checklist_templates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT NOT NULL CHECK (type IN ('checkin','checkout')),
      text TEXT NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_by INTEGER REFERENCES users(id),
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS checklist_checks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      booking_id INTEGER NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
      template_item_id INTEGER NOT NULL REFERENCES checklist_templates(id) ON DELETE CASCADE,
      checked_by INTEGER NOT NULL REFERENCES users(id),
      checked_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE (booking_id, template_item_id)
    );

    CREATE INDEX IF NOT EXISTS idx_bookings_dates ON bookings (start_date, end_date);
    CREATE INDEX IF NOT EXISTS idx_booking_rooms ON booking_rooms (booking_id);
    CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions (user_id);
  `);

  // Older databases: add columns introduced after the first release.
  const roomCols = db.prepare(`PRAGMA table_info(rooms)`).all().map((c) => c.name);
  if (!roomCols.includes('requires_approval')) {
    db.exec(`ALTER TABLE rooms ADD COLUMN requires_approval INTEGER NOT NULL DEFAULT 0`);
  }
  const userCols = db.prepare(`PRAGMA table_info(users)`).all().map((c) => c.name);
  if (!userCols.includes('phone')) {
    db.exec(`ALTER TABLE users ADD COLUMN phone TEXT`);
  }
  if (!userCols.includes('is_guest')) {
    db.exec(`ALTER TABLE users ADD COLUMN is_guest INTEGER NOT NULL DEFAULT 0`);
  }
  // Every room needs an admin sign-off (side admins for family rooms, either side for the Loft).
  db.exec(`UPDATE rooms SET requires_approval = 1`);

  // The bedrooms were renamed after their teams. Keyed on the room key AND the
  // old name, so this fires once on an existing database and then never again —
  // a later rename won't be stomped back on the next restart.
  const renames = [
    ['guest4', 'Guest 4', 'UT'],
    ['guest2', 'Guest 2', 'Baylor'],
    ['guest3', 'Guest 3', 'TCU'],
    ['guest1', 'Guest 1', 'Clemson'],
    ['master2', 'Master 2', 'Gabriel Master'],
    ['master1', 'Master 1', 'Clore Master'],
  ];
  const rename = db.prepare('UPDATE rooms SET name = ? WHERE key = ? AND name = ?');
  for (const [key, was, now] of renames) rename.run(now, key, was);
}

function seed(db) {
  const userCount = db.prepare('SELECT COUNT(*) AS n FROM users').get().n;
  if (userCount === 0) {
    const ins = db.prepare('INSERT INTO users (name, family, role) VALUES (?, ?, ?)');
    // Admins: Jimmy & Lynn (Clore side), Kevin & Pamela (Gabriel side)
    ins.run('Jimmy', 'clore', 'admin');
    ins.run('Lynn', 'clore', 'admin');
    ins.run('Kevin', 'gabriel', 'admin');
    ins.run('Pamela', 'gabriel', 'admin');
    ins.run('Will', 'clore', 'user');
    ins.run('Erin', null, 'user');
    ins.run('Sara', null, 'user');
    ins.run('Ben', null, 'user');
    ins.run('Rion', null, 'user');
    ins.run('Austin', null, 'user');
    ins.run('Sysadmin', null, 'sysadmin');
  }

  const roomCount = db.prepare('SELECT COUNT(*) AS n FROM rooms').get().n;
  if (roomCount === 0) {
    const ins = db.prepare('INSERT INTO rooms (key, name, side, sort_order, requires_approval) VALUES (?, ?, ?, ?, ?)');
    // Layout mirrors the hand-drawn plan: Gabriel side = left column, Clore side = right column.
    ins.run('guest4', 'UT', 'gabriel', 1, 1);
    ins.run('guest2', 'Baylor', 'clore', 2, 1);
    ins.run('guest3', 'TCU', 'gabriel', 3, 1);
    ins.run('guest1', 'Clemson', 'clore', 4, 1);
    ins.run('master2', 'Gabriel Master', 'gabriel', 5, 1);
    ins.run('master1', 'Clore Master', 'clore', 6, 1);
    ins.run('loft', 'The Loft', 'shared', 7, 1);
  }
}

/** Wrap fn in an immediate transaction. */
export function tx(db, fn) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}
