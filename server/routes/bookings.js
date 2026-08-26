import { Router } from 'express';
import { getDb, tx } from '../db.js';
import { requireUser, requireAdmin } from '../auth.js';
import { holidayForRange, holidayWindows } from '../holidays.js';

export const bookings = Router();

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Today in the server's local timezone as YYYY-MM-DD (the ranch's timezone). */
function localToday() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function isAdminish(user) {
  return user.role === 'admin' || user.role === 'sysadmin';
}

/**
 * The Loft (the barn) is the only shared room, and it is booked independently of
 * the house — "reserve the whole ranch" does not include it, and a whole-ranch
 * stay does not block someone else from taking it.
 */
function isShared(room) {
  return room.side === 'shared';
}

/** Rooms in the house proper — everything the whole-ranch option holds. */
function houseRoomIds(db) {
  return new Set(db.prepare(`SELECT id FROM rooms WHERE side != 'shared'`).all().map((r) => r.id));
}

/** Bookings that still hold dates. */
const ACTIVE = `('pending','approved')`;

/**
 * Find active bookings overlapping [start, end), optionally excluding one booking.
 * Overlap: existing.start < end AND start < existing.end (checkout day is a free turnover day).
 */
function overlapping(db, start, end, excludeId = 0) {
  return db
    .prepare(
      `SELECT b.id, b.is_full_ranch, b.status, b.start_date, b.end_date, u.name AS created_by_name
       FROM bookings b JOIN users u ON u.id = b.created_by
       WHERE b.status IN ${ACTIVE} AND b.id != ? AND b.start_date < ? AND ? < b.end_date`
    )
    .all(excludeId, end, start);
}

function roomsOf(db, bookingId) {
  return db
    .prepare(
      `SELECT r.id, r.key, r.name, r.side FROM booking_rooms br JOIN rooms r ON r.id = br.room_id WHERE br.booking_id = ?`
    )
    .all(bookingId);
}

/** Availability info for a date range: which rooms are taken, and by whom. */
bookings.get('/availability', requireUser, (req, res) => {
  const { from, to, exclude } = req.query;
  if (!DATE_RE.test(from || '') || !DATE_RE.test(to || '') || from >= to) {
    return res.status(400).json({ error: 'Invalid date range' });
  }
  const db = getDb();
  const excludeId = Number(exclude) || 0;
  const overlaps = overlapping(db, from, to, excludeId);

  const house = houseRoomIds(db);
  let fullRanchBlocked = null;
  const blockedRooms = {};
  for (const b of overlaps) {
    if (b.is_full_ranch) {
      fullRanchBlocked = { bookingId: b.id, by: b.created_by_name, status: b.status, start: b.start_date, end: b.end_date };
      // Fall through: a whole-ranch stay still needs its rooms marked taken so
      // the Loft shows as free unless that booking actually included it.
    }
    for (const r of roomsOf(db, b.id)) {
      const guests = db
        .prepare(
          `SELECT u.name FROM booking_guests bg JOIN users u ON u.id = bg.user_id WHERE bg.booking_id = ? AND bg.room_id = ?`
        )
        .all(b.id, r.id)
        .map((g) => g.name);
      blockedRooms[r.id] = { bookingId: b.id, status: b.status, guests, by: b.created_by_name };
    }
  }
  const anyBooking = overlaps.length > 0;
  // Only stays holding a house room stop the whole ranch being reserved — a
  // Loft-only booking does not.
  const anyHouseBooking = overlaps.some((b) => roomsOf(db, b.id).some((r) => house.has(r.id)));
  const holiday = holidayForRange(from, to);
  res.json({ fullRanchBlocked, blockedRooms, anyBooking, anyHouseBooking, holiday });
});

/** Holiday windows for calendar shading. */
bookings.get('/holidays', requireUser, (req, res) => {
  const year = Number(req.query.year) || new Date().getFullYear();
  res.json({ windows: [...holidayWindows(year), ...holidayWindows(year + 1)] });
});

