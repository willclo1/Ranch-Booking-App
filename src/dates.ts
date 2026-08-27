// All booking dates are plain local YYYY-MM-DD strings — never convert through UTC.

export function toISO(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function parseISO(s: string): Date {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function todayISO(): string {
  return toISO(new Date());
}

export function addDaysISO(iso: string, n: number): string {
  const d = parseISO(iso);
  d.setDate(d.getDate() + n);
  return toISO(d);
}

export function fmtShort(iso: string): string {
  return parseISO(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export function fmtLong(iso: string): string {
  return parseISO(iso).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
}

export function fmtRange(startISO: string, endISO: string): string {
  const s = parseISO(startISO);
  const e = parseISO(endISO);
  const sameMonth = s.getMonth() === e.getMonth() && s.getFullYear() === e.getFullYear();
  const sTxt = s.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  const eTxt = e.toLocaleDateString(undefined, sameMonth ? { day: 'numeric' } : { month: 'short', day: 'numeric' });
  return `${sTxt}–${eTxt}`;
}

/** Server timestamps are UTC 'YYYY-MM-DD HH:MM:SS'. */
export function fmtDateTime(sqlUtc: string): string {
  const d = new Date(sqlUtc.replace(' ', 'T') + 'Z');
  return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

export function fmtDateOnly(sqlUtc: string): string {
  const d = new Date(sqlUtc.replace(' ', 'T') + 'Z');
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export interface MonthCell {
  iso: string;
  day: number;
  inMonth: boolean;
  isToday: boolean;
}

/** 6-week grid of cells for the month containing `anchor`, weeks starting Sunday. */
export function monthGrid(anchor: Date): MonthCell[] {
  const first = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
  const start = new Date(first);
  start.setDate(1 - first.getDay());
  const today = todayISO();
  const cells: MonthCell[] = [];
  for (let i = 0; i < 42; i++) {
    const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
    const iso = toISO(d);
    cells.push({ iso, day: d.getDate(), inMonth: d.getMonth() === anchor.getMonth(), isToday: iso === today });
  }
  return cells;
}

/** Is day within stay [start, end)? (end/checkout day is not an occupied night) */
export function dayInStay(dayISO: string, startISO: string, endISO: string): boolean {
  return startISO <= dayISO && dayISO < endISO;
}

/** The 7 days (Sun-Sat) of the week containing `anchor`. */
export function weekGrid(anchor: Date): MonthCell[] {
  const start = new Date(anchor.getFullYear(), anchor.getMonth(), anchor.getDate() - anchor.getDay());
  const today = todayISO();
  const cells: MonthCell[] = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
    const iso = toISO(d);
    cells.push({ iso, day: d.getDate(), inMonth: true, isToday: iso === today });
  }
  return cells;
}
