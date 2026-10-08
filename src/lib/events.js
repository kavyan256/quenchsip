// Event storage: one DynamoDB partition per event.
//   PK EVT#<id>  SK META        event settings + organiser PIN hash
//   PK EVT#<id>  SK STN#<sid>   station
//   PK EVT#<id>  SK RUN#<rid>   runner
//   PK EVT#<id>  SK TAP#<uuid>  volunteer tap (see taps.js); sorts after the others
//   PK EVENTS    SK <startsAt>#<id>  index of events by start time (for the scheduled projector)
import { GetCommand, QueryCommand, TransactWriteCommand, PutCommand, DeleteCommand } from '@aws-sdk/lib-dynamodb';
import { db, TABLE } from './db.js';
import { hashPin, verifyPin, newId } from './pin.js';
import { validateEvent, validatePin, validateStation, validateRunner, hourLabels, LIMITS } from '../core/event.js';
import { planEvent, readiness } from '../core/plan.js';

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const pk = (id) => `EVT#${id}`;

export async function createEvent(input) {
  const ev = validateEvent(input);
  const pin = validatePin(input?.pin);
  const id = newId();
  const now = new Date().toISOString();
  const { stations, runners, ...settings } = ev;

  const items = [
    { PK: pk(id), SK: 'META', type: 'event', id, ...settings, pinHash: hashPin(pin), createdAt: now },
    // Index of events by start time, so the scheduled projector finds live events without a table scan.
    ...(settings.startsAt
      ? [{ PK: 'EVENTS', SK: `${settings.startsAt}#${id}`, type: 'event-index', id, endsAt: new Date(Date.parse(settings.startsAt) + settings.hourCount * 3600000).toISOString() }]
      : []),
    ...stations.map((s) => ({ PK: pk(id), SK: `STN#${newId(6)}`, type: 'station', ...s, jarsOnHand: 0, cupsOnHand: 0, stocked: false, createdAt: now })),
    ...runners.map((r) => ({ PK: pk(id), SK: `RUN#${newId(6)}`, type: 'runner', ...r, status: 'free', createdAt: now })),
  ];
  await db.send(
    new TransactWriteCommand({
      TransactItems: items.map((Item, i) => ({
        Put: { TableName: TABLE, Item, ...(i === 0 ? { ConditionExpression: 'attribute_not_exists(PK)' } : {}) },
      })),
    })
  );
  return { id };
}

// Public view: no PIN hash. The plan is worked out on read, so it always matches the current stations.
export async function getEvent(id) {
  // SK < "TAP#" reads META, RUN# and STN# items but skips the (many) taps.
  const res = await db.send(
    new QueryCommand({ TableName: TABLE, KeyConditionExpression: 'PK = :pk AND SK < :taps', ExpressionAttributeValues: { ':pk': pk(id), ':taps': 'TAP#' } })
  );
  const meta = res.Items.find((x) => x.SK === 'META');
  if (!meta) throw new HttpError(404, 'Event not found.');
  const { PK, SK, pinHash, type, ...event } = meta;
  const stations = res.Items.filter((x) => x.type === 'station').map(({ PK, SK, type, ...s }) => ({ id: SK.slice(4), ...s }));
  const runners = res.Items.filter((x) => x.type === 'runner').map(({ PK, SK, type, ...r }) => ({ id: SK.slice(4), ...r }));

  const hours = hourLabels(event.startHour, event.hourCount);
  const plan = planEvent({ attendees: event.attendees, hours, stations, share: event.share, litresPerPersonHr: event.litresPerPersonHr, heatFactor: event.heatFactor });
  const ready = readiness({ attendees: event.attendees, stationCount: stations.length, volunteerCount: event.volunteerCount, jarSupplier: event.jarSupplier, signal: event.signal });
  const zonesWithoutShare = [...new Set(stations.map((s) => s.zone))].filter((z) => !event.share[z]);
  const warnings = [
    ...ready.warnings,
    ...plan.warnings,
    ...zonesWithoutShare.map((z) => `Zone "${z}" has no crowd share, so its stations are planned at 0 jars.`),
  ];
  return { event, hours, stations, runners, plan: { rows: plan.rows.map((r) => ({ stationId: r.station.id, byHour: r.byHour, total: r.total })), total: plan.total }, warnings };
}

async function requirePin(id, pin) {
  const res = await db.send(new GetCommand({ TableName: TABLE, Key: { PK: pk(id), SK: 'META' } }));
  if (!res.Item) throw new HttpError(404, 'Event not found.');
  if (!verifyPin(pin ?? '', res.Item.pinHash)) throw new HttpError(403, 'Wrong organiser PIN.');
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
  await db.send(new PutCommand({ TableName: TABLE, Item: { PK: pk(id), SK: `STN#${sid}`, type: 'station', ...s, jarsOnHand: 0, cupsOnHand: 0, stocked: false, createdAt: new Date().toISOString() } }));
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
  await db.send(new PutCommand({ TableName: TABLE, Item: { PK: pk(id), SK: `RUN#${rid}`, type: 'runner', ...r, status: 'free', createdAt: new Date().toISOString() } }));
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
