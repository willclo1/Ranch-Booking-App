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
              {user?.role === 'admin' && ' ·Admin'}
              {user?.role === 'sysadmin' && ' ·Sysadmin'}
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
        📲 How to put this app on your phone
      </Link>

      <p className="muted small" style={{ textAlign: 'center', marginTop: 10 }}>
        AV Ranch · La Grange, TX
      </p>
    </div>
  );
}

/** Everyone can save their own phone number — it powers the tap-to-text buttons. */
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

/**
 * Guests collapse into one compact, searchable drawer — a family with dozens of
 * one-time visitors shouldn't scroll past them to reach the members.
 */
function GuestDrawer({
  guests,
  onPromote,
  onDelete,
}: {
  guests: User[];
  onPromote: (id: number) => void;
  onDelete: (u: User) => void;
}) {
  const [search, setSearch] = useState('');
  if (guests.length === 0) return null;

  const query = search.trim().toLowerCase();
  const shown = query ? guests.filter((g) => g.name.toLowerCase().includes(query)) : guests;

  return (
    <details className="acc">
      <summary>
        <span>Guests</span>
        <span className="muted small">{guests.length} bookable names · no sign-in</span>
      </summary>
      <div className="acc-body">
        {guests.length > 6 && (
          <input
            className="input"
            style={{ marginBottom: 8 }}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={`Search ${guests.length} guests…`}
          />
        )}
        <div className="guest-rows">
          {shown.map((g) => (
            <div key={g.id} className="guest-row">
              <span className="guest-row-name">{g.name}</span>
              <button className="btn btn-sm" onClick={() => onPromote(g.id)} title="Let them sign in with their own code">
                Give sign-in
              </button>
              <button className="icon-btn" aria-label={`Remove ${g.name}`} onClick={() => onDelete(g)}>
                ✕
              </button>
            </div>
          ))}
          {shown.length === 0 && (
            <p className="muted small" style={{ margin: '8px 2px' }}>
              No guests matching "{search.trim()}".
            </p>
          )}
        </div>
      </div>
    </details>
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
    mutationFn: (kind: 'member' | 'guest') =>
      api.post('/api/users', { name: newPerson.trim(), isGuest: kind === 'guest' }),
    onSuccess: (_d, kind) => {
      setNewPerson('');
      refresh();
      toast(kind === 'guest' ? 'Added as a guest (bookable name, no sign-in)' : 'Added — they set their own code on first sign-in');
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
        <strong>Family members</strong> sign in with their own 4-digit code. <strong>Guests</strong> are bookable
        names only — kids, friends, in-laws — with no sign-in and hidden from the login screen.
      </p>
      <div className="stack" style={{ gap: 6 }}>
        <input
          className="input"
          value={newPerson}
          placeholder="Name to add…"
          onChange={(e) => setNewPerson(e.target.value)}
        />
        <div className="row">
          <button
            className="btn btn-primary btn-block btn-sm"
            disabled={newPerson.trim().length < 2 || addPerson.isPending}
            onClick={() => addPerson.mutate('member')}
          >
            Add family member
          </button>
          <button
            className="btn btn-block btn-sm"
            disabled={newPerson.trim().length < 2 || addPerson.isPending}
            onClick={() => addPerson.mutate('guest')}
          >
            Add guest
          </button>
        </div>
      </div>
      <GuestDrawer
        guests={data?.users.filter((u) => u.isGuest) ?? []}
        onPromote={(id) => patch.mutate({ id, body: { isGuest: false } })}
        onDelete={(u) =>
          window.confirm(`Remove ${u.name}? Only works if they're not on any booking.`) && remove.mutate(u.id)
        }
      />

      <div className="stack">
        {data?.users.filter((u) => !u.isGuest).map((u) => (
          <div key={u.id} className="card stack" style={{ gap: 8 }}>
            <div className="row spread">
              <div style={{ fontWeight: 700 }}>
                {u.name} {u.role === 'admin' && <span className="chip chip-approved">admin</span>}
                <span className="item-meta" style={{ marginLeft: 6 }}>
                  {u.hasPin ? 'code set' : 'no code yet'}
                </span>
              </div>
              <button
                className="icon-btn"
                aria-label={`Delete ${u.name}`}
                onClick={() => window.confirm(`Remove ${u.name} from the list? Only works if they have no bookings.`) && remove.mutate(u.id)}
              >
                ✕
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
              <button
                className="btn btn-sm"
                onClick={() =>
                  window.confirm(
                    `Make ${u.name} a guest? They'll lose sign-in access and their code, but stay bookable and keep their bookings.`
                  ) && patch.mutate({ id: u.id, body: { isGuest: true } })
                }
              >
                Make guest-only
              </button>
              {u.hasPin && (
                <button
                  className="btn btn-sm"
                  onClick={() =>
                    window.confirm(`Reset ${u.name}'s code? They'll create a new one next sign-in.`) &&
                    patch.mutate({ id: u.id, body: { resetPin: true } })
                  }
                >
                  Reset code
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
