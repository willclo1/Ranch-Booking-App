import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api';
import { isAdminish, useAuth } from '../auth';
import { fmtDateTime } from '../dates';
import { useToast } from '../components/Toast';
import { Spinner } from '../components/bits';
import type { ChecklistItem, ListItem } from '../types';

type ListKind = 'grocery' | 'todos';
type Segment = ListKind | 'checklists';

export function ListsPage() {
  const [segment, setSegment] = useState<Segment>('grocery');
  const [showArchive, setShowArchive] = useState(false);

  return (
    <div className="stack">
      <div className="tabs">
        <button className={`tab ${segment === 'grocery' ? 'active' : ''}`} onClick={() => setSegment('grocery')}>
          🛒 Groceries
        </button>
        <button className={`tab ${segment === 'todos' ? 'active' : ''}`} onClick={() => setSegment('todos')}>
          🔨 To-Do
        </button>
        <button className={`tab ${segment === 'checklists' ? 'active' : ''}`} onClick={() => setSegment('checklists')}>
          ✅ Checklists
        </button>
      </div>

      {segment === 'checklists' ? (
        <>
          <p className="muted small" style={{ margin: '0 2px' }}>
            The master check-in / check-out lists everyone runs through each stay. Anyone can edit them; you tick the
            boxes on your own booking.
          </p>
          <TemplateEditor type="checkin" title="Check-in" />
          <TemplateEditor type="checkout" title="Check-out" />
        </>
      ) : (
        <>
          <div className="tabs">
            <button className={`tab ${!showArchive ? 'active' : ''}`} onClick={() => setShowArchive(false)}>
              Open
            </button>
            <button className={`tab ${showArchive ? 'active' : ''}`} onClick={() => setShowArchive(true)}>
              {segment === 'grocery' ? 'Bought (archive)' : 'Done (archive)'}
            </button>
          </div>
          <ItemList key={`${segment}-${showArchive}`} kind={segment} archived={showArchive} />
        </>
      )}
    </div>
  );
}

function TemplateEditor({ type, title }: { type: 'checkin' | 'checkout'; title: string }) {
  const qc = useQueryClient();
  const toast = useToast();
  const { user } = useAuth();
  // Check-in / check-out steps are the same for every stay, so admins own them.
  // Everyone else reads them here and ticks them off on their own booking.
  const admin = isAdminish(user);
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
            {admin && (
              <>
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
              </>
            )}
          </div>
        ))}
        {admin ? (
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
        ) : (
          <p className="muted small" style={{ margin: 0 }}>
            {items.length === 0
              ? 'The admins haven’t set up this list yet.'
              : 'The admins keep this list the same for every stay. You tick these off on your own booking.'}
          </p>
        )}
      </div>
    </details>
  );
}

function ItemList({ kind, archived }: { kind: ListKind; archived: boolean }) {
  const qc = useQueryClient();
  const toast = useToast();
  const { user } = useAuth();
  const [text, setText] = useState('');

  const queryKey = ['list', kind, archived];
  const { data, isLoading } = useQuery({
    queryKey,
    queryFn: () => api.get<{ items: ListItem[] }>(`/api/lists/${kind}?archived=${archived ? 1 : 0}`),
  });

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['list', kind, true] });
    qc.invalidateQueries({ queryKey: ['list', kind, false] });
  };

  const add = useMutation({
    mutationFn: () => api.post(`/api/lists/${kind}`, { text: text.trim() }),
    onSuccess: () => {
      setText('');
      refresh();
    },
    onError: (e) => toast(e instanceof Error ? e.message : 'Failed', 'error'),
  });

  const markDone = useMutation({
    mutationFn: (id: number) => api.post(`/api/lists/${kind}/${id}/done`),
    onSuccess: refresh,
    onError: (e) => toast(e instanceof Error ? e.message : 'Failed', 'error'),
  });
  const markUndone = useMutation({
    mutationFn: (id: number) => api.post(`/api/lists/${kind}/${id}/undone`),
    onSuccess: refresh,
    onError: (e) => toast(e instanceof Error ? e.message : 'Failed', 'error'),
  });
  const remove = useMutation({
    mutationFn: (id: number) => api.del(`/api/lists/${kind}/${id}`),
    onSuccess: refresh,
    onError: (e) => toast(e instanceof Error ? e.message : 'Failed', 'error'),
  });

  const doneVerb = kind === 'grocery' ? 'Bought' : 'Done';

  return (
    <>
      {!archived && (
        <div className="add-row">
          <input
            className="input"
            value={text}
            placeholder={kind === 'grocery' ? 'Add a grocery item…' : 'Add a to-do…'}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && text.trim() && add.mutate()}
          />
          <button className="btn btn-primary" disabled={!text.trim() || add.isPending} onClick={() => add.mutate()}>
            Add
          </button>
        </div>
      )}

      {isLoading ? (
        <Spinner />
      ) : (
        <div className="card" style={{ padding: '4px 14px' }}>
          {(data?.items ?? []).length === 0 && (
            <p className="muted" style={{ padding: '12px 0' }}>
              {archived ? 'Nothing archived yet.' : 'List is empty.'}
            </p>
          )}
          {(data?.items ?? []).map((item) => (
            <div key={item.id} className="list-item">
              <button
                className={`check-circle ${archived ? 'checked' : ''}`}
                aria-label={archived ? `Un-${doneVerb.toLowerCase()}` : doneVerb}
                onClick={() => (archived ? markUndone.mutate(item.id) : markDone.mutate(item.id))}
              >
                ✓
              </button>
              <div className="list-text">
                <div className={archived ? 'done' : ''}>{item.text}</div>
                <div className="item-meta">
                  Added by {item.addedBy} · {fmtDateTime(item.addedAt)}
                  {item.doneAt && (
                    <>
                      <br />
                      {doneVerb} by {item.doneBy} · {fmtDateTime(item.doneAt)}
                    </>
                  )}
                </div>
              </div>
              {(isAdminish(user) || item.addedBy === user?.name) && (
                <button
                  className="icon-btn"
                  aria-label="Delete"
                  onClick={() => window.confirm(`Delete "${item.text}"?`) && remove.mutate(item.id)}
                >
                  ✕
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </>
  );
}
