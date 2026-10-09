import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateEvent, validatePin, ValidationError, hourLabels, crowdShare, validateEventPatch, validateStationPatch } from '../src/core/event.js';
import { hashPin, verifyPin, newId } from '../src/lib/pin.js';

const good = () => ({
  name: 'Spring Fest',
  attendees: 3000,
  startHour: 17,
  hourCount: 2,
  litresPerPersonHr: { low: 0.25, high: 0.5 },
  share: { Gate: [0.5, 0.5], Stage: [0.5, 0.5] },
  stations: [
    { name: 'Main gate', zone: 'Gate' },
    { name: 'Stage left', zone: 'Stage' },
  ],
  runners: [{ name: 'Asha' }],
});

test('valid event passes and is cleaned', () => {
  const ev = validateEvent({ ...good(), name: '  Spring Fest  ' });
  assert.equal(ev.name, 'Spring Fest');
  assert.equal(ev.stations.length, 2);
  assert.equal(ev.heatFactor, 1);
  assert.equal(ev.jarSupplier, undefined, 'not asked = no warning');
});

test('missing stations is rejected in plain words', () => {
  assert.throws(() => validateEvent({ ...good(), stations: [] }), { name: 'Error', message: 'Add at least one water station.' });
});

test('crowd share must have one value per hour for every zone', () => {
  assert.throws(() => validateEvent({ ...good(), share: { Gate: [0.5, 0.5] } }), ValidationError);
  assert.throws(() => validateEvent({ ...good(), share: { Gate: [0.5], Stage: [0.5, 0.5] } }), ValidationError);
});

test('out-of-range numbers are rejected', () => {
  assert.throws(() => validateEvent({ ...good(), attendees: 0 }), /People expected/);
  assert.throws(() => validateEvent({ ...good(), hourCount: 25 }), /Hours/);
  assert.throws(() => validateEvent({ ...good(), litresPerPersonHr: { low: 0.6, high: 0.5 } }), /Low water/);
});

test('PIN must be 4-8 digits', () => {
  assert.equal(validatePin('1234'), '1234');
  for (const bad of ['123', '123456789', 'abcd', 1234, undefined]) assert.throws(() => validatePin(bad), ValidationError);
});

test('PIN hash verifies the right PIN only', () => {
  const stored = hashPin('2468');
  assert.equal(verifyPin('2468', stored), true);
  assert.equal(verifyPin('1357', stored), false);
  assert.equal(verifyPin(undefined, stored), false);
  assert.notEqual(hashPin('2468'), stored, 'salt makes each hash different');
});

test('ids are short and URL-safe', () => {
  const id = newId();
  assert.match(id, /^[a-z0-9]{8}$/);
  assert.notEqual(newId(), newId());
});

test('hour labels wrap past midnight', () => {
  assert.deepEqual(hourLabels(22, 3), ['22:00', '23:00', '00:00']);
});

test('quick event: only name, people, hours and stations; everything else defaults', () => {
  const ev = validateEvent({ name: 'Fest', attendees: 2000, hourCount: 3, stations: [{ name: 'Station 1' }, { name: 'Station 2', busy: true }] });
  assert.equal(ev.share, undefined);
  assert.deepEqual(ev.litresPerPersonHr, { low: 0.25, high: 0.5 });
  assert.equal(ev.startHour, 0);
  assert.equal(ev.runnerTripMin, 10);
  assert.equal(ev.volunteerCount, undefined);
  assert.deepEqual(ev.stations, [{ name: 'Station 1', zone: '', busy: false }, { name: 'Station 2', zone: '', busy: true }]);
});

test('crowd share: equal split, busy spot counts double', () => {
  const share = crowdShare([{ id: 'a' }, { id: 'b', busy: true }, { id: 'c' }], 2);
  assert.deepEqual(share, { a: [0.25, 0.25], b: [0.5, 0.5], c: [0.25, 0.25] });
});

test('edits: only known fields, at least one, checked ranges', () => {
  assert.deepEqual(validateStationPatch({ name: ' Gate ', busy: true }), { name: 'Gate', busy: true });
  assert.throws(() => validateStationPatch({}), /Nothing to change/);
  assert.deepEqual(validateEventPatch({ runnerTripMin: 6, setup: { ordered: true }, junk: 1 }), { runnerTripMin: 6, setup: { ordered: true } });
  assert.throws(() => validateEventPatch({ runnerTripMin: 0 }), /walking time/);
  assert.throws(() => validateEventPatch({ litresPerPersonHr: { low: 1, high: 0.5 } }), /Low water/);
});
