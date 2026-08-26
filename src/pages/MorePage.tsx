import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../api';
import { isAdminish, useAuth } from '../auth';
import { useToast } from '../components/Toast';
import { Spinner } from '../components/bits';
import { BookingCard } from './CalendarPage';
import type { Booking, User } from '../types';

export function MorePage() {
  const { user, logout } = useAuth();
  const admin = isAdminish(user);

  return (
    <div className="stack">
      <div className="card stack" style={{ gap: 10 }}>
        <div className="row spread">
          <div>
            <div style={{ fontWeight: 800, fontSize: 17 }}>{user?.name}</div>
            <div className="muted small">
              {user?.family ? (user.family === 'clore' ? 'Clore family' : 'Gabriel family') : 'Family member'}
              {user?.role === 'admin' && ' Â· Admin'}
              {user?.role === 'sysadmin' && ' Â· Sysadmin'}
            </div>
          </div>
          <button className="btn btn-sm" onClick={() => logout()}>
            Sign out
          </button>
        </div>
        {user && user.role !== 'sysadmin' && <MyPhone userId={user.id} />}
      </div>

      {admin && <ApprovalsInbox />}
      {admin && <PeopleManager />}

      <Link to="/install" className="card row" style={{ justifyContent: 'center', fontWeight: 700, fontSize: 14 }}>
         How to put this app on your phone
      </Link>

      <p className="muted small" style={{ textAlign: 'center', marginTop: 10 }}>
        AV Ranch · La Grange, TX
      </p>
    </div>
  );
}

/** Everyone can save their own phone number â€” it powers the tap-to-text buttons. */
function MyPhone({ userId }: { userId: number }) {
  const qc = useQueryClient();
  const toast = useToast();
  const { data } = useQuery({ queryKey: ['users'], queryFn: () => api.get<{ users: User[] }>('/api/users') });
  const me = data?.users.find((u) => u.id === userId);

  const save = useMutation({
    mutationFn: (phone: string) => api.patch(`/api/users/${userId}`, { phone }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['users'] });
      toast('Phone number saved');
    },
    onError: (e) => toast(e instanceof Error ? e.message : 'Failed', 'error'),
  });

  if (!me) return null;
  return (
    <div>
      <div className="muted small" style={{ fontWeight: 650, marginBottom: 4 }}>
        Your phone number <span style={{ fontWeight: 400 }}>· used for the "text to approve" buttons</span>
      </div>
      <PhoneField key={me.phone ?? ''} user={me} onSave={(phone) => save.mutate(phone)} />
    </div>
  );
}

function ApprovalsInbox() {
  const navigate = useNavigate();
  const { data, isLoading } = useQuery({
    queryKey: ['pending-count'],
    queryFn: () => api.get<{ bookings: Booking[] }>('/api/bookings/pending'),
  });
  return (
    <>
      <h3 className="section-title">Approvals inbox</h3>
      {isLoading && <Spinner />}
      {data?.bookings.length === 0 && <p className="muted">Nothing waiting on you.</p>}
      <div className="stack">
        {data?.bookings.map((b) => (
          <BookingCard key={b.id} booking={b} onClick={() => navigate(`/booking/${b.id}`)} />
        ))}
      </div>
    </>
  );
}

function PeopleManager() {
  const qc = useQueryClient();
  const toast = useToast();
  const { user: me } = useAuth();
  const [newPerson, setNewPerson] = useState('');

  const { data } = useQuery({ queryKey: ['users'], queryFn: () => api.get<{ users: User[] }>('/api/users') });
  const refresh = () => qc.invalidateQueries({ queryKey: ['users'] });
  const onError = (e: unknown) => toast(e instanceof Error ? e.message : 'Failed', 'error');

  const addPerson = useMutation({
    mutationFn: () => api.post('/api/users', { name: newPerson.trim() }),
    onSuccess: () => {
      setNewPerson('');
      refresh();
      toast('Added â€” they set their own code on first sign-in');
    },
    onError,
  });

  const patch = useMutation({
    mutationFn: (p: { id: number; body: Record<string, unknown> }) => api.patch(`/api/users/${p.id}`, p.body),
    onSuccess: refresh,
    onError,
  });
  const remove = useMutation({
    mutationFn: (id: number) => api.del(`/api/users/${id}`),
    onSuccess: () => {
      refresh();
      toast('Removed');
    },
    onError,
  });

  return (
    <>
      <h3 className="section-title">People (admin)</h3>
      <p className="muted small" style={{ margin: '0 2px 4px' }}>
        New people set their own 4-digit code the first time they sign in.
      </p>
      <div className="add-row">
        <input
          className="input"
          value={newPerson}
          placeholder="Add a personâ€¦"
          onChange={(e) => setNewPerson(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && newPerson.trim().length >= 2 && addPerson.mutate()}
        />
        <button className="btn btn-primary" disabled={newPerson.trim().length < 2 || addPerson.isPending} onClick={() => addPerson.mutate()}>
          Add
        </button>
      </div>
      <div className="stack">
        {data?.users.map((u) => (
          <div key={u.id} className="card stack" style={{ gap: 8 }}>
            <div className="row spread">
              <div style={{ fontWeight: 700 }}>
                {u.name} {u.role === 'admin' && <span className="chip chip-approved">admin</span>}
                <span className="item-meta" style={{ marginLeft: 6 }}>
                  {u.hasPin ? 'PIN set' : 'no PIN yet'}
                </span>
              </div>
              <button
                className="icon-btn"
                aria-label={`Delete ${u.name}`}
                onClick={() => window.confirm(`Remove ${u.name} from the list? Only works if they have no bookings.`) && remove.mutate(u.id)}
              >
                âœ•
              </button>
            </div>
            <div className="row" style={{ flexWrap: 'wrap' }}>
              <select
                className="guest-select"
                style={{ width: 110, flex: 'none' }}
                value={u.family ?? ''}
                onChange={(e) => patch.mutate({ id: u.id, body: { family: e.target.value || null } })}
              >
                <option value="">no side</option>
                <option value="clore">Clore</option>
                <option value="gabriel">Gabriel</option>
              </select>
              <PhoneField key={`${u.id}-${u.phone ?? ''}`} user={u} onSave={(phone) => patch.mutate({ id: u.id, body: { phone } })} />
            </div>
            <div className="row" style={{ flexWrap: 'wrap' }}>
              {u.hasPin && (
                <button
                  className="btn btn-sm"
                  onClick={() =>
                    window.confirm(`Reset ${u.name}'s PIN? They'll create a new one next sign-in.`) &&
                    patch.mutate({ id: u.id, body: { resetPin: true } })
                  }
                >
                  Reset PIN
                </button>
              )}
              {me?.role === 'sysadmin' && (
                <button
                  className="btn btn-sm"
                  onClick={() => patch.mutate({ id: u.id, body: { role: u.role === 'admin' ? 'user' : 'admin' } })}
                >
                  {u.role === 'admin' ? 'Demote to user' : 'Make admin'}
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
    </>
  );
}

function PhoneField({ user, onSave }: { user: User; onSave: (phone: string) => void }) {
  const [value, setValue] = useState(user.phone ?? '');
  const dirty = value !== (user.phone ?? '');
  return (
    <span className="row" style={{ flex: 1, minWidth: 200 }}>
      <input
        className="guest-select"
        style={{ flex: 1 }}
        type="tel"
        placeholder="Phone for texts"
        value={value}
        onChange={(e) => setValue(e.target.value)}
      />
      {dirty && (
        <button className="btn btn-sm" onClick={() => onSave(value)}>
          Save
        </button>
      )}
    </span>
  );
}
