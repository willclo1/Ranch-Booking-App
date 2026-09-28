/**
 * Panel mode: the app framed inside the ranch's Home Assistant wall panel, a
 * landscape tablet showing it in a dialog about 1180 × 670.
 *
 * The dashboard loads the app as `/?panel=1`. The flag is kept for the rest
 * of the session so in-app navigation (which drops the query string) stays in
 * panel mode. Phones and the installed app never carry it, so for them
 * nothing changes: every panel rule in styles.css is scoped under
 * `html[data-panel]`, and the install prompt is simply skipped here.
 */
const KEY = 'ranch-panel';

function detect(): boolean {
  const asked = new URLSearchParams(window.location.search).has('panel');
  try {
    if (asked) sessionStorage.setItem(KEY, '1');
    return asked || sessionStorage.getItem(KEY) === '1';
  } catch {
    return asked; // storage blocked: still honour the URL itself
  }
}

export const isPanel = detect();

if (isPanel) document.documentElement.setAttribute('data-panel', '');
