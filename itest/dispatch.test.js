// Integration: runner dispatch against DynamoDB Local, local mode (no Step Functions).
// The state machine's steps (assign, timeouts) are called directly, the way Step Functions would.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handler } from '../src/api/handler.js';
import { handler as dispatcher } from '../src/api/dispatcher.js';
import { startDispatch } from '../src/lib/dispatch.js';
import { newTapId } from '../src/core/tap.js';

const call = async (method, path, body) => {
  const res = await handler({ rawPath: path, requestContext: { http: { method } }, headers: {}, body: body ? JSON.stringify(body) : undefined });
  return { status: res.statusCode, data: JSON.parse(res.body) };
};
const get = async (id) => (await call('GET', `/events/${id}`)).data;

async function setup(runnerNames = ['Asha', 'Ravi']) {
  const { data } = await call('POST', '/events', {
    name: 'Dispatch Fest',
    startsAt: new Date(Date.now() - 20 * 60000).toISOString(),
    attendees: 1000, startHour: 0, hourCount: 3, runnerTripMin: 10,
    litresPerPersonHr: { low: 0.25, high: 0.5 }, share: { Field: [1, 1, 1] },
    stations: [{ name: 'North', zone: 'Field' }, { name: 'South', zone: 'Field' }],
    runners: runnerNames.map((name) => ({ name })),
    pin: '2468',
  });
  const ev = await get(data.id);
  for (const s of ev.stations) await call('POST', `/events/${data.id}/stations/${s.id}/taps`, { uuid: newTapId(), type: 'stocked', jars: 20, cups: 500, deviceTs: new Date(Date.now() - 20 * 60000).toISOString() });
  return { id: data.id, sid: (n) => ev.stations.find((s) => s.name === n).id, rid: (n) => ev.runners.find((r) => r.name === n).id };
}
const lastJar = (id, sid) => call('POST', `/events/${id}/stations/${sid}/taps`, { uuid: newTapId(), type: 'last_jar', deviceTs: new Date().toISOString() });

test('"Last jar" opens a job and assigns the longest-free runner; the runner sees it', async () => {
  const { id, sid, rid } = await setup();
  await lastJar(id, sid('North'));
  const ev = await get(id);
  assert.equal(ev.jobs.length, 1);
  const job = ev.jobs[0];
  assert.equal(job.state, 'assigned');
  assert.equal(job.stationName, 'North');
  assert.equal(job.runnerName, 'Asha');
  assert.ok(job.jars >= 1);
  assert.equal(ev.stations.find((s) => s.name === 'North').openJobId, job.id);
  assert.equal(JSON.stringify(ev).includes('Token'), false, 'task tokens never leave the server');

  const view = (await call('GET', `/events/${id}/runners/${rid('Asha')}`)).data;
  assert.equal(view.job.id, job.id);
  assert.equal(view.runner.status, 'busy');
  assert.equal((await call('GET', `/events/${id}/runners/${rid('Ravi')}`)).data.job, null);
});

test('a second alert for the same station does not open a second job', async () => {
  const { id, sid } = await setup();
  await lastJar(id, sid('North'));
  await lastJar(id, sid('North'));
  assert.deepEqual(await startDispatch(id, sid('North'), 'running_dry'), { started: false, jobId: (await get(id)).jobs[0].id });
  assert.equal((await get(id)).jobs.length, 1);
});

test('two stations at once get two different runners', async () => {
  const { id, sid } = await setup();
  await Promise.all([lastJar(id, sid('North')), lastJar(id, sid('South'))]);
  const jobs = (await get(id)).jobs;
  assert.equal(jobs.length, 2);
  assert.deepEqual(jobs.map((j) => j.runnerName).sort(), ['Asha', 'Ravi']);
});

