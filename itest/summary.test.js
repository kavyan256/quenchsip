// Integration: the summary matches a hand count of what happened.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handler } from '../src/api/handler.js';
import { newTapId } from '../src/core/tap.js';

const call = async (method, path, body) => {
  const res = await handler({ rawPath: path, requestContext: { http: { method } }, headers: {}, body: body ? JSON.stringify(body) : undefined });
  return { status: res.statusCode, data: JSON.parse(res.body) };
};

test('summary: litres, bottles, stocked-before-start, runner jobs', async () => {
  const start = Date.now() - 30 * 60000;
  const { data } = await call('POST', '/events', {
    name: 'Summary Fest', startsAt: new Date(start).toISOString(), attendees: 200, startHour: 0, hourCount: 3,
    litresPerPersonHr: { low: 0.25, high: 0.5 }, share: { Field: [1, 1, 1] },
    stations: [{ name: 'A', zone: 'Field' }, { name: 'B', zone: 'Field' }], runners: [{ name: 'Asha' }], pin: '2468',
  });
  const id = data.id;
  const ev = (await call('GET', `/events/${id}`)).data;
  // Stations come back sorted by id, not creation order, so look them up by name.
  const a = ev.stations.find((x) => x.name === 'A');
  const b = ev.stations.find((x) => x.name === 'B');
  const tap = (sid, type, minAfterStart, extra = {}) =>
    call('POST', `/events/${id}/stations/${sid}/taps`, { uuid: newTapId(), type, deviceTs: new Date(start + minAfterStart * 60000).toISOString(), ...extra });

  await tap(a.id, 'stocked', -5, { jars: 6, cups: 300 }); // before the gates: counts
  await tap(b.id, 'stocked', 10, { jars: 6, cups: 300 }); // late
  for (const m of [5, 12, 19]) await tap(a.id, 'swap', m);
  await tap(b.id, 'swap', 15);
  await tap(a.id, 'last_jar', 20); // opens a job for Asha
  const job = (await call('GET', `/events/${id}`)).data.jobs[0];
  await call('POST', `/events/${id}/jobs/${job.id}/done`, { runnerId: ev.runners[0].id, jars: 4, cups: 0 });

  const s = (await call('GET', `/events/${id}/summary`)).data;
  assert.equal(s.water.swaps, 4);
  assert.equal(s.water.litres, 80);
  assert.equal(s.water.bottlesUpTo, 160);
  assert.equal(s.totals.stockedBeforeStart, 1);
  assert.equal(s.totals.taps, 7);
  assert.deepEqual([s.dispatch.jobs, s.dispatch.delivered, s.dispatch.jarsDelivered], [1, 1, 4]);
  assert.deepEqual(s.stations.map((r) => [r.name, r.swaps, r.restocks, r.jarsDelivered]).sort(), [['A', 3, 1, 4], ['B', 1, 0, 0]]);
  assert.equal((await call('GET', '/events/zzzzzzzz/summary')).status, 404);
});
