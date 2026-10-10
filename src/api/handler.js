// Single Lambda behind API Gateway (HTTP API, payload v2). Also used by the local dev server.
import { ValidationError } from '../core/event.js';
import { TapError } from '../core/tap.js';
import { HttpError, createEvent, getEvent, isOrganiser, requireLink, addStation, removeStation, addRunner, removeRunner, updateEvent, updateStation } from '../lib/events.js';
import { acceptTap } from '../lib/tapQueue.js';
import { ack, done, runnerView } from '../lib/dispatch.js';
import { eventSummary } from '../lib/summary.js';

const ID = '([a-z0-9]{4,12})';
// [method, path, action, success status]
const routes = [
  ['GET', /^\/health$/, async () => ({ ok: true, service: 'quench', time: new Date().toISOString() }), 200],
  ['POST', /^\/events$/, async ({ body }) => createEvent(body), 201],
  // Anyone can view an event; only the organiser's view includes the QR link tokens.
  ['GET', new RegExp(`^/events/${ID}$`), async ({ params, auth }) => getEvent(params[0], { withTokens: await isOrganiser(params[0], auth) }), 200],
  ['GET', new RegExp(`^/events/${ID}/summary$`), async ({ params }) => eventSummary(params[0]), 200],
  // Organiser actions: the organiser key from their private link (x-organiser-key), or a PIN for older events.
  ['PATCH', new RegExp(`^/events/${ID}$`), async ({ params, auth, body }) => updateEvent(params[0], auth, body), 200],
  ['POST', new RegExp(`^/events/${ID}/stations$`), async ({ params, auth, body }) => addStation(params[0], auth, body), 201],
  ['PATCH', new RegExp(`^/events/${ID}/stations/${ID}$`), async ({ params, auth, body }) => updateStation(params[0], auth, params[1], body), 200],
  ['DELETE', new RegExp(`^/events/${ID}/stations/${ID}$`), async ({ params, auth }) => removeStation(params[0], auth, params[1]), 200],
  ['POST', new RegExp(`^/events/${ID}/runners$`), async ({ params, auth, body }) => addRunner(params[0], auth, body), 201],
  ['DELETE', new RegExp(`^/events/${ID}/runners/${ID}$`), async ({ params, auth }) => removeRunner(params[0], auth, params[1]), 200],
  // Volunteers and runners have no login: the token in their QR link (x-access-token) is their access.
  // The ids alone are public, so they grant nothing. Checked here, before a tap is queued.
  ['POST', new RegExp(`^/events/${ID}/stations/${ID}/taps$`), async ({ params, auth, body }) => {
    await requireLink(params[0], 'STN', params[1], auth.token);
    return acceptTap(params[0], params[1], body);
  }, 201],
  ['GET', new RegExp(`^/events/${ID}/stations/${ID}/link$`), async ({ params, auth }) => {
    await requireLink(params[0], 'STN', params[1], auth.token);
    return { ok: true };
  }, 200],
  ['GET', new RegExp(`^/events/${ID}/runners/${ID}$`), async ({ params, auth }) => {
    await requireLink(params[0], 'RUN', params[1], auth.token);
    return runnerView(params[0], params[1]);
  }, 200],
  ['POST', new RegExp(`^/events/${ID}/jobs/${ID}/ack$`), async ({ params, auth, body }) => {
    await requireLink(params[0], 'RUN', body?.runnerId, auth.token);
    return ack(params[0], params[1], body?.runnerId);
  }, 200],
  ['POST', new RegExp(`^/events/${ID}/jobs/${ID}/done$`), async ({ params, auth, body }) => {
    await requireLink(params[0], 'RUN', body?.runnerId, auth.token);
    return done(params[0], params[1], body?.runnerId, body);
  }, 200],
];

const json = (statusCode, data) => ({
  statusCode,
  headers: { 'content-type': 'application/json', 'access-control-allow-origin': '*' },
  body: JSON.stringify(data),
});

export async function handler(event) {
  const method = event.requestContext?.http?.method || 'GET';
  // CloudFront forwards /api/* to this function, so drop that prefix; direct API Gateway calls have none.
  const path = (event.rawPath || '/').replace(/^\/api(?=\/)/, '');
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
      const data = await fn({ params: match.slice(1), body, auth: { pin: headers['x-organiser-pin'], key: headers['x-organiser-key'], token: headers['x-access-token'] } });
      // Some actions choose their own status: { status, body } (e.g. 202 for a queued tap).
      if (data && 'body' in data && 'status' in data) return json(data.status ?? (data.body?.duplicate ? 200 : status), data.body);
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
