import { Router } from 'express';
import { getDb } from '../db.js';
import { requireUser, requireAdmin } from '../auth.js';
import { normalizePhone } from '../phone.js';

export const users = Router();

/** Everyone bookable (dropdown roster) — excludes the sysadmin account. */
users.get('/', requireUser, (_req, res) => {
  const db = getDb();
  const rows = db
    .prepare(`SELECT id, name, family, role, phone, pin_hash IS NOT NULL AS hasPin, created_at FROM users WHERE role != 'sysadmin' ORDER BY name COLLATE NOCASE`)
    .all();
  res.json({
    users: rows.map((r) => ({ id: r.id, name: r.name, family: r.family, role: r.role, phone: r.phone, hasPin: !!r.hasPin, createdAt: r.created_at })),
  });
});

/** "Add a name" from the booking dropdown — any signed-in user can add a guest. */
users.post('/', requireUser, (req, res) => {
  const name = String(req.body?.name || '').trim().slice(0, 40);
  if (name.length < 2) return res.status(400).json({ error: 'Name is too short' });
  if (/sysadmin/i.test(name)) return res.status(400).json({ error: 'That name is reserved' });
  const db = getDb();
  const existing = db.prepare('SELECT id, name FROM users WHERE name = ? COLLATE NOCASE').get(name);
  if (existing) return res.status(409).json({ error: `${existing.name} is already on the list` });
  const info = db.prepare(`INSERT INTO users (name, role) VALUES (?, 'user')`).run(name);
  const row = db.prepare('SELECT id, name, family, role FROM users WHERE id = ?').get(Number(info.lastInsertRowid));
  res.status(201).json({ user: { ...row, hasPin: false } });
});

/**
 * Update a person. Anyone can update their OWN phone number; everything else
 * (family side, name, PIN reset, roles) is admin territory.
 */
users.patch('/:id', requireUser, (req, res) => {
  const db = getDb();
  const id = Number(req.params.id);
  const target = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  if (!target) return res.status(404).json({ error: 'User not found' });
  if (target.role === 'sysadmin') return res.status(403).json({ error: 'Cannot modify the sysadmin account' });

  const body = req.body || {};
  const isAdmin = req.user.role === 'admin' || req.user.role === 'sysadmin';
  const isSelf = req.user.id === id;
  if (!isAdmin) {
    if (!isSelf) return res.status(403).json({ error: 'You can only edit your own profile' });
    if (Object.keys(body).some((k) => k !== 'phone')) {
      return res.status(403).json({ error: 'You can only change your own phone number' });
    }
  }

  if ('family' in body) {
    const family = body.family === 'clore' || body.family === 'gabriel' ? body.family : null;
    db.prepare('UPDATE users SET family = ? WHERE id = ?').run(family, id);
  }
  if ('phone' in body) {
    const raw = String(body.phone || '').trim();
    if (raw === '') {
      db.prepare('UPDATE users SET phone = NULL WHERE id = ?').run(id);
    } else {
      const phone = normalizePhone(raw);
      if (!phone) return res.status(400).json({ error: 'Enter a valid phone number (e.g. 832-555-1234)' });
      db.prepare('UPDATE users SET phone = ? WHERE id = ?').run(phone, id);
    }
  }
  if ('role' in body) {
    if (req.user.role !== 'sysadmin') return res.status(403).json({ error: 'Only the sysadmin can change roles' });
    const role = body.role === 'admin' ? 'admin' : 'user';
    db.prepare('UPDATE users SET role = ? WHERE id = ?').run(role, id);
  }
  if (body.resetPin) {
    db.prepare('UPDATE users SET pin_hash = NULL WHERE id = ?').run(id);
    db.prepare('DELETE FROM sessions WHERE user_id = ?').run(id);
  }
  if ('name' in body) {
    const name = String(body.name || '').trim().slice(0, 40);
    if (name.length >= 2) {
      const clash = db.prepare('SELECT id FROM users WHERE name = ? COLLATE NOCASE AND id != ?').get(name, id);
      if (clash) return res.status(409).json({ error: 'That name is taken' });
      db.prepare('UPDATE users SET name = ? WHERE id = ?').run(name, id);
    }
  }
  const row = db.prepare('SELECT id, name, family, role, phone, pin_hash IS NOT NULL AS hasPin FROM users WHERE id = ?').get(id);
  res.json({ user: { id: row.id, name: row.name, family: row.family, role: row.role, phone: row.phone, hasPin: !!row.hasPin } });
});

/** Delete a user who has never been part of a booking (admin cleanup of typos). */
users.delete('/:id', requireAdmin, (req, res) => {
  const db = getDb();
  const id = Number(req.params.id);
  const target = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  if (!target) return res.status(404).json({ error: 'User not found' });
  if (target.role === 'sysadmin') return res.status(403).json({ error: 'Cannot delete the sysadmin account' });
  const used =
    db.prepare('SELECT COUNT(*) AS n FROM booking_guests WHERE user_id = ?').get(id).n +
    db.prepare('SELECT COUNT(*) AS n FROM bookings WHERE created_by = ?').get(id).n;
  if (used > 0) return res.status(409).json({ error: 'This person is part of bookings and cannot be deleted' });
  db.prepare('DELETE FROM users WHERE id = ?').run(id);
  res.json({ ok: true });
});

export const rooms = Router();

rooms.get('/', requireUser, (_req, res) => {
  const db = getDb();
  const rows = db.prepare('SELECT id, key, name, side, sort_order, requires_approval FROM rooms ORDER BY sort_order').all();
  res.json({ rooms: rows });
});
