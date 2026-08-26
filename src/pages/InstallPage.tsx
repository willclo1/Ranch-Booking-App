import { Logo } from '../components/bits';

export function isStandalone(): boolean {
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    (navigator as unknown as { standalone?: boolean }).standalone === true
  );
}

export function isPhone(): boolean {
  return /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
}

const INSTALL_SEEN_KEY = 'av-ranch-install-seen';

export function markInstallSeen() {
  try {
    localStorage.setItem(INSTALL_SEEN_KEY, '1');
  } catch {
    /* private mode */
  }
}

export function shouldShowInstall(): boolean {
  try {
    return isPhone() && !isStandalone() && !localStorage.getItem(INSTALL_SEEN_KEY);
  } catch {
    return false;
  }
}

/** First-visit instructions for putting the PWA on a phone home screen. */
export function InstallPage({ onDone }: { onDone: () => void }) {
  const address = window.location.origin;

  const iphone = (
    <div className="card stack" style={{ gap: 8 }}>
      <h3 style={{ fontSize: 16 }}>🍎 iPhone / iPad</h3>
      <ol className="install-steps">
        <li>
          Open <strong>{address}</strong> in <strong>Safari</strong> (it must be Safari, not Chrome).
        </li>
        <li>
          Tap the <strong>Share</strong> button — the square with an arrow{' '}
          <span className="install-glyph" aria-hidden="true">
            ⎋
          </span>{' '}
          at the bottom of the screen.
        </li>
        <li>
          Scroll down and tap <strong>Add to Home Screen</strong>.
        </li>
        <li>
          Tap <strong>Add</strong>. Done — the AV Ranch logo is now on your home screen like a real app.
        </li>
      </ol>
    </div>
  );

  const android = (
    <div className="card stack" style={{ gap: 8 }}>
      <h3 style={{ fontSize: 16 }}>🤖 Android</h3>
      <ol className="install-steps">
        <li>
          Open <strong>{address}</strong> in <strong>Chrome</strong>.
        </li>
        <li>
          Tap the <strong>⋮</strong> menu in the top-right corner.
        </li>
        <li>
          Tap <strong>Add to Home screen</strong> (or <strong>Install app</strong>), then confirm.
        </li>
      </ol>
    </div>
  );

  return (
    <div className="login-page">
      <div className="login-hero">
        <Logo size={90} />
        <h1>AV RANCH</h1>
        <div className="tagline">Put it on your phone</div>
      </div>

      <p className="muted" style={{ textAlign: 'center', margin: 0 }}>
        Add AV Ranch to your home screen once and it opens like a regular app from then on.
      </p>

      {iphone}
      {android}

      <p className="muted small" style={{ textAlign: 'center', margin: '4px 0 0' }}>
        Your phone needs to reach the ranch computer — same Wi-Fi at home, or Tailscale from anywhere.
      </p>

      <button className="btn btn-primary btn-block" onClick={onDone}>
        Got it — continue to the app
      </button>
    </div>
  );
}
