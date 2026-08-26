import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api';
import { isAdminish, useAuth } from '../auth';
import { fmtDateTime } from '../dates';
import { useToast } from '../components/Toast';
import { Spinner } from '../components/bits';
import type { ListItem } from '../types';

type ListKind = 'grocery' | 'todos';

export function ListsPage() {
  const [kind, setKind] = useState<ListKind>('grocery');
  const [showArchive, setShowArchive] = useState(false);

  return (
    <div className="stack">
      <div className="tabs">
        <button className={`tab ${kind === 'grocery' ? 'active' : ''}`} onClick={() => setKind('grocery')}>
          🛒 Groceries
        </button>
        <button className={`tab ${kind === 'todos' ? 'active' : ''}`} onClick={() => setKind('todos')}>
          🔨 To-Do
        </button>
      </div>
      <div className="tabs">
        <button className={`tab ${!showArchive ? 'active' : ''}`} onClick={() => setShowArchive(false)}>
          Open
        </button>
        <button className={`tab ${showArchive ? 'active' : ''}`} onClick={() => setShowArchive(true)}>
          {kind === 'grocery' ? 'Bought (archive)' : 'Done (archive)'}
        </button>
      </div>
      <ItemList key={`${kind}-${showArchive}`} kind={kind} archived={showArchive} />
    </div>
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
