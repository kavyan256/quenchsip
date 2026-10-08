// Volunteer taps. Pure functions, shared by the browser and the API.

export const TAP_TYPES = {
  swap: 'Jar swapped',
  last_jar: 'Last jar',
  cups_low: 'Cups low',
};

// A tap can sit in a phone's queue (Step 4), so we trust the phone's clock for when it happened,
// unless it is clearly wrong: in the future, or more than a day old.
const MAX_FUTURE_MS = 2 * 60 * 1000;
const MAX_AGE_MS = 24 * 60 * 60 * 1000;

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export class TapError extends Error {}

export function validateTap(input, nowMs = Date.now()) {
  const uuid = typeof input?.uuid === 'string' ? input.uuid.toLowerCase() : '';
  if (!UUID_V4.test(uuid)) throw new TapError('Tap id is missing or invalid.');
  if (!Object.hasOwn(TAP_TYPES, input?.type)) throw new TapError('Unknown tap type.');

  const device = Date.parse(input?.deviceTs);
  const deviceOk = Number.isFinite(device) && device <= nowMs + MAX_FUTURE_MS && device >= nowMs - MAX_AGE_MS;
  return {
    uuid,
    type: input.type,
    tappedAt: new Date(deviceOk ? device : nowMs).toISOString(),
    deviceTs: Number.isFinite(device) ? new Date(device).toISOString() : null,
    clockTrusted: deviceOk,
  };
}

// Random v4 UUID that also works on plain http:// over Wi-Fi,
// where crypto.randomUUID() is unavailable (it needs a secure context).
export function newTapId(cryptoObj = globalThis.crypto) {
  const b = cryptoObj.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
