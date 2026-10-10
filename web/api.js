// API client. Locally (laptop or phone on the same Wi-Fi) the API runs on port 3001 of the same host.
// Deployed, CloudFront serves the API at /api on the same address as the site.

const isLocal = /^(localhost|127\.0\.0\.1|192\.168\.\d+\.\d+|10\.\d+\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+)$/.test(location.hostname);
export const API = isLocal ? `http://${location.hostname}:3001` : `${location.origin}/api`;

// Errors carry .status: the HTTP status, or 0 when there was no response (offline or timed out).
export class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

// The signed-in organiser's token, when a page has imported auth.js (organiser pages only; volunteer and
// runner pages never sign in). Sent as "Authorization: Bearer"; the API verifies it.
let tokenSource = null;
export const setTokenSource = (fn) => { tokenSource = fn; };

// token: the secret from a volunteer's or runner's QR link (…&t=<token>).
export async function api(method, path, { body, pin, key, token, timeoutMs = 10000 } = {}) {
  const headers = {};
  if (body) headers['content-type'] = 'application/json';
  if (pin) headers['x-organiser-pin'] = pin;
  if (key) headers['x-organiser-key'] = key;
  if (token) headers['x-access-token'] = token;
  if (tokenSource) {
    try {
      const t = await tokenSource();
      if (t) headers.authorization = `Bearer ${t}`;
    } catch {}
  }
  let res;
  try {
    res = await fetch(API + path, { method, headers, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(timeoutMs) });
  } catch {
    throw new ApiError(0, 'Cannot reach Quench. Check your internet connection and try again.');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, data.error || `Request failed (${res.status}).`);
  return data;
}

// The organiser PIN is kept for this browser tab only.
const pinKey = (eventId) => `qs-pin-${eventId}`;
export const savePin = (eventId, pin) => {
  try { sessionStorage.setItem(pinKey(eventId), pin); } catch {}
};
export const loadPin = (eventId) => {
  try { return sessionStorage.getItem(pinKey(eventId)) || ''; } catch { return ''; }
};

export const escape = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const param = (name) => new URLSearchParams(location.search).get(name);

// One time format everywhere: "2:05 pm", and "Sat, 10 Oct, 2:05 pm" when the day matters.
export const clockTime = (x) => new Date(x).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' });
export const dayTime = (x) => new Date(x).toLocaleString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
