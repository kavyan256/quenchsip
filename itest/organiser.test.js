// Integration: quick create with an organiser key (no PIN), edits, default crowd split.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handler } from '../src/api/handler.js';

const call = async (method, path, body, headers = {}) => {
  const res = await handler({ rawPath: path, requestContext: { http: { method } }, headers, body: body ? JSON.stringify(body) : undefined });
  return { status: res.statusCode, data: JSON.parse(res.body) };
};
const quick = () => ({
  name: 'Quick Fest', attendees: 2000, hourCount: 2, startHour: 17, startsAt: new Date(Date.now() + 3600000).toISOString(),
  stations: [{ name: 'Station 1' }, { name: 'Station 2' }, { name: 'Station 3' }, { name: 'Station 4' }], runners: [{ name: 'Runner 1' }],
});

test('quick create returns an organiser key; no PIN needed; no hashes leak', async () => {
  const r = await call('POST', '/events', quick());
  assert.equal(r.status, 201);
  assert.match(r.data.key, /^[a-z0-9]{24}$/);
  const ev = (await call('GET', `/events/${r.data.id}`)).data;
  assert.equal(JSON.stringify(ev).includes('Hash'), false);
  assert.deepEqual(ev.event.setup, { ordered: false, linksShared: false });
  assert.deepEqual(ev.warnings, [], 'readiness not asked = no warnings');
  // 2000 people x 0.5 L x 2 h = 2000 L = 100 jars (high), split evenly over 4 stations
  assert.equal(ev.plan.total.litresHigh, 2000);
  assert.deepEqual(ev.plan.rows.map((x) => x.total.litresHigh), [500, 500, 500, 500]);
});

test('organiser key allows edits; a wrong key or none is refused', async () => {
  const { data } = await call('POST', '/events', quick());
  const key = { 'x-organiser-key': data.key };
  const ev = (await call('GET', `/events/${data.id}`)).data;
  const sid = ev.stations[1].id;

  assert.equal((await call('PATCH', `/events/${data.id}/stations/${sid}`, { name: 'Stage left', busy: true }, { 'x-organiser-key': 'wrongwrongwrongwrongwron' })).status, 403);
  assert.equal((await call('PATCH', `/events/${data.id}/stations/${sid}`, { name: 'Stage left', busy: true })).status, 403);
  assert.equal((await call('PATCH', `/events/${data.id}/stations/${sid}`, { name: 'Stage left', busy: true }, key)).status, 200);

  const after = (await call('GET', `/events/${data.id}`)).data;
  const stage = after.stations.find((s) => s.id === sid);
  assert.deepEqual([stage.name, stage.busy], ['Stage left', true]);
  // Busy spot doubles its share: 2 / (1 + 2 + 1 + 1) of 2000 L = 800 L
  assert.equal(after.plan.rows.find((r) => r.stationId === sid).total.litresHigh, 800);

  assert.equal((await call('PATCH', `/events/${data.id}`, { runnerTripMin: 6, setup: { ordered: true } }, key)).status, 200);
  const e2 = (await call('GET', `/events/${data.id}`)).data.event;
  assert.equal(e2.runnerTripMin, 6);
  assert.deepEqual(e2.setup, { ordered: true, linksShared: false });

  assert.equal((await call('POST', `/events/${data.id}/stations`, { name: 'Exit gate' }, key)).status, 201);
  assert.equal((await call('POST', `/events/${data.id}/runners`, { name: 'Ravi' }, key)).status, 201);
  assert.equal((await call('PATCH', `/events/${data.id}/stations/zzzzzz`, { busy: true }, key)).status, 404);
  assert.equal((await call('PATCH', `/events/${data.id}`, {}, key)).status, 400);
});

test('older events with a PIN still work', async () => {
  const { data } = await call('POST', '/events', { ...quick(), pin: '2468' });
  assert.equal((await call('POST', `/events/${data.id}/runners`, { name: 'Ravi' }, { 'x-organiser-pin': '2468' })).status, 201);
  assert.equal((await call('POST', `/events/${data.id}/runners`, { name: 'Ravi' }, { 'x-organiser-pin': '1111' })).status, 403);
});
