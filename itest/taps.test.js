// Integration tests for taps (BUILD-PLAN I1, I2). Needs DynamoDB Local + table.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handler } from '../src/api/handler.js';
import { linkHeaders } from './link.js';
import { newTapId } from '../src/core/tap.js';

const call = async (method, path, body) => {
  const res = await handler({ rawPath: path, requestContext: { http: { method } }, headers: await linkHeaders(method, path, body), body: body ? JSON.stringify(body) : undefined });
  return { status: res.statusCode, data: JSON.parse(res.body) };
};

async function setup() {
  const { data } = await call('POST', '/events', {
    name: 'Tap Fest',
    attendees: 1000,
    startHour: 18,
    hourCount: 1,
    litresPerPersonHr: { low: 0.3, high: 0.3 },
    share: { Gate: [1] },
    stations: [
      { name: 'Gate A', zone: 'Gate' },
      { name: 'Gate B', zone: 'Gate' },
    ],
    pin: '2468',
  });
  const ev = await call('GET', `/events/${data.id}`);
  return { id: data.id, stations: ev.data.stations };
}

const station = async (id, sid) => (await call('GET', `/events/${id}`)).data.stations.find((s) => s.id === sid);
const tap = (id, sid, type = 'swap', uuid = newTapId()) => call('POST', `/events/${id}/stations/${sid}/taps`, { uuid, type, deviceTs: new Date().toISOString() });

test('I1: the same tap sent 5 times is stored and counted once', async () => {
  const { id, stations } = await setup();
  const uuid = newTapId();
  const results = [];
  for (let i = 0; i < 5; i++) results.push(await tap(id, stations[0].id, 'swap', uuid));
  assert.deepEqual(results.map((r) => r.status), [201, 200, 200, 200, 200]);
  assert.deepEqual(results.map((r) => r.data.duplicate), [false, true, true, true, true]);
  const s = await station(id, stations[0].id);
  assert.equal(s.swapCount, 1);
  assert.equal(s.swapTimes.length, 1);
});

test('I2: 20 taps from 2 phones at once give exact counts', async () => {
  const { id, stations } = await setup();
  const [a, b] = stations;
  // Phone 1: 10 swaps at A. Phone 2: 6 swaps + 4 cups-low at B. All at the same time.
  await Promise.all([
    ...Array.from({ length: 10 }, () => tap(id, a.id, 'swap')),
    ...Array.from({ length: 6 }, () => tap(id, b.id, 'swap')),
    ...Array.from({ length: 4 }, () => tap(id, b.id, 'cups_low')),
  ]);
  const sa = await station(id, a.id);
  const sb = await station(id, b.id);
  assert.equal(sa.swapCount, 10);
  assert.equal(sa.swapTimes.length, 10);
  assert.equal(sb.swapCount, 6);
  assert.equal(sb.cupsLowCount, 4);
});

test('concurrent retries of one tap still count once', async () => {
  const { id, stations } = await setup();
  const uuid = newTapId();
  const results = await Promise.all(Array.from({ length: 8 }, () => tap(id, stations[0].id, 'last_jar', uuid)));
  assert.equal(results.filter((r) => r.data.duplicate === false).length, 1);
  assert.equal((await station(id, stations[0].id)).lastJarCount, 1);
});

test('tap updates last-tap times', async () => {
  const { id, stations } = await setup();
  await tap(id, stations[0].id, 'last_jar');
  const s = await station(id, stations[0].id);
  assert.ok(s.lastJarAt && s.lastTapAt);
  assert.equal(s.swapCount, undefined);
});

test('unknown station gives 404; bad tap gives 400; taps are not returned with the event', async () => {
  const { id, stations } = await setup();
  assert.equal((await tap(id, 'zzzzzz')).status, 404);
  assert.equal((await tap(id, stations[0].id, 'refill')).status, 400);
  assert.equal((await call('POST', `/events/${id}/stations/${stations[0].id}/taps`, { type: 'swap' })).status, 400);
  await tap(id, stations[0].id);
  const ev = await call('GET', `/events/${id}`);
  assert.equal(JSON.stringify(ev.data).includes('TAP#'), false);
});

