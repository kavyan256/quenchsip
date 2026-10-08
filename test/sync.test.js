import { test } from 'node:test';
import assert from 'node:assert/strict';
import { outcome, retryDelay, queueSummary } from '../src/core/sync.js';

test('outcome: sent, retry or failed', () => {
  assert.equal(outcome(201), 'sent');
  assert.equal(outcome(200), 'sent'); // duplicate already stored
  for (const s of [0, 408, 429, 500, 502, 503]) assert.equal(outcome(s), 'retry', String(s));
  for (const s of [400, 403, 404]) assert.equal(outcome(s), 'failed', String(s));
});

test('retry delay doubles from 1 s and stops at 30 s', () => {
  const noJitter = () => 0;
  assert.deepEqual([0, 1, 2, 3, 4, 5, 6, 10].map((a) => retryDelay(a, noJitter)), [1000, 2000, 4000, 8000, 16000, 30000, 30000, 30000]);
});

test('retry delay adds at most 20% jitter', () => {
  assert.equal(retryDelay(0, () => 1), 1200);
  assert.equal(retryDelay(10, () => 0.5), 33000);
});

test('summary tells the volunteer what is waiting', () => {
  assert.deepEqual(queueSummary([]), { kind: 'ok', text: 'All taps sent.' });
  assert.deepEqual(queueSummary([{ status: 'sent' }, { status: 'pending' }]), { kind: 'pending', text: '1 tap saved on this phone, waiting to send.' });
  assert.equal(queueSummary([{ status: 'pending' }, { status: 'pending' }, { status: 'pending' }]).text, '3 taps saved on this phone, waiting to send.');
  assert.equal(queueSummary([{ status: 'pending' }, { status: 'failed' }]).kind, 'warn');
});
