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
  const [addNameTarget, setAddNameTarget] = useState<{ roomId: number; idx: number } | null>(null);
  const [loadedEdit, setLoadedEdit] = useState(false);

  const rooms = roomData?.rooms ?? [];
  const users = userData?.users ?? [];

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

  const validDates = !!startDate && !!endDate && startDate < endDate;
  const { data: avail } = useQuery({
    queryKey: ['availability', startDate, endDate, editId],
    queryFn: () =>
      api.get<Availability>(`/api/bookings/availability?from=${startDate}&to=${endDate}${editId ? `&exclude=${editId}` : ''}`),
    enabled: validDates,
  });

  const selectsFor = (roomId: number): (number | null)[] => guestMap[roomId] ?? [null];
  const chosenIn = (roomId: number) => selectsFor(roomId).filter((x): x is number => x !== null);

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

  const selectedRooms = rooms.filter((r) => chosenIn(r.id).length > 0);
  const allChosen = rooms.flatMap((r) => chosenIn(r.id));
  const blockedIds = new Set(Object.keys(avail?.blockedRooms ?? {}).map(Number));

  // What approvals will this need? Family rooms need that side's admin,
  // the Loft either side, holidays and whole-ranch bookings both sides.
  const admins = users.filter((u) => u.role === 'admin');
  const adminNames = (family: 'clore' | 'gabriel') =>
    admins.filter((a) => a.family === family).map((a) => a.name).join(' or ') || `${family} admin`;
  const sides = new Set(selectedRooms.map((r) => r.side));
  const isHoliday = !!avail?.holiday;
  const needsClore = fullRanch || sides.has('clore') || isHoliday;
  const needsGabriel = fullRanch || sides.has('gabriel') || isHoliday;
  const needsEither = !needsClore && !needsGabriel && sides.has('shared');

  const canSubmit =
    validDates &&
    allChosen.length > 0 &&
    (fullRanch || selectedRooms.length > 0) &&
    !avail?.fullRanchBlocked &&
    (!fullRanch || !avail?.anyBooking) &&
    (fullRanch || selectedRooms.every((r) => !blockedIds.has(r.id)));

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
      toast(
        d.booking.status === 'approved'
          ? editId
            ? 'Booking updated — you’re all set!'
            : 'Booked — you’re all set!'
          : editId
            ? 'Booking updated — sent for approval'
            : 'Booking requested — sent for approval'
      );
      navigate(`/booking/${d.booking.id}`);
    },
    onError: (e) => toast(e instanceof Error ? e.message : 'Could not save booking', 'error'),
  });

  if (editId && !editData) return <Spinner />;
  if (rooms.length === 0) return <Spinner />;

  const leftRooms = rooms.filter((r) => r.side === 'gabriel');
  const rightRooms = rooms.filter((r) => r.side === 'clore');
  const loft = rooms.find((r) => r.side === 'shared');

  const renderSelects = (room: Room) => {
    const blocked = !fullRanch && blockedIds.has(room.id);
    if (blocked) {
      const info = avail!.blockedRooms[room.id];
      return (
        <div className="room-blocked-note">
          Booked by {info.by}
          {info.guests.length > 0 && <> — {info.guests.join(', ')}</>} ({info.status})
        </div>
      );
    }
    const selects = selectsFor(room.id);
    return (
      <>
        {selects.map((val, idx) => (
          <select
            key={idx}
            className="guest-select"
            value={val ?? ''}
            onChange={(e) => {
              const v = e.target.value;
              if (v === '__add') {
                setAddNameTarget({ roomId: room.id, idx });
              } else {
                setGuest(room.id, idx, v === '' ? null : Number(v));
              }
            }}
          >
            <option value="">— guest —</option>
            {users.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
            <option value="__add">＋ Add a name…</option>
          </select>
        ))}
        {selects.length < 4 && (
          <button type="button" className="add-guest-btn" onClick={() => addSelect(room.id)}>
            ＋ add another guest
          </button>
        )}
      </>
    );
  };

  const roomCell = (room: Room, sideClass: string) => {
    const blocked = !fullRanch && blockedIds.has(room.id);
    const selected = fullRanch || chosenIn(room.id).length > 0;
    return (
      <div key={room.id} className={`room-cell ${sideClass} ${room.side} ${selected ? 'selected' : ''} ${blocked ? 'blocked' : ''}`}>
        <div>
          <div className="room-name">
            <span className={`side-dot side-${room.side}`} />
            {room.name}
          </div>
          {room.key === 'master1' && <div className="room-sub">Jimmy &amp; Lynn's room</div>}
        </div>
        {renderSelects(room)}
      </div>
    );
  };

  return (
    <div className="stack">
      {editId && editData?.booking && (
        <div className="banner banner-info">
          Editing booking #{editId} — saving will send it back for approval.
        </div>
      )}

      <div className="dates-row">
        <label className="field">
          From (arrive)
          <input className="input" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
        </label>
        <label className="field">
          To (depart)
          <input className="input" type="date" value={endDate} min={startDate} onChange={(e) => setEndDate(e.target.value)} />
        </label>
      </div>
      {!validDates && <div className="muted small">Pick an arrival and a later departure day. Departure day frees the room for the next family.</div>}

      {avail?.holiday && (
        <div className="banner banner-holiday">★ {avail.holiday} — holiday stays need an admin from both families to approve.</div>
      )}
      {avail?.fullRanchBlocked && (
        <div className="banner banner-error">
          The whole ranch is booked by {avail.fullRanchBlocked.by} ({avail.fullRanchBlocked.status}) {avail.fullRanchBlocked.start} →{' '}
          {avail.fullRanchBlocked.end}. Pick different dates.
        </div>
      )}
      {fullRanch && avail?.anyBooking && !avail.fullRanchBlocked && (
        <div className="banner banner-error">Someone already has a room booked in these dates, so the whole ranch can't be reserved.</div>
      )}

      <label className="book-all">
        <input type="checkbox" checked={fullRanch} onChange={(e) => setFullRanch(e.target.checked)} />
        <span>
          Book ALL rooms — reserve the whole ranch
          <div className="muted small" style={{ fontWeight: 500 }}>
            Nobody else can book any room these dates. Needs a Clore and a Gabriel admin.
          </div>
        </span>
      </label>

      <div className="house">
        <div className="house-living">LIVING / KITCHEN</div>
        <div className="house-sides">
          <div className="house-side-label gabriel">Gabriel side</div>
          <div className="house-side-label clore">Clore side</div>
        </div>
        <div className="house-grid">
          {leftRooms.map((r, i) => (
            <span key={r.id} style={{ display: 'contents' }}>
              {roomCell(r, 'left')}
              {rightRooms[i] && roomCell(rightRooms[i], 'right')}
            </span>
          ))}
        </div>
        {loft && (
          <div className={`loft-cell ${fullRanch || chosenIn(loft.id).length > 0 ? 'selected' : ''} ${!fullRanch && blockedIds.has(loft.id) ? 'blocked' : ''}`}>
            <div className="room-name">
              <span className="side-dot side-shared" />
              {loft.name}
              <span className="muted small" style={{ fontWeight: 500 }}>· barn — either family</span>
            </div>
            {renderSelects(loft)}
          </div>
        )}
      </div>

      {(needsClore || needsGabriel || needsEither) && allChosen.length > 0 && (
        <div className="card">
          <div className="small" style={{ fontWeight: 700, marginBottom: 6 }}>
            Approval needed from:
          </div>
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

      <div className="row">
        <button className="btn btn-block" onClick={() => navigate(-1)}>
          Cancel
        </button>
        <button className="btn btn-primary btn-block" disabled={!canSubmit || mutation.isPending} onClick={() => mutation.mutate()}>
          {mutation.isPending ? 'Sending…' : editId ? 'Save changes' : 'Submit booking'}
        </button>
      </div>
      {allChosen.length === 0 && <div className="muted small" style={{ textAlign: 'center' }}>Add at least one guest to a room to submit.</div>}

      <AddNameSheet
        open={!!addNameTarget}
        onClose={() => setAddNameTarget(null)}
        onAdded={(u) => {
          if (addNameTarget) setGuest(addNameTarget.roomId, addNameTarget.idx, u.id);
          setAddNameTarget(null);
        }}
      />
    </div>
  );
}

function AddNameSheet({ open, onClose, onAdded }: { open: boolean; onClose: () => void; onAdded: (u: User) => void }) {
  const [name, setName] = useState('');
  const toast = useToast();
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setBusy(true);
    try {
      const d = await api.post<{ user: User }>('/api/users', { name: name.trim() });
      await qc.invalidateQueries({ queryKey: ['users'] });
      toast(`${d.user.name} added to the family list`);
      setName('');
      onAdded(d.user);
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not add name', 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet open={open} onClose={onClose} title="Add a name">
      <p className="muted small">They'll show up in every guest dropdown from now on.</p>
      <input className="input" autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="First name" onKeyDown={(e) => e.key === 'Enter' && name.trim().length >= 2 && save()} />
      <button className="btn btn-primary btn-block" disabled={busy || name.trim().length < 2} onClick={save}>
        Add name
      </button>
    </Sheet>
  );
}
