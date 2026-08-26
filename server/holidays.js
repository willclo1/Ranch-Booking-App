// Major US holiday windows that require sign-off from BOTH families.
// Windows are inclusive date ranges (YYYY-MM-DD).

function fmt(d) {
  return d.toISOString().slice(0, 10);
}
function date(y, m, day) {
  return new Date(Date.UTC(y, m - 1, day));
}
function addDays(d, n) {
  return new Date(d.getTime() + n * 86400000);
}
/** nth (1-based) occurrence of weekday (0=Sun..6=Sat) in month m of year y */
function nthWeekday(y, m, weekday, n) {
  const first = date(y, m, 1);
  const offset = (weekday - first.getUTCDay() + 7) % 7;
  return addDays(first, offset + (n - 1) * 7);
}
/** last occurrence of weekday in month m of year y */
function lastWeekday(y, m, weekday) {
  const last = addDays(date(y, m + 1, 1), -1);
  const offset = (last.getUTCDay() - weekday + 7) % 7;
  return addDays(last, -offset);
}
/** Easter Sunday (Gregorian, Anonymous algorithm) */
function easter(y) {
  const a = y % 19, b = Math.floor(y / 100), c = y % 100;
  const d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return date(y, month, day);
}

/** All holiday windows for one calendar year. */
export function holidayWindows(year) {
  const memorial = lastWeekday(year, 5, 1);      // last Monday of May
  const labor = nthWeekday(year, 9, 1, 1);       // first Monday of September
  const thanksgiving = nthWeekday(year, 11, 4, 4); // 4th Thursday of November
  const easterSun = easter(year);
  return [
    { key: 'newyear', name: "New Year's", start: fmt(date(year - 1, 12, 30)), end: fmt(date(year, 1, 2)) },
    { key: 'easter', name: 'Easter', start: fmt(addDays(easterSun, -2)), end: fmt(easterSun) },
    { key: 'memorial', name: 'Memorial Day', start: fmt(addDays(memorial, -2)), end: fmt(memorial) },
    { key: 'july4', name: 'July 4th', start: fmt(date(year, 7, 3)), end: fmt(date(year, 7, 5)) },
    { key: 'labor', name: 'Labor Day', start: fmt(addDays(labor, -2)), end: fmt(labor) },
    { key: 'thanksgiving', name: 'Thanksgiving', start: fmt(thanksgiving), end: fmt(addDays(thanksgiving, 3)) },
    { key: 'christmas', name: 'Christmas', start: fmt(date(year, 12, 23)), end: fmt(date(year, 12, 26)) },
    { key: 'newyear-eve', name: "New Year's", start: fmt(date(year, 12, 30)), end: fmt(date(year + 1, 1, 2)) },
  ];
}

/**
 * Does the stay [startDate, endDate) touch a holiday window?
 * Returns the holiday name or null.
 */
export function holidayForRange(startDate, endDate) {
  const y0 = Number(startDate.slice(0, 4));
  const y1 = Number(endDate.slice(0, 4));
  for (let y = y0; y <= y1 + 1; y++) {
    for (const w of holidayWindows(y)) {
      // window inclusive [w.start, w.end]; stay [startDate, endDate)
      if (startDate <= w.end && w.start < endDate) return w.name;
    }
  }
  return null;
}
