import React from 'react';
import ReactDOM from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import { App } from './App';
import './styles.css';

/** True while someone is mid-sentence in a field — a reload would throw it away. */
function isTyping(): boolean {
  const el = document.activeElement;
  if (!el) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (el as HTMLElement).isContentEditable;
}

let reloading = false;
function reloadForUpdate() {
  if (reloading) return;
  // Don't yank the page out from under a half-typed booking. The new worker has
  // already taken over, so the next foreground or blur picks it up instead.
  if (isTyping()) {
    const retry = () => {
      document.removeEventListener('visibilitychange', retry);
      window.removeEventListener('blur', retry);
      reloadForUpdate();
    };
    document.addEventListener('visibilitychange', retry, { once: true });
    window.addEventListener('blur', retry, { once: true });
    return;
  }
  reloading = true;
  window.location.reload();
}

// Apply new versions right away. Without this the service worker serves the
// previously cached build and the update only appears on some later launch.
registerSW({
  immediate: true,
  onNeedRefresh: reloadForUpdate,
  onRegisteredSW(_swUrl, registration) {
    if (!registration) return;

    // registerSW only checks for a new build at page load, so an app left open
    // on a phone would sit on an old version indefinitely. Poll for one, and
    // check again the moment the app returns to the foreground.
    const check = () => {
      if (navigator.onLine) registration.update().catch(() => { /* offline or server down; try again next tick */ });
    };
    setInterval(check, 60_000);
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) check();
    });
    window.addEventListener('online', check);
  },
});

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.addEventListener('controllerchange', reloadForUpdate);
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
