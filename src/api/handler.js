// Single Lambda behind API Gateway (HTTP API, payload v2). Also used by the local dev server.
import { ValidationError } from '../core/event.js';
import { TapError } from '../core/tap.js';
import { HttpError, createEvent, getEvent, addStation, removeStation, addRunner, removeRunner } from '../lib/events.js';
import { recordTap } from '../lib/taps.js';

const ID = '([a-z0-9]{4,12})';
// [method, path, action, success status]
const routes = [
  ['GET', /^\/health$/, async () => ({ ok: true, service: 'quench', time: new Date().toISOString() }), 200],
  ['POST', /^\/events$/, async ({ body }) => createEvent(body), 201],
  ['GET', new RegExp(`^/events/${ID}$`), async ({ params }) => getEvent(params[0]), 200],
  ['POST', new RegExp(`^/events/${ID}/stations$`), async ({ params, pin, body }) => addStation(params[0], pin, body), 201],
  ['DELETE', new RegExp(`^/events/${ID}/stations/${ID}$`), async ({ params, pin }) => removeStation(params[0], pin, params[1]), 200],
  ['POST', new RegExp(`^/events/${ID}/runners$`), async ({ params, pin, body }) => addRunner(params[0], pin, body), 201],
  ['DELETE', new RegExp(`^/events/${ID}/runners/${ID}$`), async ({ params, pin }) => removeRunner(params[0], pin, params[1]), 200],
  // Volunteers tap without a PIN; the station QR link is their access.
  ['POST', new RegExp(`^/events/${ID}/stations/${ID}/taps$`), async ({ params, body }) => recordTap(params[0], params[1], body), 201],
];

const json = (statusCode, data) => ({
  statusCode,
  headers: { 'content-type': 'application/json', 'access-control-allow-origin': '*' },
  body: JSON.stringify(data),
});

export async function handler(event) {
  const method = event.requestContext?.http?.method || 'GET';
  const path = event.rawPath || '/';
  const headers = Object.fromEntries(Object.entries(event.headers || {}).map(([k, v]) => [k.toLowerCase(), v]));

  let body;
  try {
    body = event.body ? JSON.parse(event.isBase64Encoded ? Buffer.from(event.body, 'base64').toString() : event.body) : undefined;
  } catch {
    return json(400, { error: 'Request body is not valid JSON.' });
  }

  for (const [m, re, fn, status] of routes) {
    const match = m === method && path.match(re);
    if (!match) continue;
    try {
      const data = await fn({ params: match.slice(1), body, pin: headers['x-organiser-pin'] });
      // A retried tap that was already stored is fine: 200, not 201.
      return json(data?.duplicate ? 200 : status, data);
    } catch (err) {
      if (err instanceof ValidationError || err instanceof TapError) return json(400, { error: err.message });
      if (err instanceof HttpError) return json(err.status, { error: err.message });
      console.error(err);
      return json(500, { error: 'Something went wrong. Please try again.' });
    }
  }
  return json(404, { error: 'Not found.' });
}