function bookingPayload(db, row) {
  const rooms = db
    .prepare(
      `SELECT r.id, r.key, r.name, r.side FROM booking_rooms br JOIN rooms r ON r.id = br.room_id
       WHERE br.booking_id = ? ORDER BY r.sort_order`
    )
    .all(row.id);
  const guests = db
    .prepare(
      `SELECT bg.room_id, u.id AS user_id, u.name FROM booking_guests bg JOIN users u ON u.id = bg.user_id
       WHERE bg.booking_id = ?`
    )
    .all(row.id);
  const approvals = db
    .prepare(
      `SELECT a.admin_id, u.name AS admin_name, a.side, a.decision, a.note, a.created_at
       FROM approvals a JOIN users u ON u.id = a.admin_id WHERE a.booking_id = ? ORDER BY a.created_at`
    )
    .all(row.id);
  return {
    id: row.id,
    createdBy: row.created_by,
    createdByName: row.created_by_name,
    startDate: row.start_date,
    endDate: row.end_date,
    isFullRanch: !!row.is_full_ranch,
    status: row.status,
    notes: row.notes,
    isHoliday: !!row.is_holiday,
    holidayName: row.holiday_name,
    needs: { clore: !!row.needs_clore, gabriel: !!row.needs_gabriel, either: !!row.needs_either },
    rooms,
    guests,
    approvals,
    createdAt: row.created_at,
  };
}

const BOOKING_SELECT = `SELECT b.*, u.name AS created_by_name FROM bookings b JOIN users u ON u.id = b.created_by`;

/** List bookings overlapping a range (for the calendar), or all upcoming. */
bookings.get('/', requireUser, (req, res) => {
  const db = getDb();
  const { from, to, status } = req.query;
  let rows;
  if (DATE_RE.test(from || '') && DATE_RE.test(to || '')) {
    rows = db.prepare(`${BOOKING_SELECT} WHERE b.start_date < ? AND ? < b.end_date ORDER BY b.start_date`).all(to, from);
  } else {
    rows = db.prepare(`${BOOKING_SELECT} ORDER BY b.start_date DESC LIMIT 200`).all();
  }
  if (status) rows = rows.filter((r) => r.status === status);
  res.json({ bookings: rows.map((r) => bookingPayload(db, r)) });
});

/** Pending bookings the current admin can act on. */
bookings.get('/pending', requireAdmin, (req, res) => {
  const db = getDb();
  const rows = db.prepare(`${BOOKING_SELECT} WHERE b.status = 'pending' ORDER BY b.start_date`).all();
  res.json({ bookings: rows.map((r) => bookingPayload(db, r)) });
});

bookings.get('/:id', requireUser, (req, res) => {
  const db = getDb();
  const row = db.prepare(`${BOOKING_SELECT} WHERE b.id = ?`).get(Number(req.params.id));
  if (!row) return res.status(404).json({ error: 'Booking not found' });
  res.json({ booking: bookingPayload(db, row) });
});

/**
 * Validate + normalize a booking request body.
 * body: { startDate, endDate, isFullRanch, notes, rooms: [{roomId, guestIds:[..]}] }
 */
