import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { api } from '../api';
import { addDaysISO, todayISO } from '../dates';
import { useToast } from '../components/Toast';
import { Sheet } from '../components/Sheet';
import { Spinner } from '../components/bits';
import type { Availability, Booking, Room, User } from '../types';

type GuestMap = Record<number, (number | null)[]>;

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

  const selectsFor = (roomId: number): (number | null)[] => guestMap[roomId] ?? [null];
  const chosenIn = (roomId: number) => selectsFor(roomId).filter((x): x is number => x !== null);
  const nameOf = (uid: number) => users.find((u) => u.id === uid)?.name ?? '';

  const setGuest = (roomId: number, idx: number, value: number | null) => {
    setGuestMap((m) => {
      const arr = [...(m[roomId] ?? [null])];
      arr[idx] = value;
      return { ...m, [roomId]: arr };
    });
  };
  const addSelect = (roomId: number) => {
    setGuestMap((m) => {
      const arr = [...(m[roomId] ?? [null])];
      if (arr.length < 4) arr.push(null);
      return { ...m, [roomId]: arr };
    });
  };
  const clearRoom = (roomId: number) => {
    setGuestMap((m) => ({ ...m, [roomId]: [null] }));
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

  // Whole-ranch bookings hold every room, so every room needs a person in it.
  const emptyRooms = fullRanch ? rooms.filter((r) => chosenIn(r.id).length === 0) : [];

  const canSubmit =
    validDates &&
    allChosen.length > 0 &&
    (fullRanch || selectedRooms.length > 0) &&
    emptyRooms.length === 0 &&
    !avail?.fullRanchBlocked &&
    (!fullRanch || !avail?.anyBooking) &&
    (fullRanch || selectedRooms.every((r) => !blockedIds.has(r.id)));

  const submitHint = isPast
    ? 'Pick dates from today onward'
    : !validDates
      ? 'Pick your dates'
      : avail?.fullRanchBlocked
        ? 'Those dates are taken'
        : fullRanch && avail?.anyBooking
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
    const blocked = !fullRanch && blockedIds.has(room.id);
    const info = blocked ? avail!.blockedRooms[room.id] : null;
    const chosen = chosenIn(room.id);
    const selected = fullRanch || chosen.length > 0;
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
          {avail.fullRanchBlocked.start} → {avail.fullRanchBlocked.end}. Pick different dates.
        </div>
      )}
      {fullRanch && avail?.anyBooking && !avail.fullRanchBlocked && (
        <div className="banner banner-error">Someone already has a room booked in these dates, so the whole ranch can't be reserved.</div>
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
          <span className="muted small book-all-sub">Holds every room — and every room needs at least one guest.</span>
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

      <Sheet open={!!openRoom} onClose={() => setOpenRoomId(null)} title={openRoom?.name}>
        {openRoom && (
          <RoomEditor
            room={openRoom}
            users={users}
            selects={selectsFor(openRoom.id)}
            takenIds={new Set(allChosen)}
            setGuest={(idx, v) => setGuest(openRoom.id, idx, v)}
            addSelect={() => addSelect(openRoom.id)}
            clearRoom={() => clearRoom(openRoom.id)}
            onDone={() => setOpenRoomId(null)}
          />
        )}
      </Sheet>
    </div>
  );
}

function RoomEditor({
  room,
  users,
  selects,
  takenIds,
  setGuest,
  addSelect,
  clearRoom,
  onDone,
}: {
  room: Room;
  users: User[];
  selects: (number | null)[];
  takenIds: Set<number>;
  setGuest: (idx: number, value: number | null) => void;
  addSelect: () => void;
  clearRoom: () => void;
  onDone: () => void;
}) {
  const toast = useToast();
  const qc = useQueryClient();
  const [addingIdx, setAddingIdx] = useState<number | null>(null);
  const [newName, setNewName] = useState('');
  const [busy, setBusy] = useState(false);

  const sideLabel = room.side === 'shared' ? 'The barn · either family approves' : `${room.side === 'clore' ? 'Clore' : 'Gabriel'} side`;

  const saveName = async () => {
    setBusy(true);
    try {
      const d = await api.post<{ user: User }>('/api/users', { name: newName.trim() });
      await qc.invalidateQueries({ queryKey: ['users'] });
      if (addingIdx !== null) setGuest(addingIdx, d.user.id);
      toast(`${d.user.name} added to the family list`);
      setAddingIdx(null);
      setNewName('');
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not add name', 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="stack">
      <span className={`chip chip-side-${room.side}`} style={{ alignSelf: 'flex-start' }}>
        {sideLabel}
      </span>

      {addingIdx === null ? (
        <>
          {selects.map((val, idx) => (
            <select
              key={idx}
              className="guest-select"
              value={val ?? ''}
              onChange={(e) => {
                const v = e.target.value;
                if (v === '__add') setAddingIdx(idx);
                else setGuest(idx, v === '' ? null : Number(v));
              }}
            >
              <option value="">— guest —</option>
              {users.map((u) => (
                <option key={u.id} value={u.id} disabled={takenIds.has(u.id) && u.id !== val}>
                  {u.name}
                  {takenIds.has(u.id) && u.id !== val ? ' · already in this booking' : ''}
                </option>
              ))}
              <option value="__add">＋ Add a new name…</option>
            </select>
          ))}
          {selects.length < 4 && (
            <button type="button" className="add-guest-btn" onClick={addSelect}>
              ＋ add another guest
            </button>
          )}
          <div className="row">
            <button
              className="btn btn-block"
              onClick={() => {
                clearRoom();
                onDone();
              }}
            >
              Clear room
            </button>
            <button className="btn btn-primary btn-block" onClick={onDone}>
              Done
            </button>
          </div>
        </>
      ) : (
        <>
          <p className="muted small" style={{ margin: 0 }}>
            They'll show up in every guest dropdown from now on.
          </p>
          <input
            className="input"
            autoFocus
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="First name"
            onKeyDown={(e) => e.key === 'Enter' && newName.trim().length >= 2 && saveName()}
          />
          <div className="row">
            <button className="btn btn-block" onClick={() => setAddingIdx(null)}>
              Back
            </button>
            <button className="btn btn-primary btn-block" disabled={busy || newName.trim().length < 2} onClick={saveName}>
              Add name
            </button>
          </div>
        </>
      )}
    </div>
  );
}
