import { test } from 'node:test';
import assert from 'node:assert/strict';
import { jarsToSend, pickRunner, dispatchDecision, median, jobLine, MAX_JARS_PER_TRIP } from '../src/core/dispatch.js';

test('jars to send: about an hour at the station rate, minus what is left, 1 to max', () => {
  assert.equal(jarsToSend({ intervalMin: 15, jarsLeft: 1 }), 3); // 4 per hour - 1
  assert.equal(jarsToSend({ intervalMin: 30, jarsLeft: 5 }), 1, 'at least one');
  assert.equal(jarsToSend({ intervalMin: 5, jarsLeft: 0 }), MAX_JARS_PER_TRIP, 'one runner can only carry so much');
  assert.equal(jarsToSend({ intervalMin: null, jarsLeft: null }), 2, 'no rate known: 2');
});

test('pick the free runner who has waited longest, skipping ones already tried', () => {
  const runners = [
    { id: 'a', status: 'busy', freeSince: '2026-10-10T10:00:00Z' },
    { id: 'b', status: 'free', freeSince: '2026-10-10T10:20:00Z' },
    { id: 'c', status: 'free', freeSince: '2026-10-10T10:05:00Z' },
    { id: 'd', status: 'free', createdAt: '2026-10-10T09:00:00Z' },
  ];
  assert.equal(pickRunner(runners).id, 'd');
  assert.equal(pickRunner(runners, ['d']).id, 'c');
  assert.equal(pickRunner(runners, ['d', 'c', 'b']), null);
  assert.equal(pickRunner([]), null);
});

test('median and job wording', () => {
  assert.equal(median([4, 1, 3]), 3);
  assert.equal(median([4, 1, 3, 2]), 2.5);
  assert.equal(median([]), null);
  assert.equal(jobLine({ state: 'acked', runnerName: 'Asha' }), 'Asha: Runner on the way');
  assert.equal(jobLine({ state: 'waiting' }), 'Waiting for a free runner');
});

test('dispatch decision: no runners means no job; all busy means wait (no state machine yet)', () => {
  assert.equal(dispatchDecision([]), 'no_runners');
  assert.equal(dispatchDecision(undefined), 'no_runners');
  assert.equal(dispatchDecision([{ id: 'a', status: 'busy' }, { id: 'b', status: 'busy' }]), 'wait');
  assert.equal(dispatchDecision([{ id: 'a', status: 'busy' }, { id: 'b', status: 'free' }]), 'start');
  assert.equal(dispatchDecision([{ id: 'b', status: 'free' }], ['b']), 'wait', 'only an excluded runner is free');
});