function parseBody(db, body) {
  const { startDate, endDate } = body;
  if (!DATE_RE.test(startDate || '') || !DATE_RE.test(endDate || '')) throw new Err(400, 'Pick valid dates');
  if (startDate >= endDate) throw new Err(400, 'Departure must be after arrival');
  if (startDate < localToday()) throw new Err(400, "That arrival date has already passed — pick today or later");
  const isFullRanch = !!body.isFullRanch;
  const allRooms = db.prepare('SELECT id, name, side, requires_approval FROM rooms').all();
  const roomById = new Map(allRooms.map((r) => [r.id, r]));

  let roomEntries = Array.isArray(body.rooms) ? body.rooms : [];
  roomEntries = roomEntries.filter((r) => roomById.has(Number(r.roomId)));

  let roomIds;
  if (isFullRanch) {
    // The Loft is the barn, not part of the house, so "the whole ranch" holds
    // the six house rooms only. It can still be added deliberately on top by
    // putting a guest in it.
    const picked = new Set(roomEntries.map((r) => Number(r.roomId)));
    roomIds = allRooms.filter((r) => !isShared(r) || picked.has(r.id)).map((r) => r.id);
  } else {
    roomIds = [...new Set(roomEntries.map((r) => Number(r.roomId)))];
    if (roomIds.length === 0) throw new Err(400, 'Select at least one room');
  }

  const guests = [];
  for (const entry of roomEntries) {
    const roomId = Number(entry.roomId);
    for (const gid of entry.guestIds || []) {
      const uid = Number(gid);
      if (uid) guests.push({ roomId, userId: uid });
    }
  }
  if (guests.length === 0) throw new Err(400, 'Add at least one guest');

  // One room per person per stay, and no unknown guests.
  const seenGuest = new Set();
  for (const g of guests) {
    const u = db.prepare('SELECT name FROM users WHERE id = ?').get(g.userId);
    if (!u) throw new Err(400, 'Unknown guest selected');
    if (seenGuest.has(g.userId)) {
      throw new Err(400, `${u.name} can only be in one room for this stay`);
    }
    seenGuest.add(g.userId);
  }

  // Every room in the booking must actually have a person in it —
  // a whole-ranch booking means every room, so every room needs a guest.
  const roomsWithGuests = new Set(guests.map((g) => g.roomId));
  const missing = roomIds.filter((rid) => !roomsWithGuests.has(rid));
  if (missing.length > 0) {
    const names = missing.map((rid) => roomById.get(rid).name).join(', ');
    throw new Err(400, isFullRanch
      ? `Whole-ranch bookings need a guest in every room — still empty: ${names}`
      : `Every booked room needs a guest — still empty: ${names}`);
  }

  return { startDate, endDate, isFullRanch, notes: String(body.notes || '').slice(0, 500), roomIds, guests, roomById };
}

class Err extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function checkConflicts(db, { startDate, endDate, isFullRanch, roomIds }, excludeId = 0) {
  const overlaps = overlapping(db, startDate, endDate, excludeId);
  const house = houseRoomIds(db);
  const wantsHouseRoom = roomIds.some((id) => house.has(id));

  // A whole-ranch booking holds the house, so it only blocks stays that want a
  // house room. The Loft stays bookable underneath it.
  if (wantsHouseRoom) {
    const full = overlaps.find((b) => b.is_full_ranch);
    if (full) {
      throw new Err(409, `The whole ranch is already booked ${full.start_date} to ${full.end_date} by ${full.created_by_name} (${full.status}).`);
    }
  }

  // Likewise, a Loft-only stay does not stop anyone reserving the whole ranch.
  if (isFullRanch) {
    const clash = overlaps.find((b) => roomsOf(db, b.id).some((r) => house.has(r.id)));
    if (clash) {
      throw new Err(409, `Can't book the whole ranch: ${clash.created_by_name} already has a room booked ${clash.start_date} to ${clash.end_date} (${clash.status}).`);
    }
  }

  // Room-by-room check runs for every booking, so the Loft is protected whether
  // or not this stay is a whole-ranch one.
  for (const b of overlaps) {
    const taken = roomsOf(db, b.id).filter((r) => roomIds.includes(r.id));
    if (taken.length > 0) {
      throw new Err(409, `${taken.map((r) => r.name).join(', ')} already booked ${b.start_date} to ${b.end_date} by ${b.created_by_name} (${b.status}).`);
    }
  }
}

/**
 * Approval rules:
 *  - Clore rooms need a Clore admin (Jimmy or Lynn); Gabriel rooms a Gabriel admin (Kevin or Pamela).
 *  - The Loft can be approved by an admin from either family.
 *  - Holiday stays and whole-ranch bookings need an admin from BOTH families.
 */
