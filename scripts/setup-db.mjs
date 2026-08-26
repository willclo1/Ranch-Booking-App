#!/usr/bin/env node
/**
 * Portable database setup — creates the SQLite database, schema, and seed data.
 * Needs only Node.js 22.5+ (uses the built-in node:sqlite module — no native deps,
 * no external database server). Safe to run repeatedly; it never overwrites data.
 *
 *   node scripts/setup-db.mjs           -> creates ./data/ranch.db
 *   RANCH_DB=/path/to.db node scripts/setup-db.mjs
 */
import { getDb, DB_PATH } from '../server/db.js';

const [major, minor] = process.versions.node.split('.').map(Number);
if (major < 22 || (major === 22 && minor < 5)) {
  console.error(`Node ${process.versions.node} is too old — need 22.5+ for the built-in sqlite module.`);
  process.exit(1);
}

const db = getDb();
const count = (t) => db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get().n;

console.log(`\nAV Ranch database ready at: ${DB_PATH}\n`);
console.log(`  users:     ${count('users')} (incl. sysadmin)`);
console.log(`  rooms:     ${count('rooms')}`);
console.log(`  bookings:  ${count('bookings')}`);
console.log(`\nRooms:`);
for (const r of db.prepare('SELECT name, side FROM rooms ORDER BY sort_order').all()) {
  console.log(`  - ${r.name}  [${r.side}]`);
}
console.log(`\nAdmins: Jimmy & Lynn (Clore side) · Kevin & Pamela (Gabriel side)`);
console.log(`Sysadmin access code: ${process.env.SYSADMIN_CODE || 'LAGRANGE'} (override with SYSADMIN_CODE env var)\n`);
