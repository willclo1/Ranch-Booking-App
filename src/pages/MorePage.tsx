import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../api';
import { isAdminish, useAuth } from '../auth';
import { useToast } from '../components/Toast';
import { Spinner } from '../components/bits';
import { BookingCard } from './CalendarPage';
import type { Booking, ChecklistItem, User } from '../types';

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
              {user?.role === 'admin' && ' · Admin'}
              {user?.role === 'sysadmin' && ' · Sysadmin'}
            </div>
          </div>
          <button className="btn btn-sm" onClick={() => logout()}>
            Sign out
          </button>
        </div>
        {user && user.role !== 'sysadmin' && <MyPhone userId={user.id} />}
      </div>

      {admin && <ApprovalsInbox />}
      <ChecklistTemplates />
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
      {data?.bookings.length === 0 && <p className="muted">Nothing waiting on you. 🤠</p>}
      <div className="stack">
        {data?.bookings.map((b) => (
          <BookingCard key={b.id} booking={b} onClick={() => navigate(`/booking/${b.id}`)} />
        ))}
      </div>
    </>
  );
}

function ChecklistTemplates() {
  return (
    <>
      <h3 className="section-title">Checklists</h3>
      <p className="muted small" style={{ margin: '0 2px 4px' }}>
        These are the master check-in / check-out lists everyone runs through each stay. Anyone can edit.
      </p>
      <TemplateEditor type="checkin" title="Check-in" />
      <TemplateEditor type="checkout" title="Check-out" />
    </>
  );
}

function TemplateEditor({ type, title }: { type: 'checkin' | 'checkout'; title: string }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [text, setText] = useState('');

  const { data } = useQuery({
    queryKey: ['templates'],
    queryFn: () => api.get<{ checkin: ChecklistItem[]; checkout: ChecklistItem[] }>('/api/checklists/templates'),
  });
  const items = data?.[type] ?? [];

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['templates'] });
    qc.invalidateQueries({ queryKey: ['booking-checklist'] });
  };
  const onError = (e: unknown) => toast(e instanceof Error ? e.message : 'Failed', 'error');

  const add = useMutation({
    mutationFn: () => api.post('/api/checklists/templates', { type, text: text.trim() }),
    onSuccess: () => {
      setText('');
      refresh();
    },
    onError,
  });
  const rename = useMutation({
    mutationFn: (p: { id: number; text: string }) => api.patch(`/api/checklists/templates/${p.id}`, { text: p.text }),
    onSuccess: refresh,
    onError,
  });
  const move = useMutation({
    mutationFn: (p: { id: number; sortOrder: number }) => api.patch(`/api/checklists/templates/${p.id}`, { sortOrder: p.sortOrder }),
    onSuccess: refresh,
    onError,
  });
  const remove = useMutation({
    mutationFn: (id: number) => api.del(`/api/checklists/templates/${id}`),
    onSuccess: refresh,
    onError,
  });

  const swap = (idx: number, dir: -1 | 1) => {
    const other = items[idx + dir];
    const me = items[idx];
    if (!other) return;
    move.mutate({ id: me.id, sortOrder: other.sort_order });
    move.mutate({ id: other.id, sortOrder: me.sort_order });
  };

  return (
    <details className="acc" open={items.length === 0}>
      <summary>
        <span>{title} list</span>
        <span className="muted small">{items.length} items</span>
      </summary>
      <div className="acc-body stack">
        {items.map((item, idx) => (
          <div key={item.id} className="list-item" style={{ alignItems: 'center' }}>
            <div className="list-text">{item.text}</div>
            <button className="icon-btn" aria-label="Move up" disabled={idx === 0} onClick={() => swap(idx, -1)}>
              ↑
            </button>
            <button className="icon-btn" aria-label="Move down" disabled={idx === items.length - 1} onClick={() => swap(idx, 1)}>
              ↓
            </button>
            <button
              className="icon-btn"
              aria-label="Edit"
              onClick={() => {
                const next = window.prompt('Edit item', item.text);
                if (next && next.trim()) rename.mutate({ id: item.id, text: next.trim() });
              }}
            >
              ✎
            </button>
            <button
              className="icon-btn"
              aria-label="Delete"
              onClick={() => window.confirm(`Delete "${item.text}"?`) && remove.mutate(item.id)}
            >
              ✕
            </button>
          </div>
        ))}
        <div className="add-row">
          <input
            className="input"
            value={text}
            placeholder={`Add a ${title.toLowerCase()} step…`}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && text.trim() && add.mutate()}
          />
          <button className="btn btn-primary" disabled={!text.trim() || add.isPending} onClick={() => add.mutate()}>
            Add
          </button>
        </div>
      </div>
    </details>
  );
}

function PeopleManager() {
  const qc = useQueryClient();
  const toast = useToast();
  const { user: me } = useAuth();

  const { data } = useQuery({ queryKey: ['users'], queryFn: () => api.get<{ users: User[] }>('/api/users') });
  const refresh = () => qc.invalidateQueries({ queryKey: ['users'] });
  const onError = (e: unknown) => toast(e instanceof Error ? e.message : 'Failed', 'error');

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
        Add a phone number to an admin and they'll get a text when a booking needs their approval.
      </p>
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
