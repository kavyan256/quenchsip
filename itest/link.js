// Tests play the volunteer's or runner's phone, which has the token from its QR link.
// This reads that token straight from the table so tests can call phone routes like the real page does.
import { GetCommand } from '@aws-sdk/lib-dynamodb';
import { db, TABLE } from '../src/lib/db.js';

const PHONE_ROUTES = [
  [/^(?:\/api)?\/events\/([a-z0-9]+)\/stations\/([a-z0-9]+)\/(?:taps|link)$/, 'STN', (m) => m[2]],
  [/^(?:\/api)?\/events\/([a-z0-9]+)\/runners\/([a-z0-9]+)$/, 'RUN', (m) => m[2]],
  [/^(?:\/api)?\/events\/([a-z0-9]+)\/jobs\/[a-z0-9]+\/(?:ack|done)$/, 'RUN', (m, body) => body?.runnerId],
];

// Creating an event needs a signed-in organiser: tests sign in as one test account (local tokens, see src/lib/auth.js).
import { issueLocalToken } from '../src/lib/auth.js';
export const organiserToken = (email = 'organiser@quench.test') => issueLocalToken(email);

export async function linkHeaders(method, path, body) {
  // A fresh test account per event, so the per-account cap (20 active events) never trips unrelated tests.
  if (method === 'POST' && /^(?:\/api)?\/events$/.test(path)) return { authorization: `Bearer ${organiserToken(`organiser-${Math.random().toString(36).slice(2)}@quench.test`)}` };
  for (const [re, kind, idOf] of PHONE_ROUTES) {
    const m = path.match(re);
    if (!m || (kind === 'RUN' && !path.includes('/jobs/') && method !== 'GET')) continue;
    const id = idOf(m, body);
    if (!id) return {};
    const res = await db.send(new GetCommand({ TableName: TABLE, Key: { PK: `EVT#${m[1]}`, SK: `${kind}#${id}` } }));
    return res.Item?.token ? { 'x-access-token': res.Item.token } : {};
  }
  return {};
}
