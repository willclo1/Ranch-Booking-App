import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useParams } from 'react-router-dom';
import { api } from '../api';
import { isAdminish, useAuth } from '../auth';
import { fmtDateTime, fmtLong, fmtRange } from '../dates';
import { smsHref } from '../sms';
import { useToast } from '../components/Toast';
import { Spinner, StatusChip } from '../components/bits';
import type { Booking, ChecklistItem, User } from '../types';

export function BookingDetailPage() {
  const { id } = useParams();
  const bookingId = Number(id);
  const navigate = useNavigate();
  const toast = useToast();
  const qc = useQueryClient();
  const { user } = useAuth();
  const [note, setNote] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['booking', bookingId],
    queryFn: () => api.get<{ booking: Booking }>(`/api/bookings/${bookingId}`),
  });
  const { data: usersData } = useQuery({
    queryKey: ['users'],
    queryFn: () => api.get<{ users: User[] }>('/api/users'),
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['booking', bookingId] });
    qc.invalidateQueries({ queryKey: ['bookings'] });
    qc.invalidateQueries({ queryKey: ['pending-count'] });
  };

  const decide = useMutation({
    mutationFn: (decision: 'approved' | 'rejected') =>
      api.post<{ booking: Booking }>(`/api/bookings/${bookingId}/decide`, { decision, note }),
    onSuccess: (d) => {
      invalidate();
      toast(d.booking.status === 'approved' ? 'Booking fully approved!' : d.booking.status === 'rejected' ? 'Booking rejected' : 'Your approval is in — waiting on the other side');
      setNote('');
    },
    onError: (e) => toast(e instanceof Error ? e.message : 'Failed', 'error'),
  });

  const cancel = useMutation({
    mutationFn: () => api.post<{ booking: Booking }>(`/api/bookings/${bookingId}/cancel`),
    onSuccess: () => {
      invalidate();
      toast('Booking cancelled');
    },
    onError: (e) => toast(e instanceof Error ? e.message : 'Failed', 'error'),
  });

  if (isLoading || !data) return <Spinner />;
  const b = data.booking;
  const admin = isAdminish(user);
  const mine = user?.id === b.createdBy;
  const myApproval = b.approvals.find((a) => a.admin_id === user?.id);
  const guestsByRoom = (roomId: number) => b.guests.filter((g) => g.room_id === roomId).map((g) => g.name);

  const sideSatisfied = (side: 'clore' | 'gabriel') =>
    b.approvals.some((a) => a.decision === 'approved' && (a.side === side || a.side === 'both'));

  // Tap-to-text: which admins still need to approve, and can we text them?
  const allAdmins = usersData?.users.filter((u) => u.role === 'admin') ?? [];
  const anyApproved = b.approvals.some((a) => a.decision === 'approved');
  const neededAdmins =
    b.status === 'pending'
      ? allAdmins.filter(
          (a) =>
            (b.needs.clore && !sideSatisfied('clore') && a.family === 'clore') ||
            (b.needs.gabriel && !sideSatisfied('gabriel') && a.family === 'gabriel') ||
            (b.needs.either && !anyApproved)
        )
      : [];
  const textable = neededAdmins.filter((a) => a.phone);
  const phoneless = neededAdmins.filter((a) => !a.phone);
  const roomsTxt = b.isFullRanch ? 'the whole ranch' : b.rooms.map((r) => r.name).join(', ');
  const smsBody =
    `AV Ranch: ${b.createdByName}'s booking of ${roomsTxt}, ${fmtRange(b.startDate, b.endDate)}, needs your approval` +
    `${b.isHoliday ? ` (${b.holidayName} — both families sign off)` : ''}. Open: ${window.location.origin}/booking/${b.id}`;

  return (
    <div className="stack">
      <button className="back-link" onClick={() => navigate(-1)}>
        ‹ Back
      </button>

      <div className="card stack">
        <div className="row spread">
          <div>
            <div className="booking-dates">
              {fmtLong(b.startDate)} → {fmtLong(b.endDate)}
            </div>
            <div className="item-meta">
              Booked by {b.createdByName} · {fmtDateTime(b.createdAt)}
            </div>
          </div>
          <StatusChip status={b.status} />
        </div>

        {b.isHoliday && <div className="banner banner-holiday">★ {b.holidayName} — needs an admin from both families</div>}
        {b.isFullRanch && <div className="banner banner-info">Whole-ranch booking — every room is reserved.</div>}
        {b.notes && <p style={{ margin: 0 }}>{b.notes}</p>}

        <div className="detail-rooms">
          {b.rooms.map((r) => (
            <div key={r.id} className="detail-room">
              <span className="row">
                <span className={`side-dot side-${r.side}`} />
                <strong>{r.name}</strong>
              </span>
              <span className="muted">{guestsByRoom(r.id).join(', ') || (b.isFullRanch ? 'reserved' : '—')}</span>
            </div>
          ))}
        </div>
      </div>

      {!(b.needs.clore || b.needs.gabriel || b.needs.either) && b.approvals.length === 0 ? (
        <p className="muted small" style={{ margin: '0 4px' }}>
          ✓ Guest rooms &amp; the Loft book instantly — no admin approval was needed.
        </p>
      ) : (
      <div className="card stack">
        <h3 style={{ fontSize: 15 }}>Approvals</h3>
        <div className="needs-line">
          {b.needs.clore && (
            <span className="chip chip-side-clore">Clore {sideSatisfied('clore') ? '✓' : '· waiting'}</span>
          )}
          {b.needs.gabriel && (
            <span className="chip chip-side-gabriel">Gabriel {sideSatisfied('gabriel') ? '✓' : '· waiting'}</span>
          )}
          {b.needs.either && (
            <span className="chip chip-side-shared">
              Any admin {b.approvals.some((a) => a.decision === 'approved') ? '✓' : '· waiting'}
            </span>
          )}
        </div>
        {b.approvals.length === 0 && <p className="muted small">No admin has responded yet.</p>}

        {textable.length > 0 && (
          <a className="btn btn-primary btn-block" style={{ textAlign: 'center' }} href={smsHref(textable.map((a) => a.phone!), smsBody)}>
            📱 Text {textable.map((a) => a.name).join(' & ')} to approve
          </a>
        )}
        {phoneless.length > 0 && (
          <p className="muted small" style={{ margin: 0 }}>
            {textable.length > 0 ? 'Also waiting: ' : 'Waiting on: '}
            {phoneless.map((a) => a.name).join(' & ')} — no phone number saved yet (add it under More → People to enable tap-to-text).
          </p>
        )}

        {b.approvals.map((a) => (
          <div key={a.admin_id} className="approval-row">
            <span>{a.decision === 'approved' ? '✅' : '❌'}</span>
            <span>
              <strong>{a.admin_name}</strong> {a.decision} this booking · {fmtDateTime(a.created_at)}
              {a.note && <div className="muted small">"{a.note}"</div>}
            </span>
          </div>
        ))}

        {admin && b.status === 'pending' && (
          <>
            <input className="input" placeholder="Note (optional)" value={note} onChange={(e) => setNote(e.target.value)} />
            <div className="row">
              <button className="btn btn-danger btn-block" disabled={decide.isPending} onClick={() => decide.mutate('rejected')}>
                Reject
              </button>
              <button className="btn btn-ok btn-block" disabled={decide.isPending} onClick={() => decide.mutate('approved')}>
                {myApproval?.decision === 'approved' ? 'Approved ✓' : 'Approve'}
              </button>
            </div>
          </>
        )}
      </div>
      )}

      {(b.status === 'approved' || b.status === 'pending') && (
        <>
          <ChecklistAccordion bookingId={bookingId} type="checkin" title="Check-in checklist" />
          <ChecklistAccordion bookingId={bookingId} type="checkout" title="Check-out checklist" />
        </>
      )}

      {(mine || admin) && b.status !== 'cancelled' && (
        <div className="row">
          {b.status !== 'rejected' && (
            <button className="btn btn-block" onClick={() => navigate(`/book/${b.id}`)}>
              Edit booking
            </button>
          )}
          {b.status === 'rejected' && (
            <button className="btn btn-block" onClick={() => navigate(`/book/${b.id}`)}>
              Edit &amp; resubmit
            </button>
          )}
          <button
            className="btn btn-danger btn-block"
            disabled={cancel.isPending}
            onClick={() => window.confirm('Cancel this booking?') && cancel.mutate()}
          >
            Cancel booking
          </button>
        </div>
      )}
    </div>
  );
}

