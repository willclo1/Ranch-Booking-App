// Tap-to-text: build an sms: link that opens the user's own Messages app
// pre-filled with recipients and body — sent from their own number, no service needed.

const isAndroid = () => /Android/i.test(navigator.userAgent);

/** Keep only what a dialler accepts, so a hand-typed "(409) 682-4398" still works. */
function clean(phone: string): string {
  const digits = phone.replace(/[^\d+]/g, '');
  // A '+' is only meaningful as a country prefix at the very front.
  return digits.startsWith('+') ? '+' + digits.slice(1).replace(/\+/g, '') : digits.replace(/\+/g, '');
}

export function smsHref(phones: string[], body: string): string {
  const to = phones.map(clean).filter(Boolean);
  const encoded = encodeURIComponent(body);

  if (isAndroid()) {
    // RFC 5724: comma-separated recipients, and Android wants `?body=`.
    return `sms:${to.join(',')}?body=${encoded}`;
  }

  // iOS keeps only the first number in a plain `sms:a,b` link and silently drops
  // the rest — which is why texting "Jimmy & Lynn" only ever opened Jimmy. The
  // `/open?addresses=` form is the one it honours for more than one recipient.
  if (to.length > 1) {
    return `sms:/open?addresses=${to.join(',')}&body=${encoded}`;
  }
  return `sms:${to[0] ?? ''}&body=${encoded}`;
}
