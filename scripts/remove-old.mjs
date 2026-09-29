#!/usr/bin/env node
/**
 * Fully delete grocery and to-do items a set time after they were ticked off.
 * Archived items stay readable under Lists → Archive until then.
 *
 *   node scripts/remove-old.mjs              purge anything done >24h ago
 *   node scripts/remove-old.mjs --dry-run    report what would go, delete nothing
 *   PURGE_AFTER_HOURS=72 node scripts/remove-old.mjs
 *
 * Untouched items (never bought / never completed) are never deleted, however
 * old — only the archive is cleaned up.
 */
import { getDb, closeDb, tx } from '../server/db.js';

// PURGE_AFTER_DAYS is still honoured so an existing cron line keeps working.
const HOURS = Number(
  process.env.PURGE_AFTER_HOURS ?? (process.env.PURGE_AFTER_DAYS != null ? Number(process.env.PURGE_AFTER_DAYS) * 24 : 24)
);
const DRY_RUN = process.argv.includes('--dry-run');

if (!Number.isFinite(HOURS) || HOURS <= 0) {
  console.error(JSON.stringify({ at: new Date().toISOString(), error: `bad retention: ${HOURS} hours` }));
  process.exit(2);
}

// The cutoff is computed by SQLite, not by JS, and this matters. Rows store
// datetime('now') as "2026-09-27 23:59:00" while toISOString() produces
// "2026-09-27T23:59:00.000Z". Those are compared as strings, and when the date
// halves match, the space (0x20) sorts before the "T" (0x54) — so every row from
// the cutoff's own day looked older than the cutoff whatever its time of day.
// At 14 days that quietly deleted things up to a day early; at 24 hours it
// deleted items minutes after they were ticked.
const MODIFIER = `-${HOURS} hours`;

const db = getDb();

try {
  const cutoff = db.prepare(`SELECT datetime('now', ?) AS t`).get(MODIFIER).t;

  if (DRY_RUN) {
    const count = (table, col) =>
      db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE ${col} IS NOT NULL AND ${col} < ?`).get(cutoff).n;
    console.log(JSON.stringify({
      at: new Date().toISOString(), dryRun: true, retentionHours: HOURS, cutoff,
      groceries: count('grocery_items', 'bought_at'),
      todos: count('todo_items', 'completed_at'),
    }));
  } else {
    // tx() from server/db.js, not db.transaction() — that is a better-sqlite3
    // method and node:sqlite has no such thing, so the delete path always threw
    // and this script had never actually removed a row.
    const purged = tx(db, () => ({
      groceries: db.prepare(`DELETE FROM grocery_items WHERE bought_at IS NOT NULL AND bought_at < ?`).run(cutoff).changes,
      todos: db.prepare(`DELETE FROM todo_items WHERE completed_at IS NOT NULL AND completed_at < ?`).run(cutoff).changes,
    }));
    console.log(JSON.stringify({ at: new Date().toISOString(), retentionHours: HOURS, cutoff, ...purged }));
  }
} catch (err) {
  console.error(JSON.stringify({ at: new Date().toISOString(), error: err.message }));
  process.exitCode = 1;
} finally {
  closeDb();
}