/** A person can't be in two bookings at once — check guests against other active stays. */
function checkGuestConflicts(db, parsed, excludeId = 0) {
  const ids = [...new Set(parsed.guests.map((g) => g.userId))];
  if (ids.length === 0) return;
  const placeholders = ids.map(() => '?').join(',');
  const clashes = db
    .prepare(
      `SELECT DISTINCT u.name, b.start_date, b.end_date
       FROM booking_guests bg
       JOIN bookings b ON b.id = bg.booking_id
       JOIN users u ON u.id = bg.user_id
       WHERE bg.user_id IN (${placeholders}) AND b.status IN ${ACTIVE} AND b.id != ?
         AND b.start_date < ? AND ? < b.end_date`
    )
    .all(...ids, excludeId, parsed.endDate, parsed.startDate);
  if (clashes.length > 0) {
    const msg = clashes.map((c) => `${c.name} is already booked ${c.start_date} to ${c.end_date}`).join('; ');
    throw new Err(409, `${msg}. One room per person at a time.`);
  }
}

function computeNeeds(parsed) {
  const approvalSides = new Set(
    parsed.roomIds.filter((id) => parsed.roomById.get(id).requires_approval).map((id) => parsed.roomById.get(id).side)
  );
  const holidayName = holidayForRange(parsed.startDate, parsed.endDate);
  const isHoliday = !!holidayName;
  const needsClore = parsed.isFullRanch || approvalSides.has('clore') || isHoliday;
  const needsGabriel = parsed.isFullRanch || approvalSides.has('gabriel') || isHoliday;
  const needsEither = !needsClore && !needsGabriel && approvalSides.has('shared');
  return { isHoliday, holidayName, needsClore, needsGabriel, needsEither };
}

function insertRoomsAndGuests(db, bookingId, parsed) {
  const insRoom = db.prepare('INSERT INTO booking_rooms (booking_id, room_id) VALUES (?, ?)');
  for (const roomId of parsed.roomIds) insRoom.run(bookingId, roomId);
  const insGuest = db.prepare('INSERT INTO booking_guests (booking_id, room_id, user_id) VALUES (?, ?, ?)');
  for (const g of parsed.guests) insGuest.run(bookingId, g.roomId, g.userId);
}

