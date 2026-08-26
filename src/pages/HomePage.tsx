import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../api';
import { isAdminish, useAuth } from '../auth';
import { addDaysISO, dayInStay, todayISO } from '../dates';
import { Logo, Spinner } from '../components/bits';
import { BookingCard } from './CalendarPage';
import type { Booking } from '../types';

export function HomePage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const admin = isAdminish(user);
  const today = todayISO();

  const { data, isLoading } = useQuery({
    queryKey: ['bookings', 'home', today],
    queryFn: () => api.get<{ bookings: Booking[] }>(`/api/bookings?from=${today}&to=${addDaysISO(today, 365)}`),
  });
  const { data: pendingData } = useQuery({
    queryKey: ['pending-count'],
    queryFn: () => api.get<{ bookings: Booking[] }>('/api/bookings/pending'),
    enabled: admin,
  });

  const active = (data?.bookings ?? []).filter((b) => b.status === 'pending' || b.status === 'approved');
  const atRanchNow = active.filter((b) => dayInStay(today, b.startDate, b.endDate));
  const myBookings = active
    .filter((b) => b.createdBy === user?.id || b.guests.some((g) => g.user_id === user?.id))
    .filter((b) => b.endDate >= today || b.status === 'pending')
    .sort((a, b) => a.startDate.localeCompare(b.startDate));
  const pending = pendingData?.bookings ?? [];

  const todayLabel = new Date().toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  });

  return (
    <div className="stack">
      <div className="home-hero card">
        <Logo size={72} />
        <div>
          <div className="home-howdy">Howdy, {user?.name}</div>
          <div className="muted small">{todayLabel}</div>
        </div>
      </div>

      <div className="quick-actions">
        <Link to="/book" className="quick-action">
          <span className="qa-emoji">🛏️</span>
          Book a stay
        </Link>
        <Link to="/calendar" className="quick-action">
          <span className="qa-emoji">📅</span>
          Calendar
        </Link>
        <Link to="/lists" className="quick-action">
          <span className="qa-emoji">🛒</span>
          Groceries
        </Link>
      </div>

      {admin && pending.length > 0 && (
        <>
          <h3 className="section-title">Waiting on your approval</h3>
          <div className="stack">
            {pending.slice(0, 3).map((b) => (
              <BookingCard key={b.id} booking={b} onClick={() => navigate(`/booking/${b.id}`)} />
            ))}
            {pending.length > 3 && (
              <Link to="/more" className="muted small" style={{ textAlign: 'center' }}>
                +{pending.length - 3} more in your approvals inbox
              </Link>
            )}
          </div>
        </>
      )}

      <h3 className="section-title">At the ranch right now</h3>
      {isLoading ? (
        <Spinner />
      ) : atRanchNow.length === 0 ? (
        <p className="muted" style={{ margin: '0 2px' }}>
          Nobody's out there — the ranch is quiet. 🌾
        </p>
      ) : (
        <div className="stack">
          {atRanchNow.map((b) => (
            <BookingCard key={b.id} booking={b} onClick={() => navigate(`/booking/${b.id}`)} />
          ))}
        </div>
      )}

      <h3 className="section-title">Your bookings</h3>
      {myBookings.length > 0 ? (
        <div className="stack">
          {myBookings.slice(0, 5).map((b) => (
            <BookingCard key={b.id} booking={b} onClick={() => navigate(`/booking/${b.id}`)} />
          ))}
          {myBookings.length > 5 && (
            <p className="muted small" style={{ textAlign: 'center', margin: 0 }}>
              +{myBookings.length - 5} more on the calendar
            </p>
          )}
        </div>
      ) : (
        <div className="card row spread">
          <span className="muted">Nothing on the books for you yet.</span>
          <button className="btn btn-primary btn-sm" onClick={() => navigate('/book')}>
            Book a stay
          </button>
        </div>
      )}
    </div>
  );
}
