// Integration tests: Lambda handler against DynamoDB Local.
// Needs: npm run db:start && npm run db:table, then npm run test:int
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handler } from '../src/api/handler.js';
import { linkHeaders } from './link.js';

const call = async (method, path, body, pin) => {
  const res = await handler({
    rawPath: path,
    requestContext: { http: { method } },
    headers: { ...(await linkHeaders(method, path, body)), ...(pin ? { 'X-Organiser-Pin': pin } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.statusCode, data: JSON.parse(res.body) };
};

const newEvent = () => ({
  name: 'Test Fest',
  attendees: 1000,
  startHour: 18,
  hourCount: 1,
  litresPerPersonHr: { low: 0.3, high: 0.3 },
  share: { Gate: [1] },
  stations: [{ name: 'Main gate', zone: 'Gate' }],
  runners: [{ name: 'Asha' }],
  pin: '2468',
});

test('health', async () => {
  const r = await call('GET', '/health');
  assert.equal(r.status, 200);
  assert.equal(r.data.ok, true);
});

test('paths forwarded by CloudFront under /api reach the same routes', async () => {
  assert.equal((await call('GET', '/api/health')).data.ok, true);
  const created = await call('POST', '/api/events', newEvent());
  assert.equal(created.status, 201);
  assert.equal((await call('GET', `/api/events/${created.data.id}`)).data.event.name, 'Test Fest');
  assert.equal((await call('GET', '/apifoo/health')).status, 404, 'only a whole /api segment is dropped');
});

test('create and read an event; plan matches U1; no PIN hash leaks', async () => {
  const created = await call('POST', '/events', newEvent());
  assert.equal(created.status, 201);
  const r = await call('GET', `/events/${created.data.id}`);
  assert.equal(r.status, 200);
  assert.equal(r.data.event.name, 'Test Fest');
  assert.equal(r.data.stations.length, 1);
  assert.equal(r.data.runners.length, 1);
  assert.equal(r.data.plan.total.jarsHigh, 15);
  assert.equal(r.data.plan.total.cupsHigh, 1500);
  assert.equal(JSON.stringify(r.data).includes('pinHash'), false);
});

test('I6: wrong or missing PIN gets 403 and changes nothing', async () => {
  const { data } = await call('POST', '/events', newEvent());
  assert.equal((await call('POST', `/events/${data.id}/stations`, { name: 'Food', zone: 'Gate' }, '1111')).status, 403);
  assert.equal((await call('POST', `/events/${data.id}/stations`, { name: 'Food', zone: 'Gate' })).status, 403);
  const r = await call('GET', `/events/${data.id}`);
  assert.equal(r.data.stations.length, 1);
});

test('add and remove stations and runners with the right PIN; plan updates', async () => {
  const { data } = await call('POST', '/events', newEvent());
  const added = await call('POST', `/events/${data.id}/stations`, { name: 'Gate 2', zone: 'Gate' }, '2468');
  assert.equal(added.status, 201);
  let r = await call('GET', `/events/${data.id}`);
  assert.equal(r.data.stations.length, 2);
  // Two stations in one zone now share the 300 L.
  assert.deepEqual(r.data.plan.rows.map((x) => x.total.litresHigh).sort(), [150, 150]);

  const runner = await call('POST', `/events/${data.id}/runners`, { name: 'Ravi' }, '2468');
  assert.equal(runner.status, 201);
  assert.equal((await call('DELETE', `/events/${data.id}/runners/${runner.data.id}`, null, '2468')).status, 200);

  assert.equal((await call('DELETE', `/events/${data.id}/stations/${added.data.id}`, null, '2468')).status, 200);
  r = await call('GET', `/events/${data.id}`);
  assert.equal(r.data.stations.length, 1);
  assert.equal(r.data.runners.length, 1);
});

test('cannot remove the last station; unknown ids give 404', async () => {
  const { data } = await call('POST', '/events', newEvent());
  const r = await call('GET', `/events/${data.id}`);
  assert.equal((await call('DELETE', `/events/${data.id}/stations/${r.data.stations[0].id}`, null, '2468')).status, 400);
  assert.equal((await call('GET', '/events/zzzzzzzz')).status, 404);
  assert.equal((await call('DELETE', `/events/${data.id}/runners/zzzzzz`, null, '2468')).status, 404);
});

test('new zone without crowd share gives a warning', async () => {
  const { data } = await call('POST', '/events', newEvent());
  await call('POST', `/events/${data.id}/stations`, { name: 'Food court', zone: 'Food' }, '2468');
  const r = await call('GET', `/events/${data.id}`);
  assert.ok(r.data.warnings.some((w) => w.includes('Zone "Food" has no crowd share')));
});

test('event start time is stored and returned; a bad one is rejected', async () => {
  const startsAt = '2026-10-10T11:30:00.000Z';
  const { data } = await call('POST', '/events', { ...newEvent(), startsAt });
  assert.equal((await call('GET', `/events/${data.id}`)).data.event.startsAt, startsAt);
  assert.equal((await call('POST', '/events', { ...newEvent(), startsAt: 'tomorrow-ish' })).status, 400);
});

test('bad input gives 400 with a plain message', async () => {
  const r = await call('POST', '/events', { ...newEvent(), pin: '12' });
  assert.equal(r.status, 400);
  assert.match(r.data.error, /PIN/);
  const bad = await handler({ rawPath: '/events', requestContext: { http: { method: 'POST' } }, headers: {}, body: '{oops' });
  assert.equal(bad.statusCode, 400);
});
