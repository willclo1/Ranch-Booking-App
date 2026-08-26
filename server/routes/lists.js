import { Router } from 'express';
import { getDb } from '../db.js';
import { requireUser } from '../auth.js';

/**
 * Grocery list + to-do list. Both record who added each item and when;
 * archives keep who bought/completed it and when.
 */
export const lists = Router();

function listRoutes(table, doneCol, doneByCol) {
  const r = Router();

  r.get('/', requireUser, (req, res) => {
    const db = getDb();
    const archived = req.query.archived === '1';
    const where = archived ? `${doneCol} IS NOT NULL` : `${doneCol} IS NULL`;
    const order = archived ? `${doneCol} DESC` : 'added_at DESC';
    const rows = db
      .prepare(
        `SELECT t.id, t.text, t.added_at, ua.name AS added_by_name, t.${doneCol} AS done_at, ud.name AS done_by_name
         FROM ${table} t
         JOIN users ua ON ua.id = t.added_by
         LEFT JOIN users ud ON ud.id = t.${doneByCol}
         WHERE ${where} ORDER BY ${order} LIMIT 500`
      )
      .all();
    res.json({
      items: rows.map((x) => ({
        id: x.id, text: x.text, addedAt: x.added_at, addedBy: x.added_by_name, doneAt: x.done_at, doneBy: x.done_by_name,
      })),
    });
  });

  r.post('/', requireUser, (req, res) => {
    const text = String(req.body?.text || '').trim().slice(0, 200);
    if (!text) return res.status(400).json({ error: 'Nothing to add' });
    const db = getDb();
    const info = db.prepare(`INSERT INTO ${table} (text, added_by) VALUES (?, ?)`).run(text, req.user.id);
    res.status(201).json({ id: Number(info.lastInsertRowid) });
  });

  r.post('/:id/done', requireUser, (req, res) => {
    const db = getDb();
    const info = db
      .prepare(`UPDATE ${table} SET ${doneCol} = datetime('now'), ${doneByCol} = ? WHERE id = ? AND ${doneCol} IS NULL`)
      .run(req.user.id, Number(req.params.id));
    if (info.changes === 0) return res.status(404).json({ error: 'Item not found or already done' });
    res.json({ ok: true });
  });

  r.post('/:id/undone', requireUser, (req, res) => {
    const db = getDb();
    const info = db
      .prepare(`UPDATE ${table} SET ${doneCol} = NULL, ${doneByCol} = NULL WHERE id = ?`)
      .run(Number(req.params.id));
    if (info.changes === 0) return res.status(404).json({ error: 'Item not found' });
    res.json({ ok: true });
  });

  r.delete('/:id', requireUser, (req, res) => {
    const db = getDb();
    const item = db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(Number(req.params.id));
    if (!item) return res.status(404).json({ error: 'Item not found' });
    const isAdminish = req.user.role === 'admin' || req.user.role === 'sysadmin';
    if (item.added_by !== req.user.id && !isAdminish) {
      return res.status(403).json({ error: 'Only the person who added it (or an admin) can delete it' });
    }
    db.prepare(`DELETE FROM ${table} WHERE id = ?`).run(item.id);
    res.json({ ok: true });
  });

  return r;
}

lists.use('/grocery', listRoutes('grocery_items', 'bought_at', 'bought_by'));
lists.use('/todos', listRoutes('todo_items', 'completed_at', 'completed_by'));
