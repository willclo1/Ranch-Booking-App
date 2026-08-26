import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { api } from '../api';
import { addDaysISO, dayInStay, fmtLong, fmtRange, fmtShort, monthGrid, parseISO, todayISO, type MonthCell } from '../dates';
import { Sheet } from '../components/Sheet';
import { Spinner, StatusChip } from '../components/bits';
import type { Booking, HolidayWindow } from '../types';

const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MAX_LANES = 3;

/** Greedy lane assignment so overlapping stays stack like a modern calendar app. */
function assignLanes(bookings: Booking[]): Map<number, number> {
  const sorted = [...bookings].sort(
    (a, b) => a.startDate.localeCompare(b.startDate) || b.endDate.localeCompare(a.endDate)
  );
  const laneEnds: string[] = [];
  const lanes = new Map<number, number>();
  for (const b of sorted) {
    let lane = laneEnds.findIndex((end) => end <= b.startDate);
    if (lane === -1) {
      lane = laneEnds.length;
      laneEnds.push(b.endDate);
    } else {
      laneEnds[lane] = b.endDate;
    }
    lanes.set(b.id, lane);
  }
  return lanes;
}

function barClass(b: Booking): string {
  let color: string;
  if (b.isFullRanch) color = 'bar-full';
  else {
    const sides = new Set(b.rooms.map((r) => r.side));
    color = sides.size === 1 ? `bar-${[...sides][0]}` : 'bar-mixed';
  }
  return `cal-bar ${color} ${b.status === 'pending' ? 'bar-pending' : ''}`;
}

function barLabel(b: Booking): string {
  if (b.isFullRanch) return `Whole Ranch · ${b.createdByName}`;
  const names = [...new Set(b.guests.map((g) => g.name))];
  return names.length > 0 ? names.join(', ') : b.createdByName;
}

