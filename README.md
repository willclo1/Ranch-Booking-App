# AV Ranch — La Grange

Family booking PWA for the AV Ranch: room reservations with family-side admin approvals,
a shared calendar, grocery & to-do lists, and check-in/check-out checklists.

Built to run on a home PC or server with **zero external services**: Node.js + Express +
SQLite (Node's built-in `node:sqlite` — no native modules, no database server).

## Quick start

```bash
npm install
npm run setup     # creates data/ranch.db with the family + rooms (safe to re-run)
npm run build     # builds the PWA into dist/
npm start         # serves app + API on http://localhost:4848
```

`npm start` prints the LAN address (e.g. `http://192.168.1.20:4848`) — family members on
the same network open that on their phones.

For development: `npm run dev` (API on :4848, Vite dev server on :5173 with hot reload).
Tests: `npm test` (runs the API rule suite against a throwaway database).

## The household

| | |
|---|---|
| **Rooms** | Gabriel side: Guest 4, Guest 3, Master 2 · Clore side: Guest 2, Guest 1, Master 1 (Jimmy & Lynn's) · Shared: The Loft (barn) |
| **Admins** | Clore side: Jimmy & Lynn · Gabriel side: Kevin & Pamela |
| **Seeded names** | Jimmy, Lynn, Kevin, Pamela, Will, Erin, Sara, Ben, Rion, Austin (+ add more from any guest dropdown) |

## Rules the app enforces

- **Approvals** — booking a Clore room needs one Clore admin (Jimmy *or* Lynn); a Gabriel
  room needs one Gabriel admin (Kevin *or* Pamela); the Loft can be approved by an admin
  from either family. One rejection rejects the booking.
- **Holidays** — stays touching New Year's, Easter, Memorial Day, July 4th, Labor Day,
  Thanksgiving, or Christmas (incl. their weekends) need an admin from **both** families.
- **Whole ranch** — the "Book ALL rooms" checkbox reserves every room and needs one admin
  from each family. Nothing else can be booked over it.
- **No double-booking** — pending and approved bookings hold their dates; rejected or
  cancelled ones release them. Checkout day is a free turnover day (someone else can
  arrive the day you leave).
- **Book from the calendar** — tap your arrival day, then your departure day; the range
  highlights and a bar appears that jumps straight into the booking form with those dates.
- **Editing** a booking clears its approvals and sends it back through the flow.
- **Family members** sign in by picking their name from a dropdown and typing a **4-digit
  code** (created on first visit). Newcomers can add themselves from the sign-in screen
  ("I'm new here"); admins can add people or reset a code from Account → People.
- **Guests** are bookable names with no sign-in — kids, friends, in-laws. Add one straight
  from the booking form ("＋ Add someone new…"). They appear in the room dropdowns and on
  bookings, but never on the login screen. If a guest later wants an account they claim
  their own name with "I'm new here" and keep their booking history; admins can flip anyone
  between guest and family member in Account → People.

## Sysadmin access (for testing)

On the sign-in screen tap **Sysadmin access** and enter the code — default **`LAGRANGE`**
(override by setting the `SYSADMIN_CODE` environment variable before starting the server).
The sysadmin can approve for either family, manage people, and promote/demote admins.

## Texting the admins

Every pending booking shows a **"📱 Text Jimmy & Lynn to approve"** button. Tapping it
opens the phone's own Messages app pre-filled with the right admins' numbers and the
message — you hit send yourself, from your own number. No SMS service, no accounts,
no cost. Add each admin's phone number under **More → People** to enable it.

## Test it on your phone

```bash
npm run phone
```

That's the whole workflow: it builds the app if needed, starts the backend (the only thing
that has to run — the PWA itself lives in the phone's browser), and prints your Wi-Fi
address **with a QR code** to scan from the phone. First time a phone opens the app it
shows step-by-step "Add to Home Screen" instructions (also under More → "How to put this
app on your phone").

If the phone can't connect, allow Node.js through Windows Firewall when Windows asks
(check **Private networks**), or run once in an *administrator* PowerShell:

```bash
netsh advfirewall firewall add rule name="AV Ranch 4848" dir=in action=allow protocol=TCP localport=4848
```

## Installing it as an app on phones

PWAs install from the browser ("Add to Home Screen"). Browsers require HTTPS (or
localhost) for full PWA features. On a plain home network you have two easy options:

1. **Tailscale (recommended)** — install Tailscale on the server PC and each phone, then
   `tailscale serve 4848` gives you a trusted HTTPS URL that works from anywhere, even
   off the ranch Wi-Fi.
2. **Plain HTTP on the LAN** — everything works as a normal website at
   `http://<pc-ip>:4848`; phones can still pin it to the home screen, it just skips the
   offline service worker.

## Handy commands

| Command | What it does |
|---|---|
| `npm run setup` | Create/verify the database (never overwrites existing data) |
| `npm run reset-db` | Clear all bookings and lists, keep people and their codes |
| `npm run reset-db -- --all` | Wipe everything back to a factory-fresh database |
| `npm start` | Run the app (`PORT` env var to change the port, default 4848) |
| `npm run dev` | Development mode with hot reload |
| `npm test` | Run the 47-check API rule suite on a throwaway DB |
| `npm run icons` | Regenerate PWA icons from `assets/logo-original.png` |
| `RANCH_DB=/path/to.db npm start` | Use a database file somewhere else |

The database is a single file: `data/ranch.db`. **Back it up** by copying that file.
