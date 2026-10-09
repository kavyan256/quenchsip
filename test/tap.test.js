import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateTap, newTapId, TapError } from '../src/core/tap.js';

const NOW = Date.parse('2026-10-10T18:00:00Z');
const uuid = 'f47ac10b-58cc-4372-a567-0e02b2c3d479';

test('valid tap keeps the phone time', () => {
  const t = validateTap({ uuid, type: 'swap', deviceTs: '2026-10-10T17:55:00Z' }, NOW);
  assert.equal(t.tappedAt, '2026-10-10T17:55:00.000Z');
  assert.equal(t.clockTrusted, true);
});

test('phone time in the future or over a day old falls back to server time', () => {
  for (const deviceTs of ['2026-10-10T18:10:00Z', '2026-10-09T17:00:00Z', 'not a date', undefined]) {
    const t = validateTap({ uuid, type: 'swap', deviceTs }, NOW);
    assert.equal(t.tappedAt, new Date(NOW).toISOString(), String(deviceTs));
    assert.equal(t.clockTrusted, false);
  }
});

test('unknown type and bad ids are rejected', () => {
  assert.throws(() => validateTap({ uuid, type: 'refill' }, NOW), TapError);
  for (const bad of ['', 'abc', '12345678-1234-1234-1234-123456789012', undefined]) {
    assert.throws(() => validateTap({ uuid: bad, type: 'swap' }, NOW), TapError);
  }
});

test('uppercase id is accepted and stored lowercase', () => {
  assert.equal(validateTap({ uuid: uuid.toUpperCase(), type: 'cups_low' }, NOW).uuid, uuid);
});

test('newTapId makes valid, different v4 ids', () => {
  const ids = new Set(Array.from({ length: 1000 }, () => newTapId()));
  assert.equal(ids.size, 1000);
  for (const id of ids) validateTap({ uuid: id, type: 'swap' }, NOW);
});

test('stocked tap needs whole-number jar and cup counts', () => {
  const t = validateTap({ uuid, type: 'stocked', jars: 6, cups: 400, deviceTs: '2026-10-10T17:55:00Z' }, NOW);
  assert.deepEqual([t.jars, t.cups], [6, 400]);
  assert.equal(validateTap({ uuid, type: 'stocked', jars: '0', cups: '0' }, NOW).jars, 0);
  for (const bad of [{}, { jars: 6 }, { jars: -1, cups: 10 }, { jars: 2.5, cups: 10 }, { jars: 201, cups: 10 }, { jars: 6, cups: 'lots' }]) {
    assert.throws(() => validateTap({ uuid, type: 'stocked', ...bad }, NOW), TapError, JSON.stringify(bad));
  }
  assert.equal(validateTap({ uuid, type: 'swap', jars: 6 }, NOW).jars, undefined, 'counts only on stocked taps');
});