export function CalendarPage() {
  const [anchor, setAnchor] = useState(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  });
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const [sel, setSel] = useState<{ start: string; end: string } | null>(null);
  const navigate = useNavigate();

  // Tap once to pick your arrival day, tap again to pick departure.
  // Tapping the same day clears; tapping with a full range starts over.
  const onDayTap = (iso: string) => {
    if (!sel) {
      setSel({ start: iso, end: iso });
    } else if (sel.start === sel.end) {
      if (iso === sel.start) setSel(null);
      else setSel(iso < sel.start ? { start: iso, end: sel.start } : { start: sel.start, end: iso });
    } else {
      setSel({ start: iso, end: iso });
    }
  };

  const cells = useMemo(() => monthGrid(anchor), [anchor]);
  const weeks = useMemo(() => {
    const w: MonthCell[][] = [];
    for (let i = 0; i < cells.length; i += 7) w.push(cells.slice(i, i + 7));
    return w;
  }, [cells]);
  const from = cells[0].iso;
  const to = cells[cells.length - 1].iso;

  const { data, isLoading } = useQuery({
    queryKey: ['bookings', from, to],
    queryFn: () => api.get<{ bookings: Booking[] }>(`/api/bookings?from=${from}&to=${to}`),
  });
  const { data: holidayData } = useQuery({
    queryKey: ['holidays', anchor.getFullYear()],
    queryFn: () => api.get<{ windows: HolidayWindow[] }>(`/api/bookings/holidays?year=${anchor.getFullYear()}`),
    staleTime: 3600_000,
  });

  const active = useMemo(
    () => (data?.bookings ?? []).filter((b) => b.status === 'pending' || b.status === 'approved'),
    [data]
  );
  const lanes = useMemo(() => assignLanes(active), [active]);

  const holidayFor = (iso: string) => holidayData?.windows.find((w) => w.start <= iso && iso <= w.end)?.name ?? null;
  const bookingsOn = (iso: string) => active.filter((b) => dayInStay(iso, b.startDate, b.endDate));

  const dayDiff = (a: string, b: string) => Math.round((parseISO(b).getTime() - parseISO(a).getTime()) / 86400000);

  interface Seg {
    booking: Booking;
    col: number;
    span: number;
    lane: number;
    roundL: boolean;
    roundR: boolean;
  }
  const segmentsFor = (week: MonthCell[]): { segs: Seg[]; more: { col: number; span: number; count: number } | null } => {
    const w0 = week[0].iso;
    const w6 = week[6].iso;
    const segs: Seg[] = [];
    const hidden: { from: string; to: string }[] = [];
    for (const b of active) {
      const lastNight = addDaysISO(b.endDate, -1);
      if (b.startDate > w6 || lastNight < w0) continue;
      const segFrom = b.startDate > w0 ? b.startDate : w0;
      const segTo = lastNight < w6 ? lastNight : w6;
      const lane = lanes.get(b.id) ?? 0;
      if (lane >= MAX_LANES) {
        hidden.push({ from: segFrom, to: segTo });
        continue;
      }
      segs.push({
        booking: b,
        col: dayDiff(w0, segFrom),
        span: dayDiff(segFrom, segTo) + 1,
        lane,
        roundL: segFrom === b.startDate,
        roundR: segTo === lastNight,
      });
    }
    let more: { col: number; span: number; count: number } | null = null;
    if (hidden.length > 0) {
      const minFrom = hidden.reduce((m, h) => (h.from < m ? h.from : m), hidden[0].from);
      const maxTo = hidden.reduce((m, h) => (h.to > m ? h.to : m), hidden[0].to);
      more = { col: dayDiff(w0, minFrom), span: dayDiff(minFrom, maxTo) + 1, count: hidden.length };
    }
    return { segs, more };
  };

  const monthLabel = anchor.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
  const upcoming = active.filter((b) => b.endDate >= todayISO()).sort((a, b) => a.startDate.localeCompare(b.startDate));

  return (
    <div>
      <div className="cal-head">
        <button
          className="cal-nav-btn"
          aria-label="Previous month"
          onClick={() => setAnchor(new Date(anchor.getFullYear(), anchor.getMonth() - 1, 1))}
        >
          ‹
        </button>
        <h2 className="cal-month">{monthLabel}</h2>
        <button
          className="cal-nav-btn"
          aria-label="Next month"
          onClick={() => setAnchor(new Date(anchor.getFullYear(), anchor.getMonth() + 1, 1))}
        >
          ›
        </button>
      </div>

      <div className="cal-dow-row">
        {DOW.map((d) => (
          <div key={d} className="cal-dow">
            {d}
          </div>
        ))}
      </div>

      <div className="cal-weeks">
        {weeks.map((week, wi) => {
          const { segs, more } = segmentsFor(week);
          return (
            <div key={wi} className="cal-week">
              <div className="cal-week-days">
                {week.map((c) => {
                  const holiday = holidayFor(c.iso);
                  const hasBookings = bookingsOn(c.iso).length > 0;
                  const inSel = sel && sel.start <= c.iso && c.iso <= sel.end;
                  const selEdge = sel && (c.iso === sel.start || c.iso === sel.end);
                  return (
                    <button
                      key={c.iso}
                      className={`cal-day ${c.inMonth ? '' : 'out'} ${c.isToday ? 'today' : ''} ${hasBookings ? 'busy' : ''} ${inSel ? 'sel' : ''} ${selEdge ? 'sel-edge' : ''}`}
                      onClick={() => onDayTap(c.iso)}
                    >
                      <span className="cal-day-num">{c.day}</span>
                      {holiday && (
                        <span className="cal-holiday" title={holiday}>
                          ★
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
              <div className="cal-week-events">
                {segs.map((s) => (
                  <div
                    key={`${s.booking.id}-${s.col}`}
                    className={`${barClass(s.booking)} ${s.roundL ? 'round-l' : ''} ${s.roundR ? 'round-r' : ''}`}
                    style={{ gridColumn: `${s.col + 1} / span ${s.span}`, gridRow: s.lane + 1 }}
                    onClick={() => navigate(`/booking/${s.booking.id}`)}
                    title={barLabel(s.booking)}
                  >
                    {barLabel(s.booking)}
                  </div>
                ))}
                {more && (
                  <div
                    className="cal-bar bar-more round-l round-r"
                    style={{ gridColumn: `${more.col + 1} / span ${more.span}`, gridRow: MAX_LANES + 1 }}
                    onClick={() => setSelectedDay(week[more.col].iso)}
                  >
                    +{more.count} more
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <div className="cal-legend">
        <span className="row">
          <span className="bar-swatch bar-clore" /> Clore
        </span>
        <span className="row">
          <span className="bar-swatch bar-gabriel" /> Gabriel
        </span>
        <span className="row">
          <span className="bar-swatch bar-shared" /> Loft
        </span>
        <span className="row">
          <span className="bar-swatch bar-full" /> Whole ranch
        </span>
        <span className="row">
          <span className="bar-swatch bar-clore bar-pending" /> pending
        </span>
        <span className="row">★ holiday</span>
      </div>

      {!sel && (
        <p className="muted small" style={{ margin: '8px 4px 0' }}>
          Tip: tap your arrival day, then your departure day, to book straight from the calendar.
        </p>
      )}

      {isLoading && <Spinner />}

      <h3 className="section-title">Upcoming stays</h3>
      <div className="stack">
        {upcoming.length === 0 && !isLoading && <p className="muted">Nothing booked yet this month — the ranch is wide open.</p>}
        {upcoming.map((b) => (
          <BookingCard key={b.id} booking={b} onClick={() => navigate(`/booking/${b.id}`)} />
        ))}
      </div>
      {sel && <div style={{ height: 84 }} />}

      {sel && <SelectBar sel={sel} bookingsOn={bookingsOn} onClear={() => setSel(null)} onDetails={() => setSelectedDay(sel.start)} />}

      <Sheet open={!!selectedDay} onClose={() => setSelectedDay(null)} title={selectedDay ? fmtLong(selectedDay) : ''}>
        {selectedDay && (
          <>
            {holidayFor(selectedDay) && (
              <div className="banner banner-holiday">★ {holidayFor(selectedDay)} — holiday dates need both families' sign-off</div>
            )}
            {bookingsOn(selectedDay).length === 0 ? (
              <p className="muted">Nobody's booked. The ranch is open this day.</p>
            ) : (
              bookingsOn(selectedDay).map((b) => (
                <BookingCard
                  key={b.id}
                  booking={b}
                  onClick={() => {
                    setSelectedDay(null);
                    navigate(`/booking/${b.id}`);
                  }}
                />
              ))
            )}
            <button
              className="btn btn-primary btn-block"
              onClick={() => {
                setSelectedDay(null);
                navigate(`/book?start=${selectedDay}`);
              }}
            >
              Book this date
            </button>
          </>
        )}
      </Sheet>
    </div>
  );
}

function SelectBar({
  sel,
  bookingsOn,
  onClear,
  onDetails,
}: {
  sel: { start: string; end: string };
  bookingsOn: (iso: string) => Booking[];
  onClear: () => void;
  onDetails: () => void;
}) {
  const navigate = useNavigate();
  const single = sel.start === sel.end;
  const nights = single ? 1 : Math.round((parseISO(sel.end).getTime() - parseISO(sel.start).getTime()) / 86400000);
  const bookEnd = single ? addDaysISO(sel.start, 1) : sel.end;
  const dayBookings = bookingsOn(sel.start);

  return (
    <div className="select-bar" role="region" aria-label="Selected dates">
      <div style={{ minWidth: 0 }}>
        <div className="select-dates">
          {fmtShort(sel.start)}
          {!single && <> → {fmtShort(sel.end)}</>}
          <span className="muted" style={{ fontWeight: 500, fontSize: 12 }}>
            {' '}
            · {nights} night{nights === 1 ? '' : 's'}
          </span>
        </div>
        <div className="muted small">
          {single
            ? dayBookings.length === 0
              ? 'Open — tap a departure day, or book one night'
              : `${dayBookings.length} booking${dayBookings.length === 1 ? '' : 's'} this day — tap a departure day`
            : 'Departure day checks out that morning'}
        </div>
      </div>
      <div className="row" style={{ flex: 'none' }}>
        <button className="btn btn-sm" aria-label="Clear selection" onClick={onClear}>
          ✕
        </button>
        {single && (
          <button className="btn btn-sm" onClick={onDetails}>
            Details
          </button>
        )}
        <button className="btn btn-primary btn-sm" onClick={() => navigate(`/book?start=${sel.start}&end=${bookEnd}`)}>
          Book →
        </button>
      </div>
    </div>
  );
}

export function BookingCard({ booking: b, onClick }: { booking: Booking; onClick?: () => void }) {
  const guestsByRoom = (roomId: number) => b.guests.filter((g) => g.room_id === roomId).map((g) => g.name);
  return (
    <div className="card booking-card" onClick={onClick} role={onClick ? 'button' : undefined}>
      <div className="row spread">
        <span className="booking-dates">{fmtRange(b.startDate, b.endDate)}</span>
        <StatusChip status={b.status} />
      </div>
      {b.isHoliday && <span className="chip chip-holiday">★ {b.holidayName}</span>}
      {b.isFullRanch ? (
        <div className="muted">
          <strong>Whole ranch</strong> — booked by {b.createdByName}
        </div>
      ) : (
        <div className="booking-rooms-line">
          {b.rooms.map((r) => (
            <span key={r.id} className={`chip chip-side-${r.side}`}>
              {r.name}
              {guestsByRoom(r.id).length > 0 ? `: ${guestsByRoom(r.id).join(', ')}` : ''}
            </span>
          ))}
        </div>
      )}
      <div className="item-meta">Booked by {b.createdByName}</div>
    </div>
  );
}
