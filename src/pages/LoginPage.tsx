import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api';
import { useAuth } from '../auth';
import { useToast } from '../components/Toast';
import { Logo, Spinner } from '../components/bits';
import type { User } from '../types';

type Mode = 'signin' | 'new' | 'sysadmin';

export function LoginPage({ onShowInstall }: { onShowInstall?: () => void }) {
  const { setUser } = useAuth();
  const toast = useToast();
  const qc = useQueryClient();

  const [mode, setMode] = useState<Mode>('signin');
  const [selectedId, setSelectedId] = useState('');
  const [code, setCode] = useState('');
  const [confirm, setConfirm] = useState('');
  const [newName, setNewName] = useState('');
  const [busy, setBusy] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ['login-people'],
    queryFn: () => api.get<{ people: User[] }>('/api/auth/people'),
  });
  const people = data?.people ?? [];
  const person = people.find((p) => String(p.id) === selectedId) ?? null;

  const finish = (user: User) => {
    setUser(user);
    toast(`Howdy, ${user.name}!`);
  };

  const codeOk = /^\d{4}$/.test(code);
  const needsConfirm = mode === 'new' || (person !== null && !person.hasPin);
  const canGo =
    mode === 'new'
      ? newName.trim().length >= 2 && codeOk && confirm === code
      : person !== null && codeOk && (!needsConfirm || confirm === code);

  const submit = async () => {
    if (!canGo || busy) return;
    setBusy(true);
    try {
      if (mode === 'new') {
        const d = await api.post<{ user: User }>('/api/auth/register', { name: newName.trim(), pin: code });
        qc.invalidateQueries({ queryKey: ['login-people'] });
        finish(d.user);
      } else if (person && !person.hasPin) {
        const d = await api.post<{ user: User }>('/api/auth/setup-pin', { userId: person.id, pin: code });
        finish(d.user);
      } else if (person) {
        const d = await api.post<{ user: User }>('/api/auth/login', { userId: person.id, pin: code });
        finish(d.user);
      }
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Sign-in failed', 'error');
      setCode('');
      setConfirm('');
    } finally {
      setBusy(false);
    }
  };

  const codeField = (label: string, value: string, onChange: (v: string) => void, autoFocus = false) => (
    <label className="field">
      {label}
      <input
        className="input code-input"
        type="password"
        inputMode="numeric"
        pattern="[0-9]*"
        maxLength={4}
        autoFocus={autoFocus}
        value={value}
        placeholder="••••"
        onChange={(e) => onChange(e.target.value.replace(/\D/g, '').slice(0, 4))}
        onKeyDown={(e) => e.key === 'Enter' && submit()}
      />
    </label>
  );

  return (
    <div className="login-page">
      <div className="login-hero">
        <Logo size={110} />
        <h1>AV RANCH</h1>
        <div className="tagline">La Grange · Texas</div>
      </div>

      {mode === 'signin' && (
        <>
          {isLoading ? (
            <Spinner />
          ) : (
            <div className="card stack">
              <label className="field">
                Name
                <select
                  className="input"
                  value={selectedId}
                  onChange={(e) => {
                    setSelectedId(e.target.value);
                    setCode('');
                    setConfirm('');
                  }}
                >
                  <option value="">— choose your name —</option>
                  {people.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </label>

              {person && person.hasPin && (
                <>
                  {codeField('Your 4-digit code', code, setCode, true)}
                  <button className="btn btn-primary btn-block" disabled={!canGo || busy} onClick={submit}>
                    {busy ? 'Signing in…' : 'Sign in'}
                  </button>
                </>
              )}

              {person && !person.hasPin && (
                <>
                  <div className="banner banner-info">First visit — create a 4-digit code to protect your name.</div>
                  {codeField('Create a 4-digit code', code, setCode, true)}
                  {codeField('Type it again', confirm, setConfirm)}
                  {codeOk && confirm.length === 4 && confirm !== code && (
                    <p className="muted small" style={{ margin: 0 }}>
                      Those don't match yet.
                    </p>
                  )}
                  <button className="btn btn-primary btn-block" disabled={!canGo || busy} onClick={submit}>
                    {busy ? 'One sec…' : 'Create code & sign in'}
                  </button>
                </>
              )}
            </div>
          )}

          <button className="sysadmin-link" onClick={() => setMode('new')}>
            ＋ I'm new here — add my name
          </button>
          {onShowInstall && (
            <button className="sysadmin-link" onClick={onShowInstall}>
              📲 How to put this app on your phone
            </button>
          )}
          <button className="sysadmin-link" onClick={() => setMode('sysadmin')}>
            Sysadmin access
          </button>
        </>
      )}

      {mode === 'new' && (
        <>
          <div className="card stack">
            <label className="field">
              Your first name
              <input
                className="input"
                autoFocus
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="First name"
              />
            </label>
            {codeField('Create a 4-digit code', code, setCode)}
            {codeField('Type it again', confirm, setConfirm)}
            {codeOk && confirm.length === 4 && confirm !== code && (
              <p className="muted small" style={{ margin: 0 }}>
                Those don't match yet.
              </p>
            )}
            <button className="btn btn-primary btn-block" disabled={!canGo || busy} onClick={submit}>
              {busy ? 'One sec…' : 'Join the family list'}
            </button>
          </div>
          <button
            className="sysadmin-link"
            onClick={() => {
              setMode('signin');
              setCode('');
              setConfirm('');
            }}
          >
            Back to sign-in
          </button>
        </>
      )}

      {mode === 'sysadmin' && <SysadminEntry onBack={() => setMode('signin')} onDone={finish} />}
    </div>
  );
}

function SysadminEntry({ onBack, onDone }: { onBack: () => void; onDone: (u: User) => void }) {
  const toast = useToast();
  const [accessCode, setAccessCode] = useState('');
  const [busy, setBusy] = useState(false);

  const go = async () => {
    setBusy(true);
    try {
      const d = await api.post<{ user: User }>('/api/auth/sysadmin', { code: accessCode });
      onDone(d.user);
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Wrong access code', 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="stack">
      <p style={{ textAlign: 'center', fontWeight: 650 }}>Sysadmin access code</p>
      <input
        className="input"
        type="password"
        autoFocus
        value={accessCode}
        onChange={(e) => setAccessCode(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && go()}
        placeholder="Access code"
      />
      <button className="btn btn-primary btn-block" onClick={go} disabled={busy || !accessCode}>
        Sign in
      </button>
      <button className="sysadmin-link" onClick={onBack}>
        Back to family sign-in
      </button>
    </div>
  );
}
