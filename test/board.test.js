import { test } from 'node:test';
import assert from 'node:assert/strict';
import { eventClock, quietAfterMin, stationStatus, boardView, ago } from '../src/core/board.js';

const T0 = Date.parse('2026-10-10T12:00:00Z');
const min = (m) => T0 + m * 60000;
const iso = (m) => new Date(min(m)).toISOString();
const event = { startsAt: iso(0), hourCount: 3 };

test('event clock: live window and plan hour', () => {
  assert.deepEqual([eventClock(event, min(-5)).live, eventClock(event, min(-5)).beforeStart], [false, true]);
  assert.equal(eventClock(event, min(0)).live, true);
  assert.equal(eventClock(event, min(61)).hourIndex, 1);
  assert.equal(eventClock(event, min(180)).live, false);
  assert.equal(eventClock(event, min(500)).hourIndex, 2, 'clamped to the last hour');
  assert.equal(eventClock({ hourCount: 3 }, min(0)).known, false);
});

test('quiet threshold: 1.5x minutes per jar, at least 10 min', () => {
  assert.equal(quietAfterMin(60), 30); // 20 L jar lasts 20 min at 60 L/hr
  assert.equal(quietAfterMin(600), 10); // 2 min per jar -> floor
  assert.equal(quietAfterMin(0), Infinity);
});

const clock = eventClock(event, min(60));
const status = (station, now = min(60), lph = 60) => stationStatus(station, { now, clock: eventClock(event, now), plannedLowLph: lph });

test('last jar means needs jars, until a later restock', () => {
  assert.equal(status({ lastJarAt: iso(50), lastTapAt: iso(50) }).status, 'needs_jars');
  assert.equal(status({ lastJarAt: iso(50), lastTapAt: iso(55), lastRestockAt: iso(55) }).status, 'ok');
  assert.equal(status({ lastJarAt: iso(56), lastTapAt: iso(56), lastRestockAt: iso(55) }).status, 'needs_jars');
});

test('quiet only while live, after the threshold', () => {
  assert.equal(status({ lastTapAt: iso(25) }).status, 'quiet'); // 35 min > 30
  assert.equal(status({ lastTapAt: iso(35) }).status, 'ok'); // 25 min
  assert.equal(status({}, min(40)).status, 'quiet', 'no taps 40 min into the event');
  assert.equal(status({ lastTapAt: iso(25) }, min(200)).status, 'ok', 'event over');
});

test('needs jars beats quiet beats cups low; flags keep all three', () => {
  const s = status({ lastJarAt: iso(10), cupsLowAt: iso(10), lastTapAt: iso(10) });
  assert.equal(s.status, 'needs_jars');
  assert.deepEqual(s.flags, { needsJars: true, cupsLow: true, quiet: true });
  assert.equal(status({ cupsLowAt: iso(10), lastTapAt: iso(10) }).status, 'quiet');
  assert.equal(status({ cupsLowAt: iso(55), lastTapAt: iso(55) }).status, 'cups_low');
});

test('board puts the most urgent station first', () => {
  const plan = { rows: ['a', 'b', 'c', 'd', 'e'].map((id) => ({ stationId: id, byHour: [0, 1, 2].map(() => ({ low: { litres: 60, jars: 3 }, high: { litres: 120, jars: 6 } })) })) };
  const stations = [
    { id: 'a', name: 'Alpha', lastTapAt: iso(58) },
    { id: 'b', name: 'Bravo', lastJarAt: iso(55), lastTapAt: iso(55) },
    { id: 'c', name: 'Charlie', lastJarAt: iso(40), lastTapAt: iso(59) },
    { id: 'd', name: 'Delta', lastTapAt: iso(20) },
    { id: 'e', name: 'Echo', cupsLowAt: iso(57), lastTapAt: iso(57) },
  ];
  const view = boardView({ event, stations, plan }, min(60));
  assert.deepEqual(view.tiles.map((t) => t.station.name), ['Charlie', 'Bravo', 'Delta', 'Echo', 'Alpha']);
  assert.deepEqual(view.summary, { needs_jars: 2, quiet: 1, cups_low: 1, ok: 1 });
  assert.deepEqual(view.tiles[0].plannedJarsPerHour, { low: 3, high: 6 });
});

test('time ago in plain words', () => {
  assert.equal(ago(iso(59.5), min(60)), 'just now');
  assert.equal(ago(iso(56), min(60)), '4 min ago');
  assert.equal(ago(iso(-5), min(60)), '1 h 5 min ago');
  assert.equal(ago(null, min(60)), 'never');
});
