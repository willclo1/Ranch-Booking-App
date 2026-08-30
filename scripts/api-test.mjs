// End-to-end API rule tests. Spawns its own server on a throwaway database,
// so it never touches the real family data. Run with: npm test
import { spawn } from 'node:child_process';
import { rmSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = 4949;
const BASE = `http://localhost:${PORT}`;
const tmpDir = mkdtempSync(join(tmpdir(), 'ranch-test-'));
const testDb = join(tmpDir, 'test.db');

const server = spawn(process.execPath, [join(__dirname, '..', 'server', 'index.js')], {
  env: { ...process.env, PORT: String(PORT), RANCH_DB: testDb },
  stdio: 'ignore',
});
function shutdown(code) {
  server.kill();
  setTimeout(() => {
    try { rmSync(tmpDir, { recursive: true, force: true }); } catch {}
    process.exit(code);
  }, 300);
}
// Wait for the server to come up
for (let i = 0; ; i++) {
  try {
    const res = await fetch(`${BASE}/api/health`);
    if (res.ok) break;
  } catch {}
  if (i > 50) { console.error('Test server never came up'); shutdown(1); }
  await new Promise((r) => setTimeout(r, 100));
}

let pass = 0, fail = 0;

// All booking dates are anchored to NEXT year so the suite never rots as time passes.
const Y = new Date().getFullYear() + 1;
const d = (mmdd) => `${Y}-${mmdd}`;
/** 4th Thursday of November in year Y (Thanksgiving) as YYYY-MM-DD. */
const thanksgiving = (() => {
  const first = new Date(Date.UTC(Y, 10, 1));
  const offset = (4 - first.getUTCDay() + 7) % 7; // 4 = Thursday
  const day = 1 + offset + 21;
  return `${Y}-11-${String(day).padStart(2, '0')}`;
})();
const dayAfter = (iso, n) => {
  const t = new Date(iso + 'T00:00:00Z');
  t.setUTCDate(t.getUTCDate() + n);
  return t.toISOString().slice(0, 10);
};

function check(name, cond, extra = '') {
  if (cond) { pass++; console.log(`  ok  ${name}`); }
  else { fail++; console.log(`FAIL  ${name} ${extra}`); }
}

class Session {
  constructor() { this.cookie = null; }
  async req(method, path, body) {
    const res = await fetch(BASE + path, {
      method,
      headers: { 'Content-Type': 'application/json', ...(this.cookie ? { Cookie: this.cookie } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const setCookie = res.headers.get('set-cookie');
    if (setCookie) this.cookie = setCookie.split(';')[0];
    let data = null;
    try { data = await res.json(); } catch {}
    return { status: res.status, data };
  }
  get(p) { return this.req('GET', p); }
  post(p, b) { return this.req('POST', p, b ?? {}); }
  patch(p, b) { return this.req('PATCH', p, b); }
}

const will = new Session();
const jimmy = new Session();
const kevin = new Session();
const erin = new Session();

// --- Auth ---
console.log('\n--- auth ---');
let r = await will.post('/api/auth/setup-pin', { userId: 5, pin: '1111' });
if (r.status === 400) r = await will.post('/api/auth/login', { userId: 5, pin: '1111' });
check('Will signs in', r.status === 200 && r.data.user.name === 'Will', JSON.stringify(r.data));

r = await jimmy.post('/api/auth/setup-pin', { userId: 1, pin: '2222' });
if (r.status === 400) r = await jimmy.post('/api/auth/login', { userId: 1, pin: '2222' });
check('Jimmy signs in (clore admin)', r.status === 200 && r.data.user.role === 'admin');

r = await kevin.post('/api/auth/setup-pin', { userId: 3, pin: '3333' });
if (r.status === 400) r = await kevin.post('/api/auth/login', { userId: 3, pin: '3333' });
check('Kevin signs in (gabriel admin)', r.status === 200 && r.data.user.family === 'gabriel');

r = await erin.post('/api/auth/setup-pin', { userId: 6, pin: '4444' });
if (r.status === 400) r = await erin.post('/api/auth/login', { userId: 6, pin: '4444' });
check('Erin signs in (regular user)', r.status === 200);

r = await will.post('/api/auth/login', { userId: 5, pin: '9999' });
check('Wrong PIN rejected', r.status === 401);

r = await new Session().post('/api/auth/setup-pin', { userId: 10, pin: '12345' });
check('non-4-digit PIN rejected', r.status === 400);

const newbie = new Session();
r = await newbie.post('/api/auth/register', { name: 'Cody', pin: '4321' });
check('new user self-registers from sign-in screen', r.status === 200 && r.data.user.name === 'Cody', JSON.stringify(r.data));
r = await newbie.get('/api/auth/me');
check('registered user is signed in', r.status === 200);
r = await new Session().post('/api/auth/register', { name: 'cody', pin: '9999' });
check('register with taken name rejected', r.status === 409);
r = await new Session().post('/api/auth/register', { name: 'Dee', pin: '12' });
check('register needs a 4-digit code', r.status === 400);

// --- Rooms ---
const roomsRes = await will.get('/api/rooms');
const rooms = Object.fromEntries(roomsRes.data.rooms.map((x) => [x.key, x]));
check('7 rooms', roomsRes.data.rooms.length === 7);
// A guest in every room - required for whole-ranch bookings (user ids 1-7 are seeded).
const allRoomGuests = roomsRes.data.rooms.map((rm, i) => ({ roomId: rm.id, guestIds: [i + 1] }));
// The six house rooms only. "Reserve the whole ranch" holds these; the Loft is
// a special case that books on its own.
const houseRoomGuests = roomsRes.data.rooms
  .filter((rm) => rm.side !== 'shared')
  .map((rm, i) => ({ roomId: rm.id, guestIds: [i + 1] }));

// --- Booking: gabriel room only, non-holiday ---
console.log('\n--- gabriel room booking (Oct 2-4, no holiday) ---');
r = await will.post('/api/bookings', {
  startDate: d('10-02'), endDate: d('10-04'),
  rooms: [{ roomId: rooms.guest3.id, guestIds: [5, 6] }],
});
const b1 = r.data.booking;
check('created pending', r.status === 201 && b1.status === 'pending', JSON.stringify(r.data));
check('needs gabriel only', b1.needs.gabriel === true && b1.needs.clore === false && b1.needs.either === false);
check('not holiday', b1.isHoliday === false);

r = await jimmy.post(`/api/bookings/${b1.id}/decide`, { decision: 'approved' });
check('clore admin approval does NOT approve gabriel room', r.data.booking.status === 'pending');

r = await erin.post(`/api/bookings/${b1.id}/decide`, { decision: 'approved' });
check('regular user cannot decide', r.status === 403);

r = await kevin.post(`/api/bookings/${b1.id}/decide`, { decision: 'approved' });
check('gabriel admin approval approves it', r.data.booking.status === 'approved');

// --- Conflicts ---
console.log('\n--- conflicts ---');
r = await erin.post('/api/bookings', {
  startDate: d('10-03'), endDate: d('10-05'),
  rooms: [{ roomId: rooms.guest3.id, guestIds: [6] }],
});
check('overlapping same room blocked (409)', r.status === 409, JSON.stringify(r.data));

r = await erin.post('/api/bookings', {
  startDate: `${Y - 2}-06-01`, endDate: `${Y - 2}-06-03`,
  rooms: [{ roomId: rooms.guest4.id, guestIds: [6] }],
});
check('past dates rejected', r.status === 400, JSON.stringify(r.data));

r = await erin.post('/api/bookings', {
  startDate: d('10-04'), endDate: d('10-06'),
  rooms: [{ roomId: rooms.guest3.id, guestIds: [6] }],
});
check('same-day turnover allowed (start on checkout day)', r.status === 201);
const bTurnover = r.data.booking;

r = await erin.post('/api/bookings', {
  startDate: d('10-03'), endDate: d('10-05'),
  rooms: [{ roomId: rooms.guest1.id, guestIds: [6] }],
});
check('same person in two overlapping bookings blocked', r.status === 409, JSON.stringify(r.data));

r = await erin.post('/api/bookings', {
  startDate: d('10-03'), endDate: d('10-05'),
  rooms: [{ roomId: rooms.guest1.id, guestIds: [7] }, { roomId: rooms.guest2.id, guestIds: [7] }],
});
check('same person in two rooms of one booking blocked', r.status === 400);

r = await erin.post('/api/bookings', {
  startDate: d('10-03'), endDate: d('10-05'),
  rooms: [{ roomId: rooms.guest1.id, guestIds: [7] }],
});
check('different room same dates allowed', r.status === 201);
const bOther = r.data.booking;

r = await will.post('/api/bookings', {
  startDate: d('10-01'), endDate: d('10-08'), isFullRanch: true,
  rooms: allRoomGuests,
});
check('full-ranch over existing bookings blocked', r.status === 409);

// --- Full ranch on clear dates ---
console.log('\n--- full ranch (Nov 6-8) ---');
r = await will.post('/api/bookings', {
  startDate: d('11-06'), endDate: d('11-08'), isFullRanch: true,
  rooms: [{ roomId: rooms.master1.id, guestIds: [5] }],
});
check('full ranch with empty rooms rejected', r.status === 400);

r = await will.post('/api/bookings', {
  startDate: d('11-06'), endDate: d('11-08'), isFullRanch: true,
  rooms: allRoomGuests,
});
const bFull = r.data.booking;
check('full ranch created (guest in every room)', r.status === 201, JSON.stringify(r.data));
check('full ranch with the loft added holds all 7 rooms', bFull.rooms.length === 7);
check('needs both sides', bFull.needs.clore && bFull.needs.gabriel);

r = await erin.post('/api/bookings', {
  startDate: d('11-07'), endDate: d('11-09'),
  rooms: [{ roomId: rooms.loft.id, guestIds: [6] }],
});
check('pending full-ranch blocks other bookings', r.status === 409);

r = await jimmy.post(`/api/bookings/${bFull.id}/decide`, { decision: 'approved' });
check('one side not enough for full ranch', r.data.booking.status === 'pending');
r = await kevin.post(`/api/bookings/${bFull.id}/decide`, { decision: 'approved' });
check('both sides approve full ranch', r.data.booking.status === 'approved');

// --- The Loft is not part of "the whole ranch" ---
console.log('\n--- whole ranch excludes the loft ---');
r = await will.post('/api/bookings', {
  startDate: d('09-10'), endDate: d('09-12'), isFullRanch: true,
  rooms: houseRoomGuests,
});
const bHouse = r.data.booking;
check('whole ranch created with only house guests', r.status === 201, JSON.stringify(r.data));
check('whole ranch holds just the 6 house rooms', bHouse.rooms.length === 6);
check('whole ranch does not include the loft', !bHouse.rooms.some((rm) => rm.side === 'shared'));

r = await erin.post('/api/bookings', {
  startDate: d('09-10'), endDate: d('09-12'),
  rooms: [{ roomId: rooms.loft.id, guestIds: [10] }],
});
check('loft still bookable during a whole-ranch stay', r.status === 201, JSON.stringify(r.data));

// ...and the reverse: a loft stay must not block reserving the whole ranch.
r = await erin.post('/api/bookings', {
  startDate: d('09-18'), endDate: d('09-20'),
  rooms: [{ roomId: rooms.loft.id, guestIds: [10] }],
});
check('loft-only booking on clear dates', r.status === 201);
r = await will.post('/api/bookings', {
  startDate: d('09-18'), endDate: d('09-20'), isFullRanch: true,
  rooms: houseRoomGuests,
});
check('whole ranch allowed alongside a loft booking', r.status === 201, JSON.stringify(r.data));

// Adding the loft to a whole-ranch stay on purpose still holds it against others.
r = await will.post('/api/bookings', {
  startDate: d('09-24'), endDate: d('09-26'), isFullRanch: true,
  rooms: allRoomGuests,
});
check('whole ranch can still include the loft deliberately', r.status === 201 && r.data.booking.rooms.length === 7, JSON.stringify(r.data));
r = await erin.post('/api/bookings', {
  startDate: d('09-24'), endDate: d('09-26'),
  rooms: [{ roomId: rooms.loft.id, guestIds: [10] }],
});
check('loft blocked when the whole-ranch stay included it', r.status === 409);

// --- Loft only: either admin ---
console.log('\n--- loft-only booking ---');
r = await erin.post('/api/bookings', {
  startDate: d('10-09'), endDate: d('10-11'),
  rooms: [{ roomId: rooms.loft.id, guestIds: [6, 10] }],
});
const bLoft = r.data.booking;
check('loft-only needs either', bLoft.needs.either === true && !bLoft.needs.clore && !bLoft.needs.gabriel);
r = await jimmy.post(`/api/bookings/${bLoft.id}/decide`, { decision: 'approved' });
check('any admin approves loft', r.data.booking.status === 'approved');

// --- Holiday: Thanksgiving (4th Thursday of November) ---
console.log('\n--- holiday booking (Thanksgiving) ---');
r = await will.post('/api/bookings', {
  startDate: thanksgiving, endDate: dayAfter(thanksgiving, 2),
  rooms: [{ roomId: rooms.guest1.id, guestIds: [5] }],
});
const bHol = r.data.booking;
check('thanksgiving flagged holiday', bHol.isHoliday === true && bHol.holidayName === 'Thanksgiving', JSON.stringify(bHol));
// Holidays are surfaced in the UI but carry no extra approval weight: a
// Clore-only room over Thanksgiving needs exactly one Clore admin, same as any
// other week.
check('holiday clore-only room needs clore', bHol.needs.clore === true);
check('holiday does NOT drag in the other side', bHol.needs.gabriel === false, JSON.stringify(bHol.needs));
r = await jimmy.post(`/api/bookings/${bHol.id}/decide`, { decision: 'approved' });
check('one clore admin fully approves a holiday stay', r.data.booking.status === 'approved', JSON.stringify(r.data));

// --- Edit resets approvals ---
console.log('\n--- edit re-approval ---');
r = await will.patch(`/api/bookings/${b1.id}`, {
  startDate: d('10-02'), endDate: d('10-04'),
  rooms: [{ roomId: rooms.guest3.id, guestIds: [5] }],
});
check('edit approved booking -> pending again', r.data.booking.status === 'pending', JSON.stringify(r.data));
check('approvals cleared on edit', r.data.booking.approvals.length === 0);

r = await erin.patch(`/api/bookings/${b1.id}`, {
  startDate: d('10-02'), endDate: d('10-04'),
  rooms: [{ roomId: rooms.guest3.id, guestIds: [6] }],
});
check('non-owner non-admin cannot edit', r.status === 403);

// --- Rejection ---
r = await kevin.post(`/api/bookings/${bTurnover.id}/decide`, { decision: 'rejected', note: 'Ranch maintenance' });
check('rejection rejects booking', r.data.booking.status === 'rejected');
r = await erin.post('/api/bookings', {
  startDate: d('10-04'), endDate: d('10-06'),
  rooms: [{ roomId: rooms.guest3.id, guestIds: [6] }],
});
check('rejected booking releases dates', r.status === 201);
await will.post(`/api/bookings/${r.data.booking.id}/cancel`);

// --- Cancel ---
r = await erin.post(`/api/bookings/${bOther.id}/cancel`);
check('creator can cancel', r.data.booking.status === 'cancelled');

// --- Lists ---
console.log('\n--- grocery + todo lists ---');
r = await will.post('/api/lists/grocery', { text: 'Brisket rub' });
const gId = r.data.id;
check('grocery added', r.status === 201);
r = await erin.post(`/api/lists/grocery/${gId}/done`);
check('grocery marked bought', r.status === 200);
r = await will.get('/api/lists/grocery?archived=1');
const gItem = r.data.items.find((i) => i.id === gId);
check('archive shows adder + buyer', gItem && gItem.addedBy === 'Will' && gItem.doneBy === 'Erin', JSON.stringify(gItem));
r = await erin.post('/api/lists/todos', { text: 'Fix gate latch' });
check('todo added', r.status === 201);
const tId = r.data.id;
r = await jimmy.req('DELETE', `/api/lists/todos/${tId}`);
check('admin can delete others items', r.status === 200);

// --- Checklists ---
console.log('\n--- checklists ---');
// The check-in / check-out lists are standard across every stay, so only admins
// maintain them. Everyone else reads them and ticks them off on their booking.
r = await jimmy.post('/api/checklists/templates', { type: 'checkout', text: 'Take trash to the bin' });
const ckTpl = r.data.id;
check('admin adds a template item', r.status === 201, JSON.stringify(r.data));

r = await will.post('/api/checklists/templates', { type: 'checkout', text: 'Regular user step' });
check('regular user cannot add a template item', r.status === 403, JSON.stringify(r.data));
r = await will.patch(`/api/checklists/templates/${ckTpl}`, { text: 'Renamed by a regular user' });
check('regular user cannot reword a template item', r.status === 403);
r = await will.req('DELETE', `/api/checklists/templates/${ckTpl}`);
check('regular user cannot delete a template item', r.status === 403);

r = await will.get('/api/checklists/templates');
check('regular user can still read the lists', r.status === 200 && r.data.checkout.some((i) => i.id === ckTpl));
check('template survived the regular user', r.data.checkout.find((i) => i.id === ckTpl).text === 'Take trash to the bin');

r = await will.post(`/api/checklists/booking/${bFull.id}/toggle`, { templateItemId: ckTpl });
check('regular user can tick an item off', r.data.checked === true);
r = await will.get(`/api/checklists/booking/${bFull.id}`);
const ckItem = r.data.checkout.find((i) => i.id === ckTpl);
check('check shows who/when', ckItem.checked_by === 'Will' && !!ckItem.checked_at);

r = await jimmy.patch(`/api/checklists/templates/${ckTpl}`, { text: 'Take trash to the bins' });
check('admin can reword a template item', r.status === 200);
r = await jimmy.req('DELETE', `/api/checklists/templates/${ckTpl}`);
check('admin deletes a template item', r.status === 200);

// --- Users ---
console.log('\n--- users ---');
r = await erin.post('/api/users', { name: 'Cousin Ray' });
check('anyone can add a guest name', r.status === 201);
const rayId = r.data.user.id;
check('added name defaults to guest', r.data.user.isGuest === true, JSON.stringify(r.data));

let people = (await new Session().get('/api/auth/people')).data.people;
check('guest hidden from sign-in dropdown', !people.some((p) => p.id === rayId));
check('family members still on sign-in dropdown', people.some((p) => p.name === 'Will'));
check('guest appears in booking roster', (await erin.get('/api/users')).data.users.some((u) => u.id === rayId));

r = await new Session().post('/api/auth/setup-pin', { userId: rayId, pin: '5555' });
check('guest cannot create a sign-in code', r.status === 404);

// A guest can still be booked into a room.
r = await erin.post('/api/bookings', {
  startDate: d('12-01'), endDate: d('12-03'),
  rooms: [{ roomId: rooms.guest2.id, guestIds: [rayId] }],
});
check('guest can be booked into a room', r.status === 201, JSON.stringify(r.data));
const bGuest = r.data.booking;
check('guest name shows on the booking', bGuest.guests.some((g) => g.name === 'Cousin Ray'));
await will.post(`/api/bookings/${bGuest.id}/cancel`);

// Guests can later claim their own account, keeping their history.
const ray = new Session();
r = await ray.post('/api/auth/register', { name: 'Cousin Ray', pin: '5678' });
check('guest can claim an account with the same name', r.status === 200 && r.data.user.id === rayId, JSON.stringify(r.data));
people = (await new Session().get('/api/auth/people')).data.people;
check('claimed guest now appears on sign-in', people.some((p) => p.id === rayId));

r = await jimmy.patch(`/api/users/${rayId}`, { isGuest: true });
check('admin can turn a member back into a guest', r.status === 200 && r.data.user.isGuest === true);
r = await erin.post('/api/users', { name: 'cousin ray' });
check('duplicate name (case-insensitive) rejected', r.status === 409);
r = await erin.patch(`/api/users/${rayId}`, { family: 'clore' });
check('regular user cannot manage people', r.status === 403);
r = await erin.patch('/api/users/6', { phone: '832-555-0142' });
check('user sets their own phone', r.status === 200 && r.data.user.phone === '+18325550142', JSON.stringify(r.data));
r = await erin.patch('/api/users/5', { phone: '832-555-0000' });
check("user cannot set someone else's phone", r.status === 403);
r = await jimmy.patch(`/api/users/${rayId}`, { family: 'clore' });
check('admin sets family side', r.status === 200 && r.data.user.family === 'clore');
r = await jimmy.patch(`/api/users/${rayId}`, { role: 'admin' });
check('admin cannot promote (sysadmin only)', r.status === 403);
r = await jimmy.req('DELETE', `/api/users/${rayId}`);
check('guest with bookings cannot be deleted', r.status === 409, JSON.stringify(r.data));

r = await erin.post('/api/users', { name: 'Typo Name' });
const typoId = r.data.user.id;
r = await jimmy.req('DELETE', `/api/users/${typoId}`);
check('unused guest can be deleted', r.status === 200);

console.log(`\n${pass} passed, ${fail} failed`);
shutdown(fail > 0 ? 1 : 0);

