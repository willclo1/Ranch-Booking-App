import { Router } from 'express';
import { getDb } from '../db.js';
import {
  hashPin, verifyPin, createSession, destroySession, readToken,
  setSessionCookie, clearSessionCookie, SYSADMIN_CODE,
  pinThrottle, pinFailed, pinSucceeded, requireUser,
} from '../auth.js';

export const auth = Router();

/** Names on the sign-in screen: family members only (no guests, no sysadmin). */
auth.get('/people', (_req, res) => {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT id, name, family, role, pin_hash IS NOT NULL AS hasPin FROM users
       WHERE role != 'sysadmin' AND is_guest = 0 ORDER BY name COLLATE NOCASE`
    )
    .all();
  res.json({ people: rows.map((r) => ({ id: r.id, name: r.name, family: r.family, role: r.role, hasPin: !!r.hasPin })) });
});

const PIN_RE = /^\d{4}$/;

/** First-time PIN creation — only while the account has no PIN yet. */
auth.post('/setup-pin', (req, res) => {
  const { userId, pin } = req.body || {};
  if (!PIN_RE.test(String(pin || ''))) return res.status(400).json({ error: 'PIN must be exactly 4 digits' });
  const db = getDb();
  const user = db.prepare(`SELECT * FROM users WHERE id = ? AND role != 'sysadmin' AND is_guest = 0`).get(Number(userId));
  if (!user) return res.status(404).json({ error: 'User not found' });
  if (user.pin_hash) return res.status(400).json({ error: 'PIN already set — ask an admin to reset it' });
  db.prepare('UPDATE users SET pin_hash = ? WHERE id = ?').run(hashPin(pin), user.id);
  const token = createSession(user.id);
  setSessionCookie(res, token);
  res.json({ user: { id: user.id, name: user.name, family: user.family, role: user.role } });
});

/** Self-signup from the sign-in screen: pick a name, create a code, you're in. */
auth.post('/register', (req, res) => {
  const name = String(req.body?.name || '').trim().slice(0, 40);
  const { pin } = req.body || {};
  if (name.length < 2) return res.status(400).json({ error: 'Name is too short' });
  if (/sysadmin/i.test(name)) return res.status(400).json({ error: 'That name is reserved' });
  if (!PIN_RE.test(String(pin || ''))) return res.status(400).json({ error: 'Code must be exactly 4 digits' });
  const db = getDb();
  const existing = db.prepare('SELECT id, name, is_guest, pin_hash FROM users WHERE name = ? COLLATE NOCASE').get(name);

  let userId;
  if (existing && existing.is_guest && !existing.pin_hash) {
    // This name already exists as a booking guest — claim it so their stays carry over.
    db.prepare(`UPDATE users SET is_guest = 0, pin_hash = ? WHERE id = ?`).run(hashPin(pin), existing.id);
    userId = existing.id;
  } else if (existing) {
    return res.status(409).json({ error: `${existing.name} is already on the list — pick them from the dropdown instead` });
  } else {
    const info = db.prepare(`INSERT INTO users (name, role, pin_hash, is_guest) VALUES (?, 'user', ?, 0)`).run(name, hashPin(pin));
    userId = Number(info.lastInsertRowid);
  }

  const user = db.prepare('SELECT id, name, family, role FROM users WHERE id = ?').get(userId);
  const token = createSession(user.id);
  setSessionCookie(res, token);
  res.json({ user });
});

auth.post('/login', (req, res) => {
  const { userId, pin } = req.body || {};
  const db = getDb();
  const user = db.prepare(`SELECT * FROM users WHERE id = ? AND role != 'sysadmin' AND is_guest = 0`).get(Number(userId));
  if (!user) return res.status(404).json({ error: 'User not found' });
  if (!user.pin_hash) return res.status(400).json({ error: 'No PIN set yet — create one first' });
  if (!pinThrottle(user.id)) return res.status(429).json({ error: 'Too many tries — wait a minute' });
  if (!verifyPin(pin, user.pin_hash)) {
    pinFailed(user.id);
    return res.status(401).json({ error: 'Wrong PIN' });
  }
  pinSucceeded(user.id);
  const token = createSession(user.id);
  setSessionCookie(res, token);
  res.json({ user: { id: user.id, name: user.name, family: user.family, role: user.role } });
});

/** Sysadmin access code sign-in (for testing/administration). */
auth.post('/sysadmin', (req, res) => {
  const { code } = req.body || {};
  if (String(code || '') !== SYSADMIN_CODE) return res.status(401).json({ error: 'Wrong access code' });
  const db = getDb();
  const user = db.prepare(`SELECT * FROM users WHERE role = 'sysadmin' LIMIT 1`).get();
  if (!user) return res.status(500).json({ error: 'Sysadmin account missing' });
  const token = createSession(user.id);
  setSessionCookie(res, token);
  res.json({ user: { id: user.id, name: user.name, family: user.family, role: user.role } });
});

auth.post('/logout', (req, res) => {
  destroySession(readToken(req));
  clearSessionCookie(res);
  res.json({ ok: true });
});

auth.get('/me', requireUser, (req, res) => {
  res.json({ user: req.user });
});