function ChecklistAccordion({ bookingId, type, title }: { bookingId: number; type: 'checkin' | 'checkout'; title: string }) {
  const qc = useQueryClient();
  const toast = useToast();
  const { data } = useQuery({
    queryKey: ['booking-checklist', bookingId],
    queryFn: () => api.get<{ checkin: ChecklistItem[]; checkout: ChecklistItem[] }>(`/api/checklists/booking/${bookingId}`),
  });

  const toggle = useMutation({
    mutationFn: (templateItemId: number) => api.post(`/api/checklists/booking/${bookingId}/toggle`, { templateItemId }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['booking-checklist', bookingId] }),
    onError: (e) => toast(e instanceof Error ? e.message : 'Failed', 'error'),
  });

  const items = data?.[type] ?? [];
  const done = items.filter((i) => i.checked_at).length;

  return (
    <details className="acc">
      <summary>
        <span>{title}</span>
        <span className="muted small">
          {items.length === 0 ? 'no items yet' : `${done}/${items.length}`}
        </span>
      </summary>
      <div className="acc-body">
        {items.length === 0 && (
          <p className="muted small">No items yet — anyone can add them under More → Checklists.</p>
        )}
        {items.map((item) => (
          <div key={item.id} className="list-item">
            <button
              className={`check-circle ${item.checked_at ? 'checked' : ''}`}
              onClick={() => toggle.mutate(item.id)}
              aria-label={item.checked_at ? 'Uncheck' : 'Check'}
            >
              ✓
            </button>
            <div className="list-text">
              <div className={item.checked_at ? 'done' : ''}>{item.text}</div>
              {item.checked_at && (
                <div className="item-meta">
                  ✓ {item.checked_by} · {fmtDateTime(item.checked_at)}
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </details>
  );
}
