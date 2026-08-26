import { Router } from 'express';
import { getDb } from '../db.js';
import { requireUser } from '../auth.js';

/**
 * Check-in / check-out checklist templates (open CRUD — the family maintains them),
 * plus per-booking completion runs recording who checked what and when.
 */
export const checklists = Router();

const TYPES = new Set(['checkin', 'checkout']);

checklists.get('/templates', requireUser, (_req, res) => {
  const db = getDb();
  const rows = db.prepare('SELECT id, type, text, sort_order FROM checklist_templates ORDER BY type, sort_order, id').all();
  res.json({
    checkin: rows.filter((r) => r.type === 'checkin'),
    checkout: rows.filter((r) => r.type === 'checkout'),
  });
});

checklists.post('/templates', requireUser, (req, res) => {
  const { type } = req.body || {};
  const text = String(req.body?.text || '').trim().slice(0, 200);
  if (!TYPES.has(type)) return res.status(400).json({ error: 'Invalid checklist type' });
  if (!text) return res.status(400).json({ error: 'Item text required' });
  const db = getDb();
  const max = db.prepare('SELECT COALESCE(MAX(sort_order), 0) AS m FROM checklist_templates WHERE type = ?').get(type).m;
  const info = db
    .prepare('INSERT INTO checklist_templates (type, text, sort_order, created_by) VALUES (?, ?, ?, ?)')
    .run(type, text, max + 1, req.user.id);
  res.status(201).json({ id: Number(info.lastInsertRowid) });
});

checklists.patch('/templates/:id', requireUser, (req, res) => {
  const db = getDb();
  const id = Number(req.params.id);
  const item = db.prepare('SELECT * FROM checklist_templates WHERE id = ?').get(id);
  if (!item) return res.status(404).json({ error: 'Item not found' });
  if ('text' in (req.body || {})) {
    const text = String(req.body.text || '').trim().slice(0, 200);
    if (text) db.prepare('UPDATE checklist_templates SET text = ? WHERE id = ?').run(text, id);
  }
  if ('sortOrder' in (req.body || {})) {
    db.prepare('UPDATE checklist_templates SET sort_order = ? WHERE id = ?').run(Number(req.body.sortOrder) || 0, id);
  }
  res.json({ ok: true });
});

checklists.delete('/templates/:id', requireUser, (req, res) => {
  const db = getDb();
  const info = db.prepare('DELETE FROM checklist_templates WHERE id = ?').run(Number(req.params.id));
  if (info.changes === 0) return res.status(404).json({ error: 'Item not found' });
  res.json({ ok: true });
});

/** Checklist state for one booking: every template item + whether/who/when checked. */
checklists.get('/booking/:bookingId', requireUser, (req, res) => {
  const db = getDb();
  const bookingId = Number(req.params.bookingId);
  const booking = db.prepare('SELECT id FROM bookings WHERE id = ?').get(bookingId);
  if (!booking) return res.status(404).json({ error: 'Booking not found' });
  const rows = db
    .prepare(
      `SELECT t.id, t.type, t.text, t.sort_order, c.checked_at, u.name AS checked_by
       FROM checklist_templates t
       LEFT JOIN checklist_checks c ON c.template_item_id = t.id AND c.booking_id = ?
       LEFT JOIN users u ON u.id = c.checked_by
       ORDER BY t.type, t.sort_order, t.id`
    )
    .all(bookingId);
  res.json({
    checkin: rows.filter((r) => r.type === 'checkin'),
    checkout: rows.filter((r) => r.type === 'checkout'),
  });
});

checklists.post('/booking/:bookingId/toggle', requireUser, (req, res) => {
  const db = getDb();
  const bookingId = Number(req.params.bookingId);
  const itemId = Number(req.body?.templateItemId);
  const booking = db.prepare('SELECT id FROM bookings WHERE id = ?').get(bookingId);
  const item = db.prepare('SELECT id FROM checklist_templates WHERE id = ?').get(itemId);
  if (!booking || !item) return res.status(404).json({ error: 'Not found' });
  const existing = db
    .prepare('SELECT id FROM checklist_checks WHERE booking_id = ? AND template_item_id = ?')
    .get(bookingId, itemId);
  if (existing) {
    db.prepare('DELETE FROM checklist_checks WHERE id = ?').run(existing.id);
    res.json({ checked: false });
  } else {
    db.prepare('INSERT INTO checklist_checks (booking_id, template_item_id, checked_by) VALUES (?, ?, ?)').run(bookingId, itemId, req.user.id);
    res.json({ checked: true });
  }
});
