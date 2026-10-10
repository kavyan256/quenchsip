// Event storage: one DynamoDB partition per event.
//   PK EVT#<id>  SK META        event settings + hash of the organiser key (and of the PIN, for older events)
//   PK EVT#<id>  SK STN#<sid>   station (+ token: the secret in its volunteer QR link)
//   PK EVT#<id>  SK RUN#<rid>   runner (+ token: the secret in their runner link)
//   PK EVT#<id>  SK JOB#<jobId> runner job (see dispatch.js)
//   PK EVT#<id>  SK TAP#<uuid>  volunteer tap (see taps.js); sorts after the others
//   PK EVENTS    SK <startsAt>#<id>  index of events by start time (for the scheduled projector)
import { GetCommand, QueryCommand, TransactWriteCommand, PutCommand, DeleteCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { db, TABLE } from './db.js';
import { hashPin, verifyPin, newId, sameSecret } from './pin.js';
import { validateEvent, validatePin, validateStation, validateRunner, validateStationPatch, validateEventPatch, crowdShare, hourLabels, LIMITS } from '../core/event.js';
import { planEvent, readiness } from '../core/plan.js';

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const pk = (id) => `EVT#${id}`;
// Station and runner ids are public (the board shows them); the token in each QR link is what grants access.
const TOKEN_LENGTH = 16;
const newToken = () => newId(TOKEN_LENGTH);

// Returns { id, key }. The key goes in the organiser's private link; only its hash is stored.
// A PIN is still accepted (older clients and tests) but no longer needed.
export async function createEvent(input) {
  const ev = validateEvent(input);
  const pin = input?.pin === undefined ? undefined : validatePin(input.pin);
  const key = newId(24);
  const id = newId();
  const now = new Date().toISOString();
  const { stations, runners, ...settings } = ev;

  const items = [
    { PK: pk(id), SK: 'META', type: 'event', id, ...settings, keyHash: hashPin(key), ...(pin ? { pinHash: hashPin(pin) } : {}), setup: { ordered: false, linksShared: false }, createdAt: now },
    // Index of events by start time, so the scheduled projector finds live events without a table scan.
    ...(settings.startsAt
      ? [{ PK: 'EVENTS', SK: `${settings.startsAt}#${id}`, type: 'event-index', id, endsAt: new Date(Date.parse(settings.startsAt) + settings.hourCount * 3600000).toISOString() }]
      : []),
    ...stations.map((s, i) => ({ PK: pk(id), SK: `STN#${newId(6)}`, type: 'station', ...s, token: newToken(), order: i, jarsOnHand: 0, cupsOnHand: 0, stocked: false, createdAt: now })),
    ...runners.map((r, i) => ({ PK: pk(id), SK: `RUN#${newId(6)}`, type: 'runner', ...r, token: newToken(), order: i, status: 'free', createdAt: now })),
  ];
  await db.send(
    new TransactWriteCommand({
      TransactItems: items.map((Item, i) => ({
        Put: { TableName: TABLE, Item, ...(i === 0 ? { ConditionExpression: 'attribute_not_exists(PK)' } : {}) },
      })),
    })
  );
  return { id, key };
}

// Public view: no PIN or key hash, and no link tokens unless withTokens (the organiser, who prints the QR codes).
// The plan is worked out on read, so it always matches the current stations.
export async function getEvent(id, { withTokens = false } = {}) {
  // SK < "TAP#" reads META, RUN# and STN# items but skips the (many) taps.
  const res = await db.send(
    new QueryCommand({ TableName: TABLE, KeyConditionExpression: 'PK = :pk AND SK < :taps', ExpressionAttributeValues: { ':pk': pk(id), ':taps': 'TAP#' } })
  );
  const meta = res.Items.find((x) => x.SK === 'META');
  if (!meta) throw new HttpError(404, 'Event not found.');
  const { PK, SK, pinHash, keyHash, type, ...event } = meta;
  // In the order they were added (items are stored by random id).
  const byOrder = (a, b) => (a.order ?? Infinity) - (b.order ?? Infinity) || (a.createdAt || '').localeCompare(b.createdAt || '') || a.name.localeCompare(b.name, undefined, { numeric: true });
  const strip = ({ PK, SK, type, token, ...rest }) => ({ id: SK.slice(4), ...rest, ...(withTokens && token ? { token } : {}) });
  const stations = res.Items.filter((x) => x.type === 'station').map(strip).sort(byOrder);
  const runners = res.Items.filter((x) => x.type === 'runner').map(strip).sort(byOrder);
  // Task tokens resume the dispatch state machine, so they never leave the server.
  const jobs = res.Items.filter((x) => x.type === 'job').map(({ PK, SK, type, ackToken, doneToken, executionArn, ...j }) => ({ id: SK.slice(4), ...j, running: Boolean(executionArn) }));

  const hours = hourLabels(event.startHour, event.hourCount);
  // Without a crowd grid (new events), each station is its own "zone" with an equal share; busy spots double.
  const byWeight = !event.share;
  const planStations = byWeight ? stations.map((s) => ({ ...s, zone: s.id })) : stations;
  const share = byWeight ? crowdShare(stations, event.hourCount) : event.share;
  const plan = planEvent({ attendees: event.attendees, hours, stations: planStations, share, litresPerPersonHr: event.litresPerPersonHr, heatFactor: event.heatFactor });
  const ready = readiness({ attendees: event.attendees, stationCount: stations.length, volunteerCount: event.volunteerCount, jarSupplier: event.jarSupplier, signal: event.signal });
  const zonesWithoutShare = byWeight ? [] : [...new Set(stations.map((s) => s.zone))].filter((z) => !event.share[z]);
  const warnings = [
    ...ready.warnings,
    ...plan.warnings,
    ...zonesWithoutShare.map((z) => `Zone "${z}" has no crowd share, so its stations are planned at 0 jars.`),
  ];
  return { event, hours, stations, runners, jobs, plan: { rows: plan.rows.map((r) => ({ stationId: r.station.id, byHour: r.byHour, total: r.total })), total: plan.total }, warnings };
}

// auth: { key } from the organiser link, or { pin } for older events.
async function requirePin(id, auth = {}) {
  const res = await db.send(new GetCommand({ TableName: TABLE, Key: { PK: pk(id), SK: 'META' } }));
  if (!res.Item) throw new HttpError(404, 'Event not found.');
  const ok = (auth.key && res.Item.keyHash && verifyPin(auth.key, res.Item.keyHash)) || (auth.pin && res.Item.pinHash && verifyPin(auth.pin, res.Item.pinHash));
  if (!ok) throw new HttpError(403, auth.key ? 'This organiser link is not valid for this event.' : 'Wrong organiser PIN.');
}

// True when auth carries this event's organiser key (or PIN). Never throws for a bad key: the caller just gets the public view.
export async function isOrganiser(id, auth = {}) {
  if (!auth.key && !auth.pin) return false;
  try {
    await requirePin(id, auth);
    return true;
  } catch (err) {
    if (err.status === 403) return false;
    throw err;
  }
}

// Volunteer and runner actions: the token from their QR link must match the station's or runner's.
// Stations and runners from before tokens existed have none and stay open, so printed links keep working.
export async function requireLink(id, kind, itemId, token) {
  const label = kind === 'STN' ? 'Station' : 'Runner';
  if (!itemId) throw new HttpError(403, 'This link is not valid. Ask the organiser for your QR code.');
  const res = await db.send(new GetCommand({ TableName: TABLE, Key: { PK: pk(id), SK: `${kind}#${itemId}` }, ProjectionExpression: '#t', ExpressionAttributeNames: { '#t': 'token' } }));
  if (!res.Item) throw new HttpError(404, `${label} not found.`);
  if (res.Item.token && !sameSecret(token, res.Item.token)) throw new HttpError(403, 'This link is not valid. Ask the organiser for your QR code.');
}

export async function updateEvent(id, auth, input) {
  await requirePin(id, auth);
  const patch = validateEventPatch(input);
  const names = {};
  const values = {};
  const sets = [];
  for (const [k, v] of Object.entries(patch)) {
    if (k === 'setup') {
      for (const [sk, sv] of Object.entries(v)) {
        names['#setup'] = 'setup';
        names[`#${sk}`] = sk;
        values[`:${sk}`] = sv;
        sets.push(`#setup.#${sk} = :${sk}`);
      }
    } else {
      names[`#${k}`] = k;
      values[`:${k}`] = v;
      sets.push(`#${k} = :${k}`);
    }
  }
  await db.send(new UpdateCommand({ TableName: TABLE, Key: { PK: pk(id), SK: 'META' }, UpdateExpression: `SET ${sets.join(', ')}`, ExpressionAttributeNames: names, ExpressionAttributeValues: values }));
  return { ok: true };
}

export async function updateStation(id, auth, sid, input) {
  await requirePin(id, auth);
  const patch = validateStationPatch(input);
  const names = Object.fromEntries(Object.keys(patch).map((k) => [`#${k}`, k]));
  const values = Object.fromEntries(Object.entries(patch).map(([k, v]) => [`:${k}`, v]));
  await db
    .send(
      new UpdateCommand({
        TableName: TABLE,
        Key: { PK: pk(id), SK: `STN#${sid}` },
        ConditionExpression: 'attribute_exists(SK)',
        UpdateExpression: `SET ${Object.keys(patch).map((k) => `#${k} = :${k}`).join(', ')}`,
        ExpressionAttributeNames: names,
        ExpressionAttributeValues: values,
      })
    )
    .catch(notFound('Station'));
  return { ok: true };
}

async function countItems(id, prefix) {
  const res = await db.send(
    new QueryCommand({
      TableName: TABLE,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :p)',
      ExpressionAttributeValues: { ':pk': pk(id), ':p': prefix },
      Select: 'COUNT',
    })
  );
  return res.Count;
}

