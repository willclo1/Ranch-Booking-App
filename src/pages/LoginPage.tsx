import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api';
import { useAuth } from '../auth';
import { useToast } from '../components/Toast';
import { Logo, Spinner } from '../components/bits';
import type { User } from '../types';

type Phase =
  | { kind: 'pick' }
  | { kind: 'pin'; person: User }
  | { kind: 'setup'; person: User; firstPin?: string }
  | { kind: 'sysadmin' };

export function LoginPage({ onShowInstall }: { onShowInstall?: () => void }) {
  const { setUser } = useAuth();
  const toast = useToast();
  const [phase, setPhase] = useState<Phase>({ kind: 'pick' });
  const [busy, setBusy] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ['login-people'],
    queryFn: () => api.get<{ people: User[] }>('/api/auth/people'),
  });

  const finish = (user: User) => {
    setUser(user);
    toast(`Howdy, ${user.name}!`);
  };

  const submitPin = async (pin: string) => {
    if (phase.kind === 'pin') {
      setBusy(true);
      try {
        const d = await api.post<{ user: User }>('/api/auth/login', { userId: phase.person.id, pin });
        finish(d.user);
      } catch (e) {
        toast(e instanceof Error ? e.message : 'Sign-in failed', 'error');
      } finally {
        setBusy(false);
      }
    } else if (phase.kind === 'setup') {
      if (!phase.firstPin) {
        setPhase({ ...phase, firstPin: pin });
      } else if (phase.firstPin !== pin) {
        toast("PINs didn't match — try again", 'error');
        setPhase({ kind: 'setup', person: phase.person });
      } else {
        setBusy(true);
        try {
          const d = await api.post<{ user: User }>('/api/auth/setup-pin', { userId: phase.person.id, pin });
          finish(d.user);
        } catch (e) {
          toast(e instanceof Error ? e.message : 'Could not set PIN', 'error');
          setPhase({ kind: 'setup', person: phase.person });
        } finally {
          setBusy(false);
        }
      }
    }
  };

  return (
    <div className="login-page">
      <div className="login-hero">
        <Logo size={110} />
        <h1>AV RANCH</h1>
        <div className="tagline">La Grange · Texas</div>
      </div>

      {phase.kind === 'pick' && (
        <>
          <p className="muted" style={{ textAlign: 'center' }}>
            Who's there?
          </p>
          {isLoading ? (
            <Spinner />
          ) : (
            <div className="people-grid">
              {data?.people.map((p) => (
                <button
                  key={p.id}
                  className="person-btn"
                  onClick={() => setPhase(p.hasPin ? { kind: 'pin', person: p } : { kind: 'setup', person: p })}
                >
                  <span className="person-name">{p.name}</span>
                  <span className="person-meta">
                    {p.family ? `${p.family === 'clore' ? 'Clore' : 'Gabriel'}` : ''}
                    {p.role === 'admin' ? ' · Admin' : ''}
                    {!p.hasPin ? ' · First visit' : ''}
                  </span>
                </button>
              ))}
            </div>
          )}
          {onShowInstall && (
            <button className="sysadmin-link" onClick={onShowInstall}>
              📲 How to put this app on your phone
            </button>
          )}
          <button className="sysadmin-link" onClick={() => setPhase({ kind: 'sysadmin' })}>
            Sysadmin access
          </button>
        </>
      )}

      {(phase.kind === 'pin' || phase.kind === 'setup') && (
        <PinEntry
          title={
            phase.kind === 'pin'
              ? `Hi ${phase.person.name} — enter your PIN`
              : phase.firstPin
                ? 'Enter it once more to confirm'
                : `Welcome ${phase.person.name}! Create a 4-digit PIN`
          }
          busy={busy}
          onSubmit={submitPin}
          onBack={() => setPhase({ kind: 'pick' })}
        />
      )}

      {phase.kind === 'sysadmin' && <SysadminEntry onBack={() => setPhase({ kind: 'pick' })} onDone={finish} />}
    </div>
  );
}

function PinEntry({
  title,
  busy,
  onSubmit,
  onBack,
}: {
  title: string;
  busy: boolean;
  onSubmit: (pin: string) => void;
  onBack: () => void;
}) {
  const [pin, setPin] = useState('');

  // Exactly 4 digits — the 4th digit submits automatically.
  const press = (d: string) => {
    if (busy || pin.length >= 4) return;
    const next = pin + d;
    setPin(next);
    if (next.length === 4) {
      onSubmit(next);
      setPin('');
    }
  };

  return (
    <div className="stack" style={{ alignItems: 'stretch' }}>
      <p style={{ textAlign: 'center', fontWeight: 650, margin: '4px 0 0' }}>{title}</p>
      <div className="pin-dots">
        {Array.from({ length: 4 }).map((_, i) => (
          <span key={i} className={`pin-dot ${i < pin.length ? 'filled' : ''}`} />
        ))}
      </div>
      <div className="pin-pad">
        {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((d) => (
          <button key={d} className="pin-key" onClick={() => press(d)} disabled={busy}>
            {d}
          </button>
        ))}
        <button className="pin-key ghost" onClick={onBack} disabled={busy}>
          Back
        </button>
        <button className="pin-key" onClick={() => press('0')} disabled={busy}>
          0
        </button>
        <button className="pin-key ghost" onClick={() => setPin(pin.slice(0, -1))} disabled={busy || pin.length === 0}>
          ⌫
        </button>
      </div>
    </div>
  );
}

function SysadminEntry({ onBack, onDone }: { onBack: () => void; onDone: (u: User) => void }) {
  const toast = useToast();
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);

  const go = async () => {
    setBusy(true);
    try {
      const d = await api.post<{ user: User }>('/api/auth/sysadmin', { code });
      onDone(d.user);
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Wrong code', 'error');
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
        value={code}
        onChange={(e) => setCode(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && go()}
        placeholder="Access code"
      />
      <button className="btn btn-primary btn-block" onClick={go} disabled={busy || !code}>
        Sign in
      </button>
      <button className="sysadmin-link" onClick={onBack}>
        Back to family sign-in
      </button>
    </div>
  );
}
