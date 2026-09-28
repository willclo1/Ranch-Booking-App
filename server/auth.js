import { randomBytes, scryptSync, timingSafeEqual, createHash } from 'node:crypto';
import { getDb } from './db.js';

const SESSION_DAYS = 180;
export const SYSADMIN_CODE = process.env.SYSADMIN_CODE || 'LAGRANGE';

export function hashPin(pin) {
  const salt = randomBytes(16);
  const hash = scryptSync(String(pin), salt, 32);
  return `${salt.toString('hex')}:${hash.toString('hex')}`;
}

export function verifyPin(pin, stored) {
  if (!stored) return false;
  const [saltHex, hashHex] = stored.split(':');
  const salt = Buffer.from(saltHex, 'hex');
  const expected = Buffer.from(hashHex, 'hex');
  const actual = scryptSync(String(pin), salt, 32);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

function tokenHash(token) {
  return createHash('sha256').update(token).digest('hex');
}

export function createSession(userId) {
  const db = getDb();
  const token = randomBytes(32).toString('base64url');
  const expires = new Date(Date.now() + SESSION_DAYS * 86400000).toISOString();
  db.prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)').run(tokenHash(token), userId, expires);
  return token;
}

export function destroySession(token) {
  if (!token) return;
  getDb().prepare('DELETE FROM sessions WHERE token_hash = ?').run(tokenHash(token));
}

export function sessionUser(token) {
  if (!token) return null;
  const db = getDb();
  const row = db
    .prepare(`SELECT u.id, u.name, u.family, u.role FROM sessions s JOIN users u ON u.id = s.user_id
              WHERE s.token_hash = ? AND s.expires_at > datetime('now')`)
    .get(tokenHash(token));
  return row || null;
}

export function readToken(req) {
  const header = req.headers.cookie || '';
  for (const part of header.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === 'ranch_session') return decodeURIComponent(v.join('='));
  }
  return null;
}

/**
 * SameSite policy for the session cookie.
 *
 * Over HTTPS it is `SameSite=None; Secure; Partitioned`, so the app also works
 * framed inside the ranch's Home Assistant wall panel. A `SameSite=Lax`
 * cookie is neither stored nor sent in a cross-site iframe, so there every
 * sign-in silently failed and every API call came back signed-out.
 * `Partitioned` (CHIPS) keys the framed session to the embedding site: it is
 * separate from the standalone app's session and no other site can use it.
 *
 * Loosening SameSite gives up its CSRF protection; `requireSameOrigin` below
 * takes that job over. Plain-HTTP development keeps `Lax`, because browsers
 * reject `SameSite=None` without `Secure`. Caddy terminates TLS and forwards
 * `X-Forwarded-Proto`.
 */
function sameSite(res) {
  const req = res.req;
  const proto = String(req?.headers['x-forwarded-proto'] || '').split(',')[0].trim();
  return req?.secure || proto === 'https' ? 'SameSite=None; Secure; Partitioned' : 'SameSite=Lax';
}

export function setSessionCookie(res, token) {
  const maxAge = SESSION_DAYS * 86400;
  res.setHeader('Set-Cookie', `ranch_session=${encodeURIComponent(token)}; Path=/; HttpOnly; ${sameSite(res)}; Max-Age=${maxAge}`);
}

export function clearSessionCookie(res) {
  res.setHeader('Set-Cookie', `ranch_session=; Path=/; HttpOnly; ${sameSite(res)}; Max-Age=0`);
}

/**
 * CSRF guard for /api. The session cookie can be `SameSite=None` (see
 * sameSite above), so a request that changes something must come from this
 * app's own pages. Browsers always send `Origin` on a cross-site POST, PATCH
 * or DELETE; it must name this host. Requests without one (the API test
 * script, curl) are not from a browser page and pass.
 */
export function requireSameOrigin(req, res, next) {
  if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') return next();
  const origin = req.headers.origin;
  if (!origin) return next();
  let originHost = '';
  try {
    originHost = new URL(origin).host;
  } catch {
    /* "null" or garbage: refused below */
  }
  const host = String(req.headers['x-forwarded-host'] || req.headers.host || '').split(',')[0].trim();
  if (!originHost || originHost !== host) {
    return res.status(403).json({ error: 'Cross-site request refused' });
  }
  next();
}

/** Express middleware: attach req.user (or null). */
export function attachUser(req, _res, next) {
  req.user = sessionUser(readToken(req));
  next();
}

/** Express middleware: require a logged-in user. */
export function requireUser(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Not signed in' });
  next();
}

/** Express middleware: require admin or sysadmin. */
export function requireAdmin(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Not signed in' });
  if (req.user.role !== 'admin' && req.user.role !== 'sysadmin') {
    return res.status(403).json({ error: 'Admins only' });
  }
  next();
}

// Simple in-memory PIN attempt limiter: 5 fails -> 60s lockout per user.
const attempts = new Map();
export function pinThrottle(userId) {
  const a = attempts.get(userId);
  if (a && a.count >= 5 && Date.now() - a.last < 60000) return false;
  return true;
}
export function pinFailed(userId) {
  const a = attempts.get(userId) || { count: 0, last: 0 };
  const withinWindow = Date.now() - a.last < 60000;
  attempts.set(userId, { count: withinWindow ? a.count + 1 : 1, last: Date.now() });
}
export function pinSucceeded(userId) {
  attempts.delete(userId);
}