export async function addStation(id, pin, input) {
  await requirePin(id, pin);
  const s = validateStation(input);
  if ((await countItems(id, 'STN#')) >= LIMITS.stations) throw new HttpError(400, `At most ${LIMITS.stations} stations.`);
  const sid = newId(6);
  await db.send(new PutCommand({ TableName: TABLE, Item: { PK: pk(id), SK: `STN#${sid}`, type: 'station', ...s, token: newToken(), order: Date.now(), jarsOnHand: 0, cupsOnHand: 0, stocked: false, createdAt: new Date().toISOString() } }));
  return { id: sid };
}

export async function removeStation(id, pin, sid) {
  await requirePin(id, pin);
  if ((await countItems(id, 'STN#')) <= 1) throw new HttpError(400, 'An event needs at least one station.');
  await db.send(new DeleteCommand({ TableName: TABLE, Key: { PK: pk(id), SK: `STN#${sid}` }, ConditionExpression: 'attribute_exists(PK)' })).catch(notFound('Station'));
  return { ok: true };
}

export async function addRunner(id, pin, input) {
  await requirePin(id, pin);
  const r = validateRunner(input);
  if ((await countItems(id, 'RUN#')) >= LIMITS.runners) throw new HttpError(400, `At most ${LIMITS.runners} runners.`);
  const rid = newId(6);
  await db.send(new PutCommand({ TableName: TABLE, Item: { PK: pk(id), SK: `RUN#${rid}`, type: 'runner', ...r, token: newToken(), order: Date.now(), status: 'free', createdAt: new Date().toISOString() } }));
  return { id: rid };
}

export async function removeRunner(id, pin, rid) {
  await requirePin(id, pin);
  await db.send(new DeleteCommand({ TableName: TABLE, Key: { PK: pk(id), SK: `RUN#${rid}` }, ConditionExpression: 'attribute_exists(PK)' })).catch(notFound('Runner'));
  return { ok: true };
}

const notFound = (what) => (err) => {
  if (err.name === 'ConditionalCheckFailedException') throw new HttpError(404, `${what} not found.`);
  throw err;
};
