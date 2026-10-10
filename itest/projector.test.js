// Integration test: scheduled projector against DynamoDB Local.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handler } from '../src/api/handler.js';
import { linkHeaders } from './link.js';
import { liveEventIds, runProjection } from '../src/lib/projector.js';
import { newTapId } from '../src/core/tap.js';

const call = async (method, path, body) => {
  const res = await handler({ rawPath: path, requestContext: { http: { method } }, headers: await linkHeaders(method, path, body), body: body ? JSON.stringify(body) : undefined });
  return JSON.parse(res.body);
};
const minAgo = (m, now) => new Date(now - m * 60000).toISOString();

async function liveEvent(now, startedMinAgo = 30) {
  const { id } = await call('POST', '/events', {
    name: 'Projector Fest',
    startsAt: minAgo(startedMinAgo, now),
    attendees: 1000,
    startHour: 0,
    hourCount: 3,
    runnerTripMin: 10,
    litresPerPersonHr: { low: 0.25, high: 0.5 },
    share: { Field: [1, 1, 1] },
    stations: [{ name: 'Busy', zone: 'Field' }, { name: 'Silent', zone: 'Field' }],
    pin: '2468',
  });
  const { stations } = await call('GET', `/events/${id}`);
  const sid = (name) => stations.find((s) => s.name === name).id;
  // Volunteers confirm stock as the event starts: 20 jars lasts ~96 min at the plan's busy rate (4.8 min per jar).
  for (const s of stations) {
    await call('POST', `/events/${id}/stations/${s.id}/taps`, { uuid: newTapId(), type: 'stocked', jars: 20, cups: 500, deviceTs: minAgo(startedMinAgo, now) });
  }
  return { id, sid };
}

const tap = (id, sid, type, deviceTs) => call('POST', `/events/${id}/stations/${sid}/taps`, { uuid: newTapId(), type, deviceTs });

test('only live events are projected', async () => {
  const now = Date.now();
  const live = await liveEvent(now);
  const future = await liveEvent(now, -60); // starts in an hour
  const ids = await liveEventIds(now);
  assert.ok(ids.includes(live.id));
  assert.ok(!ids.includes(future.id));
});

test('projector saves dry time, raises an alert once, flags the silent station', async () => {
  const now = Date.now();
  const { id, sid } = await liveEvent(now);
  // Busy: swaps 10 min apart, then "Last jar" -> 1 jar left, dry 10 min after the last swap (5 min from now).
  for (const m of [25, 15, 5]) await tap(id, sid('Busy'), 'swap', minAgo(m, now));
  await tap(id, sid('Busy'), 'last_jar', minAgo(4, now));

  const first = (await runProjection(now)).results.find((r) => r.eventId === id);
  assert.deepEqual(first.newAlerts.map((a) => a.station), ['Busy']);
  assert.equal(first.newAlerts[0].minutesToDry, 5);
  assert.deepEqual(first.quiet, ['Silent']); // 500 people, ~9.6 min per jar -> quiet after 14 min; silent 30

  const { stations } = await call('GET', `/events/${id}`);
  const busy = stations.find((s) => s.name === 'Busy');
  assert.equal(busy.projection.status, 'needs_jars');
  assert.equal(busy.projection.intervalMin, 10);
  assert.equal(busy.projection.intervalSource, 'measured');
  assert.equal(busy.projection.jarsLeft, 1);
  assert.equal(busy.projection.dryAt, minAgo(-5, now));
  assert.ok(busy.alertSince);
  assert.equal(stations.find((s) => s.name === 'Silent').projection.status, 'quiet');

  // Two minutes later: still alerting, but not a *new* alert, and alertSince is kept.
  const second = (await runProjection(now + 120000)).results.find((r) => r.eventId === id);
  assert.deepEqual(second.newAlerts, []);
  const again = (await call('GET', `/events/${id}`)).stations.find((s) => s.name === 'Busy');
  assert.equal(again.alertSince, busy.alertSince);
  assert.equal(again.projection.minutesToDry, 3);
});

test('a removed station does not break the run', async () => {
  const now = Date.now();
  const { id, sid } = await liveEvent(now);
  const res = await handler({ rawPath: `/events/${id}/stations/${sid('Silent')}`, requestContext: { http: { method: 'DELETE' } }, headers: { 'x-organiser-pin': '2468' } });
  assert.equal(res.statusCode, 200);
  const out = await runProjection(now);
  const mine = out.results.find((r) => r.eventId === id);
  assert.equal(mine.error, undefined);
  assert.equal(mine.stations, 1);
});
