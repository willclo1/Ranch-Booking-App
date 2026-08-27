import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { api } from '../api';
import {
  addDaysISO, dayInStay, fmtLong, fmtRange, fmtShort, monthGrid, parseISO, todayISO, weekGrid, type MonthCell,
} from '../dates';
import { Sheet } from '../components/Sheet';
import { Spinner, StatusChip } from '../components/bits';
import type { Booking, HolidayWindow } from '../types';

const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const SIDE_WORD: Record<string, string> = { clore: 'Clore', gabriel: 'Gabriel', shared: 'Loft' };

type EventCategory = 'clore' | 'gabriel' | 'shared' | 'mixed' | 'full';

/**
 * A bar on the calendar. Usually one booking — but overlapping bookings of the
 * same side (and same status) merge into a single bar ("3 Clore rooms") so a
 * busy weekend reads as one reserved block. Tapping a merged bar lists its bookings.
 */
interface CalEvent {
  key: string;
  bookings: Booking[];
  startDate: string;
  endDate: string; // exclusive checkout day (rendered as a half day)
  category: EventCategory;
  pending: boolean;
}

function categoryOf(b: Booking): EventCategory {
  if (b.isFullRanch) return 'full';
  const sides = new Set(b.rooms.map((r) => r.side));
  return sides.size === 1 ? ([...sides][0] as EventCategory) : 'mixed';
}

function buildEvents(bookings: Booking[]): CalEvent[] {
  // Bucket by mergeable group; whole-ranch and mixed-side stays never merge.
  const groups = new Map<string, Booking[]>();
  for (const b of bookings) {
    const cat = categoryOf(b);
    const gkey =
      cat === 'full' || cat === 'mixed' ? `solo-${b.id}` : `${cat}-${b.status === 'pending' ? 'pending' : 'ok'}`;
    groups.set(gkey, [...(groups.get(gkey) ?? []), b]);
  }

  const events: CalEvent[] = [];
  for (const members of groups.values()) {
    const sorted = [...members].sort((a, b) => a.startDate.localeCompare(b.startDate));
    let cluster: Booking[] = [];
    let clusterEnd = '';
    const flush = () => {
      if (cluster.length === 0) return;
      events.push({
        key: cluster.map((x) => x.id).join('-'),
        bookings: cluster,
        startDate: cluster[0].startDate,
        endDate: clusterEnd,
        category: categoryOf(cluster[0]),
        pending: cluster[0].status === 'pending',
      });
    };
    for (const b of sorted) {
      // Strictly overlapping nights merge; back-to-back turnovers stay separate bars.
      if (cluster.length > 0 && b.startDate < clusterEnd) {
        cluster.push(b);
        if (b.endDate > clusterEnd) clusterEnd = b.endDate;
      } else {
        flush();
        cluster = [b];
        clusterEnd = b.endDate;
      }
    }
    flush();
  }
  return events;
}

/** Greedy lane assignment so overlapping bars stack like a modern calendar app. */
function assignLanes(events: CalEvent[]): Map<string, number> {
  const sorted = [...events].sort(
    (a, b) => a.startDate.localeCompare(b.startDate) || b.endDate.localeCompare(a.endDate)
  );
  const laneEnds: string[] = [];
  const lanes = new Map<string, number>();
  for (const e of sorted) {
    let lane = laneEnds.findIndex((end) => end <= e.startDate);
    if (lane === -1) {
      lane = laneEnds.length;
      laneEnds.push(e.endDate);
    } else {
      laneEnds[lane] = e.endDate;
    }
    lanes.set(e.key, lane);
  }
  return lanes;
}

function eventClass(e: CalEvent): string {
  const color = e.category === 'full' ? 'bar-full' : e.category === 'mixed' ? 'bar-mixed' : `bar-${e.category}`;
  return `cal-bar ${color} ${e.pending ? 'bar-pending' : ''}`;
}

function bookingLabel(b: Booking): string {
  if (b.isFullRanch) return `Whole Ranch · ${b.createdByName}`;
  const names = [...new Set(b.guests.map((g) => g.name))];
  return names.length > 0 ? names.join(', ') : b.createdByName;
}