bookings.post('/', requireUser, (req, res) => {
  const db = getDb();
  try {
    const result = tx(db, () => {
      const parsed = parseBody(db, req.body);
      checkConflicts(db, parsed);
      checkGuestConflicts(db, parsed);
      const needs = computeNeeds(parsed);
      const status = needs.needsClore || needs.needsGabriel || needs.needsEither ? 'pending' : 'approved';
      const info = db
        .prepare(
          `INSERT INTO bookings (created_by, start_date, end_date, is_full_ranch, notes, status, is_holiday, holiday_name, needs_clore, needs_gabriel, needs_either)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          req.user.id, parsed.startDate, parsed.endDate, parsed.isFullRanch ? 1 : 0, parsed.notes, status,
          needs.isHoliday ? 1 : 0, needs.holidayName, needs.needsClore ? 1 : 0, needs.needsGabriel ? 1 : 0, needs.needsEither ? 1 : 0
        );
      insertRoomsAndGuests(db, Number(info.lastInsertRowid), parsed);
      return Number(info.lastInsertRowid);
    });
    const row = db.prepare(`${BOOKING_SELECT} WHERE b.id = ?`).get(result);
    res.status(201).json({ booking: bookingPayload(db, row) });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

bookings.patch('/:id', requireUser, (req, res) => {
  const db = getDb();
  const id = Number(req.params.id);
  const existing = db.prepare('SELECT * FROM bookings WHERE id = ?').get(id);
  if (!existing) return res.status(404).json({ error: 'Booking not found' });
  if (existing.created_by !== req.user.id && !isAdminish(req.user)) {
    return res.status(403).json({ error: 'Only the booker or an admin can edit this' });
  }
  if (existing.status === 'cancelled') return res.status(400).json({ error: 'Booking is cancelled' });
  try {
    tx(db, () => {
      const parsed = parseBody(db, req.body);
      checkConflicts(db, parsed, id);
      checkGuestConflicts(db, parsed, id);
      const needs = computeNeeds(parsed);
      db.prepare('DELETE FROM booking_rooms WHERE booking_id = ?').run(id);
      db.prepare('DELETE FROM booking_guests WHERE booking_id = ?').run(id);
      db.prepare('DELETE FROM approvals WHERE booking_id = ?').run(id); // edits require re-approval
      const status = needs.needsClore || needs.needsGabriel || needs.needsEither ? 'pending' : 'approved';
      db.prepare(
        `UPDATE bookings SET start_date=?, end_date=?, is_full_ranch=?, notes=?, is_holiday=?, holiday_name=?,
         needs_clore=?, needs_gabriel=?, needs_either=?, status=?, updated_at=datetime('now') WHERE id=?`
      ).run(
        parsed.startDate, parsed.endDate, parsed.isFullRanch ? 1 : 0, parsed.notes,
        needs.isHoliday ? 1 : 0, needs.holidayName, needs.needsClore ? 1 : 0, needs.needsGabriel ? 1 : 0, needs.needsEither ? 1 : 0, status, id
      );
      insertRoomsAndGuests(db, id, parsed);
    });
    const row = db.prepare(`${BOOKING_SELECT} WHERE b.id = ?`).get(id);
    res.json({ booking: bookingPayload(db, row) });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

bookings.post('/:id/cancel', requireUser, (req, res) => {
  const db = getDb();
  const id = Number(req.params.id);
  const existing = db.prepare('SELECT * FROM bookings WHERE id = ?').get(id);
  if (!existing) return res.status(404).json({ error: 'Booking not found' });
  if (existing.created_by !== req.user.id && !isAdminish(req.user)) {
    return res.status(403).json({ error: 'Only the booker or an admin can cancel this' });
  }
  db.prepare(`UPDATE bookings SET status='cancelled', updated_at=datetime('now') WHERE id=?`).run(id);
  const row = db.prepare(`${BOOKING_SELECT} WHERE b.id = ?`).get(id);
  res.json({ booking: bookingPayload(db, row) });
});

/**
 * Admin decision. Approval sides:
 *  - clore admin approval satisfies the Clore requirement
 *  - gabriel admin approval satisfies the Gabriel requirement
 *  - sysadmin counts for both (side 'both')
 * Booking approves when every required side is satisfied. Any rejection rejects it.
 */
bookings.post('/:id/decide', requireAdmin, (req, res) => {
  const db = getDb();
  const id = Number(req.params.id);
  const decision = req.body.decision === 'rejected' ? 'rejected' : 'approved';
  const note = String(req.body.note || '').slice(0, 300);
  const existing = db.prepare('SELECT * FROM bookings WHERE id = ?').get(id);
  if (!existing) return res.status(404).json({ error: 'Booking not found' });
  if (existing.status !== 'pending') return res.status(400).json({ error: `Booking is already ${existing.status}` });

  const side = req.user.role === 'sysadmin' ? 'both' : req.user.family;
  if (!side) return res.status(400).json({ error: 'Your account has no family side set' });

  try {
    tx(db, () => {
      db.prepare(
        `INSERT INTO approvals (booking_id, admin_id, side, decision, note) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT (booking_id, admin_id) DO UPDATE SET side=excluded.side, decision=excluded.decision, note=excluded.note, created_at=datetime('now')`
      ).run(id, req.user.id, side, decision, note);

      if (decision === 'rejected') {
        db.prepare(`UPDATE bookings SET status='rejected', updated_at=datetime('now') WHERE id=?`).run(id);
        return;
      }
      const approvals = db.prepare(`SELECT side FROM approvals WHERE booking_id=? AND decision='approved'`).all(id);
      const has = (s) => approvals.some((a) => a.side === s || a.side === 'both');
      const cloreOk = !existing.needs_clore || has('clore');
      const gabrielOk = !existing.needs_gabriel || has('gabriel');
      const eitherOk = !existing.needs_either || approvals.length > 0;
      if (cloreOk && gabrielOk && eitherOk) {
        db.prepare(`UPDATE bookings SET status='approved', updated_at=datetime('now') WHERE id=?`).run(id);
      }
    });
    const row = db.prepare(`${BOOKING_SELECT} WHERE b.id = ?`).get(id);
    res.json({ booking: bookingPayload(db, row) });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});
