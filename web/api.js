// API client. Locally (laptop or phone on the same Wi-Fi) the API runs on port 3001 of the same host.
// After deploy (Step 0), set DEPLOYED_API to the ApiUrl output from `sam deploy`.
const DEPLOYED_API = '';

const isLocal = /^(localhost|127\.0\.0\.1|192\.168\.\d+\.\d+|10\.\d+\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+)$/.test(location.hostname);
export const API = isLocal ? `http://${location.hostname}:3001` : DEPLOYED_API;

// Errors carry .status: the HTTP status, or 0 when there was no response (offline or timed out).
export class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export async function api(method, path, { body, pin, timeoutMs = 10000 } = {}) {
  const headers = {};
  if (body) headers['content-type'] = 'application/json';
  if (pin) headers['x-organiser-pin'] = pin;
  let res;
  try {
    res = await fetch(API + path, { method, headers, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(timeoutMs) });
  } catch {
    throw new ApiError(0, 'Cannot reach QuenchSip. Check your internet connection and try again.');
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
