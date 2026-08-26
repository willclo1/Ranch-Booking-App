import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { api } from '../api';
import { addDaysISO, todayISO } from '../dates';
import { useToast } from '../components/Toast';
import { Sheet } from '../components/Sheet';
import { Spinner } from '../components/bits';
import type { Availability, Booking, Room, User } from '../types';

/** roomId -> the user ids staying in that room */
type GuestMap = Record<number, number[]>;

export function BookPage() {
  const { id } = useParams();
  const editId = id ? Number(id) : null;
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const toast = useToast();
  const qc = useQueryClient();

  const { data: roomData } = useQuery({ queryKey: ['rooms'], queryFn: () => api.get<{ rooms: Room[] }>('/api/rooms') });
  const { data: userData } = useQuery({ queryKey: ['users'], queryFn: () => api.get<{ users: User[] }>('/api/users') });
  const { data: editData } = useQuery({
    queryKey: ['booking', editId],
    queryFn: () => api.get<{ booking: Booking }>(`/api/bookings/${editId}`),
    enabled: !!editId,
  });

  const startDefault = params.get('start') || todayISO();
  const endParam = params.get('end');
  const [startDate, setStartDate] = useState(startDefault);
  const [endDate, setEndDate] = useState(endParam && endParam > startDefault ? endParam : addDaysISO(startDefault, 2));
  const [fullRanch, setFullRanch] = useState(false);
  const [notes, setNotes] = useState('');
  const [guestMap, setGuestMap] = useState<GuestMap>({});
  const [openRoomId, setOpenRoomId] = useState<number | null>(null);
  const [loadedEdit, setLoadedEdit] = useState(false);

  const rooms = roomData?.rooms ?? [];
  const users = userData?.users ?? [];
  const openRoom = rooms.find((r) => r.id === openRoomId) ?? null;

  // Prefill when editing
  useEffect(() => {
    if (editData?.booking && !loadedEdit) {
      const b = editData.booking;
      setStartDate(b.startDate);
      setEndDate(b.endDate);
      setFullRanch(b.isFullRanch);
      setNotes(b.notes ?? '');
      const map: GuestMap = {};
      for (const g of b.guests) {
        map[g.room_id] = [...(map[g.room_id] ?? []), g.user_id];
      }
      setGuestMap(map);
      setLoadedEdit(true);
    }
  }, [editData, loadedEdit]);

  const isPast = !!startDate && startDate < todayISO();
  const validDates = !!startDate && !!endDate && startDate < endDate && !isPast;
  const { data: avail } = useQuery({
    queryKey: ['availability', startDate, endDate, editId],
    queryFn: () =>
      api.get<Availability>(`/api/bookings/availability?from=${startDate}&to=${endDate}${editId ? `&exclude=${editId}` : ''}`),
    enabled: validDates,
  });

  const chosenIn = (roomId: number): number[] => guestMap[roomId] ?? [];
  const nameOf = (uid: number) => users.find((u) => u.id === uid)?.name ?? '';

  const addGuest = (roomId: number, userId: number) => {
    setGuestMap((m) => {
      const arr = m[roomId] ?? [];
      return arr.includes(userId) ? m : { ...m, [roomId]: [...arr, userId] };
    });
  };
  const removeGuest = (roomId: number, userId: number) => {
    setGuestMap((m) => ({ ...m, [roomId]: (m[roomId] ?? []).filter((id) => id !== userId) }));
  };
  const clearRoom = (roomId: number) => {
    setGuestMap((m) => ({ ...m, [roomId]: [] }));
  };

  const selectedRooms = rooms.filter((r) => chosenIn(r.id).length > 0);
  const allChosen = rooms.flatMap((r) => chosenIn(r.id));
  const blockedIds = new Set(Object.keys(avail?.blockedRooms ?? {}).map(Number));

  // Family rooms need that side's admin, the Loft either side,
  // holidays and whole-ranch bookings both sides.
  const admins = users.filter((u) => u.role === 'admin');
  const adminNames = (family: 'clore' | 'gabriel') =>
    admins.filter((a) => a.family === family).map((a) => a.name).join(' or ') || `${family} admin`;
  const sides = new Set(selectedRooms.map((r) => r.side));
  const isHoliday = !!avail?.holiday;
  const needsClore = fullRanch || sides.has('clore') || isHoliday;
  const needsGabriel = fullRanch || sides.has('gabriel') || isHoliday;
  const needsEither = !needsClore && !needsGabriel && sides.has('shared');

  // The Loft is the barn and books on its own, so "the whole ranch" holds the
  // house rooms only. It can still be added on top by putting a guest in it.
  const houseRooms = rooms.filter((r) => r.side !== 'shared');
  const heldByFullRanch = (r: Room) => fullRanch && r.side !== 'shared';
  const effectiveRooms = rooms.filter((r) => heldByFullRanch(r) || chosenIn(r.id).length > 0);
  const takesHouseRoom = effectiveRooms.some((r) => r.side !== 'shared');

  // Every room the booking holds needs a person in it.
  const emptyRooms = fullRanch ? houseRooms.filter((r) => chosenIn(r.id).length === 0) : [];

  const canSubmit =
    validDates &&
    allChosen.length > 0 &&
    effectiveRooms.length > 0 &&
    emptyRooms.length === 0 &&
    (!takesHouseRoom || !avail?.fullRanchBlocked) &&
    (!fullRanch || !avail?.anyHouseBooking) &&
    effectiveRooms.every((r) => heldByFullRanch(r) || !blockedIds.has(r.id));

  const submitHint = isPast
    ? 'Pick dates from today onward'
    : !validDates
      ? 'Pick your dates'
      : takesHouseRoom && avail?.fullRanchBlocked
        ? 'Those dates are taken'
        : fullRanch && avail?.anyHouseBooking
          ? 'Someone already booked a room'
          : emptyRooms.length > 0
            ? `${emptyRooms.length} room${emptyRooms.length === 1 ? '' : 's'} still need a guest`
            : allChosen.length === 0
              ? 'Tap a room to add guests'
              : '';

  const mutation = useMutation({
    mutationFn: () => {
      const payload = {
        startDate,
        endDate,
        isFullRanch: fullRanch,
        notes,
        rooms: rooms
          .map((r) => ({ roomId: r.id, guestIds: chosenIn(r.id) }))
          .filter((e) => e.guestIds.length > 0),
      };
      return editId
        ? api.patch<{ booking: Booking }>(`/api/bookings/${editId}`, payload)
        : api.post<{ booking: Booking }>('/api/bookings', payload);
    },
    onSuccess: (d) => {
      qc.invalidateQueries({ queryKey: ['bookings'] });
      qc.invalidateQueries({ queryKey: ['booking', editId] });
      qc.invalidateQueries({ queryKey: ['pending-count'] });
      toast(editId ? 'Booking updated — sent for approval' : 'Booking requested — sent for approval');
      navigate(`/booking/${d.booking.id}`);
    },
    onError: (e) => toast(e instanceof Error ? e.message : 'Could not save booking', 'error'),
  });

  if (editId && !editData) return <Spinner />;
  if (rooms.length === 0) return <Spinner />;

  const leftRooms = rooms.filter((r) => r.side === 'gabriel');
  const rightRooms = rooms.filter((r) => r.side === 'clore');
  const loft = rooms.find((r) => r.side === 'shared');

  const roomTile = (room: Room, cls: string) => {
    const blocked = !heldByFullRanch(room) && blockedIds.has(room.id);
    const info = blocked ? avail!.blockedRooms[room.id] : null;
    const chosen = chosenIn(room.id);
    const selected = heldByFullRanch(room) || chosen.length > 0;
    return (
      <button
        key={room.id}
        type="button"
        className={`room-tile ${cls} ${room.side} ${selected ? 'selected' : ''} ${blocked ? 'blocked' : ''}`}
        disabled={blocked}
        onClick={() => setOpenRoomId(room.id)}
      >
        <span className="room-name">
          <span className={`side-dot side-${room.side}`} />
          {room.name}
        </span>
        {room.key === 'master1' && <span className="room-sub">Jimmy &amp; Lynn's room</span>}
        {blocked ? (
          <span className="tile-state">
            Booked · {info!.by}
            {info!.guests.length > 0 && <> — {info!.guests.join(', ')}</>}
          </span>
        ) : chosen.length > 0 ? (
          <span className="tile-pills">
            {chosen.map((uid, i) => (
              <span key={i} className="guest-pill">
                {nameOf(uid)}
              </span>
            ))}
          </span>
        ) : fullRanch ? (
          <span className="tile-state needs-guest">Needs a guest — tap to add</span>
        ) : (
          <span className="tile-state open">Open · tap to add guests</span>
        )}
      </button>
    );
  };

  return (
    <div className="stack">
      {editId && editData?.booking && (
        <div className="banner banner-info">Editing booking #{editId} — saving sends it back for approval.</div>
      )}

      <div className="card">
        <div className="dates-row">
          <label className="field">
            Arrive
            <input
              className="input"
              type="date"
              value={startDate}
              min={todayISO()}
              onChange={(e) => setStartDate(e.target.value)}
            />
          </label>
          <label className="field">
            Depart
            <input
              className="input"
              type="date"
              value={endDate}
              min={startDate > todayISO() ? startDate : todayISO()}
              onChange={(e) => setEndDate(e.target.value)}
            />
          </label>
        </div>
        {isPast && <p className="muted small" style={{ margin: '8px 2px 0', color: 'var(--bad)' }}>Those dates are in the past — pick today or later.</p>}
        {!isPast && !validDates && <p className="muted small" style={{ margin: '8px 2px 0' }}>Pick an arrival day and a later departure day.</p>}
      </div>

      {avail?.holiday && (
        <div className="banner banner-holiday">★ {avail.holiday} — holiday stays need an admin from both families.</div>
      )}
      {avail?.fullRanchBlocked && (
        <div className="banner banner-error">
          The whole ranch is booked by {avail.fullRanchBlocked.by} ({avail.fullRanchBlocked.status}){' '}
          {avail.fullRanchBlocked.start} → {avail.fullRanchBlocked.end}.{' '}
          {blockedIds.has(loft?.id ?? -1) ? 'Pick different dates.' : 'The Loft is still free on these dates.'}
        </div>
      )}
      {fullRanch && avail?.anyHouseBooking && !avail.fullRanchBlocked && (
        <div className="banner banner-error">Someone already has a house room booked in these dates, so the whole ranch can't be reserved.</div>
      )}

      <div className="house">
        <div className="house-living">LIVING / KITCHEN</div>
        <div className="house-sides">
          <div className="house-side-label gabriel">Gabriel side</div>
          <div className="house-side-label clore">Clore side</div>
        </div>
        <div className="house-grid">
          {leftRooms.map((r, i) => (
            <span key={r.id} style={{ display: 'contents' }}>
              {roomTile(r, 'left')}
              {rightRooms[i] && roomTile(rightRooms[i], 'right')}
            </span>
          ))}
        </div>
        {loft && roomTile(loft, 'wide')}
      </div>

      <label className="book-all">
        <input type="checkbox" checked={fullRanch} onChange={(e) => setFullRanch(e.target.checked)} />
        <span>
          Reserve the whole ranch
          <span className="muted small book-all-sub">
            Holds all six house rooms, each of which needs a guest. The Loft is separate — add it too if you want it.
          </span>
        </span>
      </label>
      {fullRanch && emptyRooms.length > 0 && (
        <div className="banner banner-info">
          {emptyRooms.length} room{emptyRooms.length === 1 ? ' still needs' : 's still need'} a guest before you can submit:{' '}
          {emptyRooms.map((r) => r.name).join(', ')}.
        </div>
      )}

      {(needsClore || needsGabriel || needsEither) && allChosen.length > 0 && (
        <div className="card">
          <div className="card-title">Approval needed from</div>
          <div className="needs-line">
            {needsClore && <span className="chip chip-side-clore">Clore — {adminNames('clore')}</span>}
            {needsGabriel && <span className="chip chip-side-gabriel">Gabriel — {adminNames('gabriel')}</span>}
            {needsEither && <span className="chip chip-side-shared">Any admin (Loft)</span>}
          </div>
        </div>
      )}

      <label className="field">
        Notes (optional)
        <textarea className="input" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Anything the admins should know" />
      </label>

      {/* spacer so the sticky action bar never covers the notes field */}
      <div style={{ height: 78 }} />

      <div className="action-bar">
        <button className="btn" onClick={() => navigate(-1)}>
          Cancel
        </button>
        <div className="action-main">
          <button
            className="btn btn-primary btn-block"
            disabled={!canSubmit || mutation.isPending}
            onClick={() => mutation.mutate()}
          >
            {mutation.isPending ? 'Sending…' : editId ? 'Save changes' : 'Submit booking'}
          </button>
          {!canSubmit && <span className="action-hint">{submitHint}</span>}
        </div>
      </div>

      <Sheet open={!!openRoom} onClose={() => setOpenRoomId(null)} title={openRoom ? `Who's in ${openRoom.name}?` : ''}>
        {openRoom && (
          <RoomEditor
            room={openRoom}
            users={users}
            chosen={chosenIn(openRoom.id)}
            takenElsewhere={new Set(allChosen.filter((id) => !chosenIn(openRoom.id).includes(id)))}
            onAdd={(uid) => addGuest(openRoom.id, uid)}
            onRemove={(uid) => removeGuest(openRoom.id, uid)}
            clearRoom={() => clearRoom(openRoom.id)}
            onDone={() => setOpenRoomId(null)}
          />
        )}
      </Sheet>
    </div>
  );
}

/**
 * Room guest picker: who's in here shown as removable pills, plus a search box
 * that filters the whole roster. Stays usable when the guest list runs long.
 */
function RoomEditor({
  room,
  users,
  chosen,
  takenElsewhere,
  onAdd,
  onRemove,
  clearRoom,
  onDone,
}: {
  room: Room;
  users: User[];
  chosen: number[];
  takenElsewhere: Set<number>;
  onAdd: (userId: number) => void;
  onRemove: (userId: number) => void;
  clearRoom: () => void;
  onDone: () => void;
}) {
  const toast = useToast();
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const [busy, setBusy] = useState(false);

  const sideLabel =
    room.side === 'shared' ? 'The barn · either family approves' : `${room.side === 'clore' ? 'Clore' : 'Gabriel'} side`;

  const query = search.trim().toLowerCase();
  const available = users.filter((u) => !chosen.includes(u.id) && !takenElsewhere.has(u.id));
  const matches = query ? available.filter((u) => u.name.toLowerCase().includes(query)) : available;
  const family = matches.filter((u) => !u.isGuest);
  const guests = matches.filter((u) => u.isGuest);
  const exactExists = users.some((u) => u.name.toLowerCase() === query);

  const addNewGuest = async () => {
    const name = search.trim();
    setBusy(true);
    try {
      const d = await api.post<{ user: User }>('/api/users', { name });
      await qc.invalidateQueries({ queryKey: ['users'] });
      onAdd(d.user.id);
      toast(`${d.user.name} added as a guest`);
      setSearch('');
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not add name', 'error');
    } finally {
      setBusy(false);
    }
  };

  const personRow = (u: User) => (
    <button key={u.id} type="button" className="person-row" onClick={() => onAdd(u.id)}>
      <span>{u.name}</span>
      <span className="person-add">＋</span>
    </button>
  );

  return (
    <div className="stack">
      <span className={`chip chip-side-${room.side}`} style={{ alignSelf: 'flex-start' }}>
        {sideLabel}
      </span>

      {chosen.length > 0 ? (
        <div className="chosen-pills">
          {chosen.map((uid) => {
            const u = users.find((x) => x.id === uid);
            return (
              <button key={uid} type="button" className="chosen-pill" onClick={() => onRemove(uid)}>
                {u?.name ?? 'Unknown'}
                <span className="pill-x" aria-hidden="true">
                  ✕
                </span>
              </button>
            );
          })}
        </div>
      ) : (
        <p className="muted small" style={{ margin: 0 }}>
          Nobody in this room yet — search below to add someone.
        </p>
      )}

      <input
        className="input guest-search"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Search names, or type a new one…"
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize="words"
        spellCheck={false}
      />

      <div className="person-list">
        {family.length > 0 && <div className="person-group">Family</div>}
        {family.map(personRow)}
        {guests.length > 0 && <div className="person-group">Guests</div>}
        {guests.map(personRow)}
        {matches.length === 0 && (
          <p className="muted small" style={{ padding: '10px 2px', margin: 0 }}>
            {query ? `Nobody matching "${search.trim()}".` : 'Everyone is already placed in a room.'}
          </p>
        )}
      </div>

      {query.length >= 2 && !exactExists && (
        <button type="button" className="btn btn-block" disabled={busy} onClick={addNewGuest}>
          ＋ Add "{search.trim()}" as a guest
          <span className="muted small" style={{ display: 'block', fontWeight: 500 }}>
            Bookable name only — no sign-in
          </span>
        </button>
      )}

      <div className="row">
        {chosen.length > 0 && (
          <button className="btn btn-block" onClick={clearRoom}>
            Clear room
          </button>
        )}
        <button className="btn btn-primary btn-block" onClick={onDone}>
          Done
        </button>
      </div>
    </div>
  );
}

