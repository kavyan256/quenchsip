// Volunteer and runner links: ids are public, the token in each QR link is the access.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PutCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { handler } from '../src/api/handler.js';
import { db, TABLE } from '../src/lib/db.js';
import { newTapId } from '../src/core/tap.js';
import { organiserToken } from './link.js';

const call = async (method, path, body, headers = {}) => {
  const res = await handler({ rawPath: path, requestContext: { http: { method } }, headers, body: body ? JSON.stringify(body) : undefined });
  return { status: res.statusCode, data: JSON.parse(res.body) };
};
const tap = (id, sid, token, type = 'swap') =>
  call('POST', `/events/${id}/stations/${sid}/taps`, { uuid: newTapId(), type, deviceTs: new Date().toISOString() }, token === undefined ? {} : { 'x-access-token': token });

async function setup() {
  const { data } = await call('POST', '/events', {
    name: 'Link Fest', attendees: 1000, startHour: 0, hourCount: 3, startsAt: new Date(Date.now() - 20 * 60000).toISOString(),
    stations: [{ name: 'Gate' }, { name: 'Stage' }], runners: [{ name: 'Asha' }, { name: 'Ravi' }],
  }, { authorization: `Bearer ${organiserToken(`links-${Math.random().toString(36).slice(2)}@quench.test`)}` });
  const org = (await call('GET', `/events/${data.id}`, undefined, { 'x-organiser-key': data.key })).data;
  return { id: data.id, key: data.key, org };
}

test('public view has no link tokens; the organiser view has one per station and runner', async () => {
  const { id, org } = await setup();
  const pub = (await call('GET', `/events/${id}`)).data;
  assert.ok([...pub.stations, ...pub.runners].every((x) => !('token' in x)), 'ids are public, tokens are not');
  assert.ok([...org.stations, ...org.runners].every((x) => /^[a-z0-9]{16}$/.test(x.token)));
  assert.equal(new Set([...org.stations, ...org.runners].map((x) => x.token)).size, 4, 'every link has its own token');
  const wrongKey = (await call('GET', `/events/${id}`, undefined, { 'x-organiser-key': 'not-the-key' })).data;
  assert.ok(wrongKey.stations.every((x) => !('token' in x)), 'a wrong key just gets the public view');
});

test('taps need the station token: missing or wrong is refused, the right one is accepted', async () => {
  const { id, org } = await setup();
  const [gate, stage] = org.stations;
  assert.equal((await tap(id, gate.id)).status, 403, 'id alone');
  assert.equal((await tap(id, gate.id, 'aaaaaaaaaaaaaaaa')).status, 403, 'wrong token');
  assert.equal((await tap(id, gate.id, stage.token)).status, 403, "another station's token");
  const bad = await tap(id, gate.id);
  assert.match(bad.data.error, /not valid/);
  assert.equal((await tap(id, gate.id, gate.token)).status, 201);
  assert.equal((await call('GET', `/events/${id}/stations/${gate.id}/link`, undefined, { 'x-access-token': gate.token })).data.ok, true);
  assert.equal((await call('GET', `/events/${id}/stations/${gate.id}/link`)).status, 403);
  assert.equal((await tap(id, 'zzzzzz', gate.token)).status, 404, 'unknown station');
});

test('runner page, "On my way" and "Delivered" need the runner token', async () => {
  const { id, org } = await setup();
  const tokenOf = (name) => org.runners.find((r) => r.name === name).token;
  const ridOf = (name) => org.runners.find((r) => r.name === name).id;
  // Stock both, then Gate's last jar opens a job for a free runner.
  for (const s of org.stations) await call('POST', `/events/${id}/stations/${s.id}/taps`, { uuid: newTapId(), type: 'stocked', jars: 20, cups: 500, deviceTs: new Date().toISOString() }, { 'x-access-token': s.token });
  await tap(id, org.stations[0].id, org.stations[0].token, 'last_jar');
  const job = (await call('GET', `/events/${id}`)).data.jobs[0];
  assert.ok(job?.runnerId, 'job assigned');
  const name = org.runners.find((r) => r.id === job.runnerId).name;
  const other = name === 'Asha' ? 'Ravi' : 'Asha';

  assert.equal((await call('GET', `/events/${id}/runners/${ridOf(name)}`)).status, 403, 'runner page without token');
  assert.equal((await call('GET', `/events/${id}/runners/${ridOf(name)}`, undefined, { 'x-access-token': tokenOf(name) })).data.job.id, job.id);

  const ack = (runnerId, token) => call('POST', `/events/${id}/jobs/${job.id}/ack`, { runnerId }, token ? { 'x-access-token': token } : {});
  assert.equal((await ack(ridOf(name))).status, 403, 'public runner id alone cannot ack');
  assert.equal((await ack(ridOf(name), tokenOf(other))).status, 403, "another runner's token");
  assert.equal((await ack(ridOf(other), tokenOf(other))).status, 403, 'a real runner, but not their job');
  assert.equal((await ack(ridOf(name), tokenOf(name))).data.state, 'acked');

  const done = (token) => call('POST', `/events/${id}/jobs/${job.id}/done`, { runnerId: ridOf(name), jars: 4 }, token ? { 'x-access-token': token } : {});
  assert.equal((await done()).status, 403, 'a fake "Delivered" is refused');
  assert.equal((await done(tokenOf(name))).data.state, 'done');
});

test('stations and runners added later get tokens too', async () => {
  const { id, key } = await setup();
  const k = { 'x-organiser-key': key };
  const s = (await call('POST', `/events/${id}/stations`, { name: 'Food' }, k)).data.id;
  const r = (await call('POST', `/events/${id}/runners`, { name: 'Meera' }, k)).data.id;
  const org = (await call('GET', `/events/${id}`, undefined, k)).data;
  assert.match(org.stations.find((x) => x.id === s).token, /^[a-z0-9]{16}$/);
  assert.match(org.runners.find((x) => x.id === r).token, /^[a-z0-9]{16}$/);
  assert.equal((await tap(id, s)).status, 403);
});

test('older stations and runners without a token keep working (printed links do not break)', async () => {
  const { id, org } = await setup();
  const gate = org.stations[0];
  await db.send(new UpdateCommand({ TableName: TABLE, Key: { PK: `EVT#${id}`, SK: `STN#${gate.id}` }, UpdateExpression: 'REMOVE #t', ExpressionAttributeNames: { '#t': 'token' } }));
  assert.equal((await tap(id, gate.id)).status, 201);
  await db.send(new PutCommand({ TableName: TABLE, Item: { PK: `EVT#${id}`, SK: 'RUN#old111', type: 'runner', name: 'Old', status: 'free', order: 9 } }));
  assert.equal((await call('GET', `/events/${id}/runners/old111`)).status, 200);
});
