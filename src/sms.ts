// Tap-to-text: build an sms: link that opens the user's own Messages app
// pre-filled with recipients and body — sent from their own number, no service needed.

const isAndroid = () => /Android/i.test(navigator.userAgent);

export function smsHref(phones: string[], body: string): string {
  // iOS wants `sms:...&body=`, Android wants `sms:...?body=`.
  // The family is all-iPhone, so Apple's format is the default.
  const sep = isAndroid() ? '?' : '&';
  return `sms:${phones.join(',')}${sep}body=${encodeURIComponent(body)}`;
}
