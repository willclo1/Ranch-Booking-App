#!/usr/bin/env node
import { getDb, closeDb } from '../server/db.js';

const DAYS = Number(process.env.PURGE_AFTER_DAYS ?? 14);
const DRY_RUN = process.argv.includes('--dry-run');
const cutoff = new Date(Date.now() - DAYS * 864e5).toISOString();

const db = getDb();

try {
  if (DRY_RUN) {
    const count = (table, col) =>
      db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE ${col} IS NOT NULL AND ${col} < ?`).get(cutoff).n;
    console.log(JSON.stringify({
      at: new Date().toISOString(), dryRun: true, cutoff,
      groceries: count('grocery_items', 'bought_at'),
      todos: count('todo_items', 'completed_at'),
    }));
  } else {
    const purge = db.transaction((before) => ({
      groceries: db.prepare(`DELETE FROM grocery_items WHERE bought_at IS NOT NULL AND bought_at < ?`).run(before).changes,
      todos: db.prepare(`DELETE FROM todo_items WHERE completed_at IS NOT NULL AND completed_at < ?`).run(before).changes,
    }));
    console.log(JSON.stringify({ at: new Date().toISOString(), cutoff, ...purge(cutoff) }));
  }
} catch (err) {
  console.error(JSON.stringify({ at: new Date().toISOString(), error: err.message }));
  process.exitCode = 1;
} finally {
  closeDb();
}