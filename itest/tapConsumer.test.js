// Integration: the SQS consumer writes taps, drops ones that can never work, retries the rest.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handler } from '../src/api/handler.js';
import { handler as consumer } from '../src/api/tapConsumer.js';
import { newTapId } from '../src/core/tap.js';

const call = async (method, path, body) => {
  const res = await handler({ rawPath: path, requestContext: { http: { method } }, headers: {}, body: body ? JSON.stringify(body) : undefined });
  return JSON.parse(res.body);
};
const record = (id, eventId, stationId, tap) => ({ messageId: id, body: JSON.stringify({ eventId, stationId, tap }) });

test('queued taps are written once; bad ones are dropped, not retried', async () => {
  const { id } = await call('POST', '/events', {
    name: 'Queue Fest', attendees: 100, startHour: 0, hourCount: 1, litresPerPersonHr: { low: 0.25, high: 0.5 },
    share: { F: [1] }, stations: [{ name: 'A', zone: 'F' }], pin: '2468',
  });
  const sid = (await call('GET', `/events/${id}`)).stations[0].id;
  const uuid = newTapId();
  const swap = { uuid, type: 'swap', deviceTs: new Date().toISOString() };
  const out = await consumer({
    Records: [
      record('m1', id, sid, swap),
      record('m2', id, sid, swap), // SQS can deliver a message twice
      record('m3', id, 'zzzzzz', { uuid: newTapId(), type: 'swap' }), // station removed: drop
      record('m4', id, sid, { uuid: 'bad', type: 'swap' }), // invalid: drop
      { messageId: 'm5', body: '{not json' }, // drop
    ],
  });
  assert.deepEqual(out, { batchItemFailures: [] });
  assert.equal((await call('GET', `/events/${id}`)).stations[0].swapCount, 1);
});