test('stocked tap saves the counts; a recount replaces them; a retry counts once', async () => {
  const { id, stations } = await setup();
  const sid = stations[0].id;
  const uuid = newTapId();
  const stock = (jars, cups, tapId = newTapId()) => call('POST', `/events/${id}/stations/${sid}/taps`, { uuid: tapId, type: 'stocked', jars, cups, deviceTs: new Date().toISOString() });
  assert.equal((await stock(6, 400, uuid)).status, 201);
  assert.equal((await stock(6, 400, uuid)).status, 200);
  let s = await station(id, sid);
  assert.deepEqual([s.stocked, s.stockedJars, s.stockedCups, s.stockCount], [true, 6, 400, 1]);
  assert.ok(s.stockedAt && s.lastTapAt);

  await stock(8, 350);
  s = await station(id, sid);
  assert.deepEqual([s.stockedJars, s.stockedCups, s.stockCount], [8, 350, 2]);
  assert.equal((await stock(-1, 10)).status, 400);
  assert.equal(stations[1].stocked, false, 'other stations start not stocked');
});

test('taps that arrive out of order (SQS does not keep order) never move the station back in time', async () => {
  const { id, stations } = await setup();
  const sid = stations[0].id;
  const at = (minAgo) => new Date(Date.now() - minAgo * 60000).toISOString();
  const send = (body) => call('POST', `/events/${id}/stations/${sid}/taps`, { uuid: newTapId(), ...body });
  // The newer recount and "cups low" arrive first, the older ones after.
  await send({ type: 'stocked', jars: 9, cups: 300, deviceTs: at(5) });
  await send({ type: 'cups_low', deviceTs: at(2) });
  await send({ type: 'stocked', jars: 3, cups: 100, deviceTs: at(20) });
  await send({ type: 'cups_low', deviceTs: at(15) });
  const s = await station(id, sid);
  assert.equal(s.stockedJars, 9, 'the newer count wins');
  assert.equal(s.stockedCups, 300);
  assert.ok(Date.parse(s.stockedAt) > Date.parse(at(6)), 'stockedAt is the newer count');
  assert.ok(Date.parse(s.cupsLowAt) > Date.parse(at(3)), 'cupsLowAt stays on the newer tap');
  assert.ok(Date.parse(s.lastTapAt) > Date.parse(at(3)), 'lastTapAt stays on the newest tap');
  assert.equal(s.stockCount, 2, 'both taps still counted');
});

test('every item gets a TTL: 90 days after the event ends (taps: after they happened)', async () => {
  const { data } = await call('POST', '/events', {
    name: 'TTL Fest', startsAt: '2026-11-01T10:00:00.000Z', attendees: 500, startHour: 10, hourCount: 3,
    litresPerPersonHr: { low: 0.25, high: 0.5 }, stations: [{ name: 'Gate' }], pin: '2468',
  });
  const { GetCommand, QueryCommand } = await import('@aws-sdk/lib-dynamodb');
  const { db, TABLE } = await import('../src/lib/db.js');
  const items = (await db.send(new QueryCommand({ TableName: TABLE, KeyConditionExpression: 'PK = :p', ExpressionAttributeValues: { ':p': `EVT#${data.id}` } }))).Items;
  const end = Date.parse('2026-11-01T13:00:00.000Z') / 1000;
  for (const it of items) assert.equal(it.expiresAt, end + 90 * 86400, `${it.SK} expires 90 days after the event ends`);
  const index = (await db.send(new GetCommand({ TableName: TABLE, Key: { PK: 'EVENTS', SK: `2026-11-01T10:00:00.000Z#${data.id}` } }))).Item;
  assert.equal(index.expiresAt, end + 86400, 'the live-events index entry goes a day after the end');
  const sid = items.find((x) => x.type === 'station').SK.slice(4);
  const at = new Date().toISOString();
  await call('POST', `/events/${data.id}/stations/${sid}/taps`, { uuid: newTapId(), type: 'swap', deviceTs: at });
  const tap = (await db.send(new QueryCommand({ TableName: TABLE, KeyConditionExpression: 'PK = :p AND begins_with(SK, :t)', ExpressionAttributeValues: { ':p': `EVT#${data.id}`, ':t': 'TAP#' } }))).Items[0];
  assert.ok(Math.abs(tap.expiresAt - (Math.floor(Date.parse(tap.tappedAt) / 1000) + 90 * 86400)) <= 1, 'tap expires 90 days after it happened');
});