test('on my way -> delivered: station restocked, "Last jar" cleared, runner free again', async () => {
  const { id, sid, rid } = await setup();
  await lastJar(id, sid('North'));
  const job = (await get(id)).jobs[0];
  assert.equal((await call('POST', `/events/${id}/jobs/${job.id}/ack`, { runnerId: rid('Ravi') })).status, 403, 'only the assigned runner');
  assert.equal((await call('POST', `/events/${id}/jobs/${job.id}/ack`, { runnerId: rid('Asha') })).data.state, 'acked');
  assert.equal((await get(id)).jobs[0].state, 'acked');
  const d = await call('POST', `/events/${id}/jobs/${job.id}/done`, { runnerId: rid('Asha'), jars: 4, cups: 200 });
  assert.deepEqual(d.data, { state: 'done', jars: 4, cups: 200 });
  const ev = await get(id);
  const north = ev.stations.find((s) => s.name === 'North');
  assert.equal(north.openJobId, undefined);
  assert.equal(north.restocks.length, 1);
  assert.equal(north.restocks[0].jars, 4);
  assert.ok(north.lastRestockAt > north.lastJarAt, '"Last jar" is cleared by the restock');
  assert.equal(ev.runners.find((r) => r.name === 'Asha').status, 'free');
  assert.equal((await call('POST', `/events/${id}/jobs/${job.id}/done`, { runnerId: rid('Asha') })).data.state, 'done', 'repeat is harmless');
});

test('runner ignores the job: timeout frees them and the job goes to the other runner', async () => {
  const { id, sid } = await setup();
  await lastJar(id, sid('North'));
  const job = (await get(id)).jobs[0];
  assert.equal(job.runnerName, 'Asha');
  assert.deepEqual(await dispatcher({ action: 'ack_timeout', eventId: id, jobId: job.id }), { state: 'waiting', reassigned: true });
  assert.equal((await dispatcher({ action: 'assign', eventId: id, jobId: job.id })).assigned, true);
  const again = (await get(id)).jobs[0];
  assert.equal(again.runnerName, 'Ravi');
  assert.deepEqual(again.excluded, [job.runnerId]);
  assert.equal((await get(id)).runners.find((r) => r.name === 'Asha').status, 'free');
});

test('no free runner: assign keeps trying, then gives up and frees the station', async () => {
  const { id, sid } = await setup([]);
  await lastJar(id, sid('North'));
  const job = (await get(id)).jobs[0];
  assert.equal(job.state, 'waiting');
  let out;
  for (let i = 0; i < 25 && !out?.giveUp; i++) out = await dispatcher({ action: 'assign', eventId: id, jobId: job.id });
  assert.equal(out.giveUp, true);
  const ev = await get(id);
  assert.equal(ev.jobs[0].state, 'unassigned');
  assert.equal(ev.stations.find((s) => s.name === 'North').openJobId, undefined);
});

test('delivery never confirmed: job closed as stale, runner and station freed', async () => {
  const { id, sid, rid } = await setup();
  await lastJar(id, sid('North'));
  const job = (await get(id)).jobs[0];
  await call('POST', `/events/${id}/jobs/${job.id}/ack`, { runnerId: rid('Asha') });
  assert.deepEqual(await dispatcher({ action: 'done_timeout', eventId: id, jobId: job.id }), { state: 'stale' });
  const ev = await get(id);
  assert.equal(ev.jobs[0].state, 'stale');
  assert.equal(ev.runners.find((r) => r.name === 'Asha').status, 'free');
  assert.equal((await call('POST', `/events/${id}/jobs/${job.id}/done`, { runnerId: rid('Asha') })).status, 409);
});

test('task token is saved for the state machine and never shown', async () => {
  const { id, sid } = await setup();
  await lastJar(id, sid('North'));
  const job = (await get(id)).jobs[0];
  assert.deepEqual(await dispatcher({ action: 'wait_ack', eventId: id, jobId: job.id, token: 'test-token' }), { saved: true });
  assert.equal(JSON.stringify(await get(id)).includes('test-token'), false);
});
