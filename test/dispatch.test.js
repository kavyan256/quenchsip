import { test } from 'node:test';
import assert from 'node:assert/strict';
import { jarsToSend, pickRunner, dispatchDecision, median, jobLine, MAX_JARS_PER_TRIP, MIN_JARS_PER_TRIP } from '../src/core/dispatch.js';

test('jars to send: about 2 hours at the station rate, 2 to 6, trimmed near the end of the event', () => {
  assert.equal(jarsToSend({ intervalMin: 40, jarsLeft: 1 }), 3, '120 min / 40 min a jar');
  assert.equal(jarsToSend({ intervalMin: 30, jarsLeft: 5 }), 4, 'does not subtract jars left (missed taps make it too high)');
  assert.equal(jarsToSend({ intervalMin: 90 }), MIN_JARS_PER_TRIP, 'a quiet station still gets 2');
  assert.equal(jarsToSend({ intervalMin: 7 }), MAX_JARS_PER_TRIP, 'a busy station gets a full load');
  assert.equal(jarsToSend({ intervalMin: null }), MIN_JARS_PER_TRIP, 'no rate known: the minimum');
  assert.equal(jarsToSend({ intervalMin: 10, minutesLeft: 5 }), 5, 'near the end: until closing + 45 min = 50 min = 5 jars');
  assert.equal(jarsToSend({ intervalMin: 60, minutesLeft: 0 }), 1, 'after closing, one jar if that is all it needs');
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
