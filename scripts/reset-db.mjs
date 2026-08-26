#!/usr/bin/env node
/**
 * Clear the ranch database.
 *
 *   npm run reset-db            clear bookings + lists (keeps people and their codes)
 *   npm run reset-db -- --all   wipe everything back to a factory-fresh database
 *   npm run reset-db -- --yes   skip the confirmation prompt
 *
 * Shows exactly what will be deleted and asks before doing it.
 * Stop the server first so nothing writes while this runs.
 */
import { createInterface } from 'node:readline/promises';
import { existsSync, rmSync } from 'node:fs';
import { getDb, closeDb, DB_PATH } from '../server/db.js';

const args = process.argv.slice(2);
const wipeAll = args.includes('--all');
const assumeYes = args.includes('--yes') || args.includes('-y');

if (!existsSync(DB_PATH)) {
  console.log(`\nNo database at ${DB_PATH} — nothing to clear.`);
  console.log('Run `npm run setup` to create a fresh one.\n');
  process.exit(0);
}

// Show what's actually in there before touching anything.
const db = getDb();
const count = (t) => db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get().n;
const stats = {
  bookings: count('bookings'),
  people: count('users') - 1, // the sysadmin account isn't a family member
  grocery: count('grocery_items'),
  todos: count('todo_items'),
  checklistItems: count('checklist_templates'),
};

console.log(`\nDatabase: ${DB_PATH}`);
console.log(`  ${stats.bookings} bookings`);
console.log(`  ${stats.people} people`);
console.log(`  ${stats.grocery} grocery items · ${stats.todos} to-dos · ${stats.checklistItems} checklist steps`);

console.log(
  wipeAll
    ? `\nWILL DELETE EVERYTHING — bookings, people, their 4-digit codes, lists, and checklists.\nThe database is rebuilt with the original family (Jimmy, Lynn, Kevin, Pamela, Will, Erin,\nSara, Ben, Rion, Austin), and everyone sets a new code on their next sign-in.`
    : `\nWILL DELETE: all bookings, approvals, grocery items, to-dos, and checklist tick-marks.\nWILL KEEP: people, their 4-digit codes, rooms, and your checklist templates.`
);

if (!assumeYes) {
  if (!process.stdin.isTTY) {
    console.log('\nNot an interactive terminal — re-run with --yes to confirm.\n');
    process.exit(1);
  }
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await rl.question('\nType "yes" to continue: ');
  rl.close();
  if (answer.trim().toLowerCase() !== 'yes') {
    console.log('Cancelled — nothing was deleted.\n');
    process.exit(0);
  }
}

if (wipeAll) {
  closeDb(); // drop the cached handle so getDb() below reopens from scratch
  for (const suffix of ['', '-wal', '-shm']) {
    try {
      rmSync(DB_PATH + suffix, { force: true });
    } catch (err) {
      console.error(`Could not delete ${DB_PATH + suffix}: ${err.message}`);
      console.error('Is the server still running? Stop it and try again.\n');
      process.exit(1);
    }
  }
  const fresh = getDb(); // recreates schema + seeds the original family
  console.log(`\nDone — factory-fresh database with ${fresh.prepare('SELECT COUNT(*) AS n FROM users').get().n - 1} people and ${fresh.prepare('SELECT COUNT(*) AS n FROM rooms').get().n} rooms.\n`);
} else {
  db.exec('BEGIN IMMEDIATE');
  try {
    // booking_rooms, booking_guests, approvals and checklist_checks cascade from bookings
    db.exec('DELETE FROM bookings');
    db.exec('DELETE FROM grocery_items');
    db.exec('DELETE FROM todo_items');
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  console.log(`\nDone — bookings and lists cleared. ${stats.people} people and their codes are untouched.\n`);
}