function eventLabel(e: CalEvent): string {
  if (e.bookings.length === 1) return bookingLabel(e.bookings[0]);
  const roomCount = new Set(e.bookings.flatMap((b) => b.rooms.map((r) => r.id))).size;
  return `${roomCount} ${SIDE_WORD[e.category] ?? ''} rooms`;
}

function eventNames(e: CalEvent): string {
  return [...new Set(e.bookings.flatMap((b) => b.guests.map((g) => g.name)))].join(', ');
}

export function CalendarPage() {
  const [view, setView] = useState<'month' | 'week'>('month');
  const [anchor, setAnchor] = useState(() => new Date());
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const [groupOpen, setGroupOpen] = useState<CalEvent | null>(null);
  const [sel, setSel] = useState<{ start: string; end: string } | null>(null);
  const navigate = useNavigate();

  const maxLanes = view === 'week' ? 6 : 3;

  // Tap once to pick your arrival day, tap again to pick departure.
  // Tapping the same day clears; tapping with a full range starts over.
  const onDayTap = (iso: string) => {
    if (iso < todayISO()) return; // the past isn't bookable
    if (!sel) {
      setSel({ start: iso, end: iso });
    } else if (sel.start === sel.end) {
      if (iso === sel.start) setSel(null);
      else setSel(iso < sel.start ? { start: iso, end: sel.start } : { start: sel.start, end: iso });
    } else {
      setSel({ start: iso, end: iso });
    }
  };

  const cells = useMemo(() => (view === 'month' ? monthGrid(anchor) : weekGrid(anchor)), [view, anchor]);
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
    // Fixed dates for the year — no reason to be in the polling rotation.
    staleTime: 3600_000,
    refetchInterval: false,
  });

  const active = useMemo(
    () => (data?.bookings ?? []).filter((b) => b.status === 'pending' || b.status === 'approved'),
    [data]
  );
  const events = useMemo(() => buildEvents(active), [active]);
  const lanes = useMemo(() => assignLanes(events), [events]);

  const holidayFor = (iso: string) => holidayData?.windows.find((w) => w.start <= iso && iso <= w.end)?.name ?? null;
  const bookingsOn = (iso: string) => active.filter((b) => dayInStay(iso, b.startDate, b.endDate));

  const dayDiff = (a: string, b: string) => Math.round((parseISO(b).getTime() - parseISO(a).getTime()) / 86400000);

  interface Seg {
    event: CalEvent;
    col: number;
    span: number;
    lane: number;
    startsHere: boolean; // arrival day in this segment — bar begins mid-cell
    endsHere: boolean; // departure day in this segment — bar ends mid-cell
  }
  const segmentsFor = (week: MonthCell[]): { segs: Seg[]; more: { col: number; span: number; count: number } | null } => {
    const w0 = week[0].iso;
    const w6 = week[6].iso;
    const segs: Seg[] = [];
    const hidden: { from: string; to: string }[] = [];
    for (const e of events) {
      // Bars now run through the departure day (drawn as a half cell, hotel-style).
      if (e.startDate > w6 || e.endDate < w0) continue;
      const segFrom = e.startDate > w0 ? e.startDate : w0;
      const segTo = e.endDate < w6 ? e.endDate : w6;
      const lane = lanes.get(e.key) ?? 0;
      if (lane >= maxLanes) {
        hidden.push({ from: segFrom, to: segTo });
        continue;
      }
      segs.push({
        event: e,
        col: dayDiff(w0, segFrom),
        span: dayDiff(segFrom, segTo) + 1,
        lane,
        startsHere: segFrom === e.startDate,
        endsHere: segTo === e.endDate,
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

  const headLabel =
    view === 'month'
      ? anchor.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })
      : `${fmtRange(cells[0].iso, cells[6].iso)}, ${parseISO(cells[0].iso).getFullYear()}`;

  const step = (dir: -1 | 1) =>
    setAnchor(
      view === 'month'
        ? new Date(anchor.getFullYear(), anchor.getMonth() + dir, 1)
        : new Date(anchor.getFullYear(), anchor.getMonth(), anchor.getDate() + dir * 7)
    );

  const upcoming = active.filter((b) => b.endDate >= todayISO()).sort((a, b) => a.startDate.localeCompare(b.startDate));

  return (
    <div>
      <div className="cal-head">
        <button className="cal-nav-btn" aria-label={view === 'month' ? 'Previous month' : 'Previous week'} onClick={() => step(-1)}>
          ‹
        </button>
        <h2 className="cal-month">{headLabel}</h2>
        <button className="cal-nav-btn" aria-label={view === 'month' ? 'Next month' : 'Next week'} onClick={() => step(1)}>
          ›
        </button>
      </div>

      <div className="tabs cal-view-toggle">
        <button className={`tab ${view === 'month' ? 'active' : ''}`} onClick={() => setView('month')}>
          Month
        </button>
        <button
          className={`tab ${view === 'week' ? 'active' : ''}`}
          onClick={() => {
            // Jump the week view to today's week when coming from another month.
            setView('week');
            const now = new Date();
            if (anchor.getMonth() !== now.getMonth() || anchor.getFullYear() !== now.getFullYear()) setAnchor(now);
          }}
        >
          Week
        </button>
      </div>

      <div className="cal-dow-row">
        {DOW.map((d) => (
          <div key={d} className="cal-dow">
            {d}
          </div>
        ))}
      </div>

      <div className={`cal-weeks ${view === 'week' ? 'week-view' : ''}`}>
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
                  const past = c.iso < todayISO();
                  return (
                    <button
                      key={c.iso}
                      className={`cal-day ${c.inMonth ? '' : 'out'} ${past ? 'past' : ''} ${c.isToday ? 'today' : ''} ${hasBookings ? 'busy' : ''} ${inSel ? 'sel' : ''} ${selEdge ? 'sel-edge' : ''}`}
                      disabled={past}
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
                    key={`${s.event.key}-${s.col}`}
                    className={`${eventClass(s.event)} ${s.startsHere ? 'round-l' : ''} ${s.endsHere ? 'round-r' : ''}`}
                    style={{
                      gridColumn: `${s.col + 1} / span ${s.span}`,
                      gridRow: s.lane + 1,
                      // Arrival and departure are half days, like a hotel calendar —
                      // a checkout and a new arrival share the turnover day.
                      marginLeft: s.startsHere ? `${50 / s.span}%` : undefined,
                      marginRight: s.endsHere ? `${50 / s.span}%` : undefined,
                    }}
                    onClick={() =>
                      s.event.bookings.length === 1
                        ? navigate(`/booking/${s.event.bookings[0].id}`)
                        : setGroupOpen(s.event)
                    }
                    title={eventNames(s.event)}
                  >
                    {eventLabel(s.event)}
                  </div>
                ))}
                {more && (
                  <div
                    className="cal-bar bar-more round-l round-r"
                    style={{ gridColumn: `${more.col + 1} / span ${more.span}`, gridRow: maxLanes + 1 }}
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
          <span className="bar-swatch bar-mixed" /> Both sides
        </span>
        <span className="row">
          <span className="bar-swatch bar-full" /> Whole ranch
        </span>
        <span className="row">
          <span className="bar-swatch bar-pending" /> Pending
        </span>
        <span className="row">★ holiday</span>
      </div>

      {!sel && (
        <p className="muted small" style={{ margin: '8px 4px 0' }}>
          Tip: tap your arrival day, then your departure day, to book straight from the calendar. Bars end mid-day on
          the departure day.
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

      <Sheet
        open={!!groupOpen}
        onClose={() => setGroupOpen(null)}
        title={groupOpen ? `${eventLabel(groupOpen)} · ${fmtRange(groupOpen.startDate, groupOpen.endDate)}` : ''}
      >
        {groupOpen && (
          <>
            {groupOpen.bookings.map((b) => (
              <BookingCard
                key={b.id}
                booking={b}
                onClick={() => {
                  setGroupOpen(null);
                  navigate(`/booking/${b.id}`);
                }}
              />
            ))}
          </>
        )}
      </Sheet>

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
            {selectedDay >= todayISO() && (
              <button
                className="btn btn-primary btn-block"
                onClick={() => {
                  setSelectedDay(null);
                  navigate(`/book?start=${selectedDay}`);
                }}
              >
                Book this date
              </button>
            )}
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
