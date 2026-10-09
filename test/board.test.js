import { test } from 'node:test';
import assert from 'node:assert/strict';
import { eventClock, stationStatus, boardView, ago } from '../src/core/board.js';

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

// Plan: 60-120 L/hr per station -> 10-20 min per jar; quiet after 30 min with no measurements.
const status = (station, now = min(60)) => stationStatus({ stocked: true, ...station }, { now, clock: eventClock(event, now), planned: { highLph: 120, lowLph: 60 }, runnerTripMin: 10 });

test('last jar means needs jars, until a later restock', () => {
  assert.equal(status({ lastJarAt: iso(50), lastTapAt: iso(50) }).status, 'needs_jars');
  // Swap at 45, "Last jar" at 50, 4 jars restocked at 55 -> 5 left, dry at 45 + 5 x 10 = 95 (35 min away)
  const restocked = { swapTimes: [iso(45)], lastJarAt: iso(50), restocks: [{ at: iso(55), jars: 4 }], lastRestockAt: iso(55), lastTapAt: iso(55) };
  assert.equal(status(restocked).status, 'ok');
  assert.equal(status({ ...restocked, lastJarAt: iso(56) }).status, 'needs_jars', '"Last jar" again after the restock');
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
  assert.deepEqual(s.flags, { needsJars: true, lastJar: true, runningDry: true, notStocked: false, cupsLow: true, quiet: true });
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
  const view = boardView({ event, stations: stations.map((x) => ({ stocked: true, ...x })), plan }, min(60));
  assert.deepEqual(view.tiles.map((t) => t.station.name), ['Charlie', 'Bravo', 'Delta', 'Echo', 'Alpha']);
  assert.deepEqual(view.summary, { needs_jars: 2, not_stocked: 0, quiet: 1, cups_low: 1, ok: 1 });
  assert.deepEqual(view.tiles[0].plannedJarsPerHour, { low: 3, high: 6 });
});

test('a stocked station about to run dry needs jars even without a "Last jar" tap', () => {
  // 6 jars stocked, 4 swaps 10 min apart -> 2 left, last swap at 55 -> dry at 75: 15 min < 10 + 10
  const s = status({ stockedJars: 6, swapTimes: [iso(25), iso(35), iso(45), iso(55)], lastTapAt: iso(55) });
  assert.equal(s.status, 'needs_jars');
  assert.deepEqual([s.flags.lastJar, s.flags.runningDry], [false, true]);
  assert.equal(s.projection.minutesToDry, 15);
  // With 8 stocked: dry at 95, 35 min away -> OK
  assert.equal(status({ stockedJars: 8, swapTimes: [iso(25), iso(35), iso(45), iso(55)], lastTapAt: iso(55) }).status, 'ok');
});

test('a station not yet stocked is flagged, after needs-jars and before quiet', () => {
  assert.equal(status({ stocked: false }, min(-10)).status, 'not_stocked'); // before the gates open
  assert.equal(stationStatus({}, { now: min(60), clock: eventClock(event, min(60)), planned: { highLph: 120, lowLph: 60 } }).status, 'not_stocked');
  assert.equal(status({ stocked: false, lastJarAt: iso(50), lastTapAt: iso(50) }).status, 'needs_jars');
  const plan = { rows: ['a', 'b', 'c'].map((id) => ({ stationId: id, byHour: [0, 1, 2].map(() => ({ low: { litres: 60, jars: 3 }, high: { litres: 120, jars: 6 } })) })) };
  const stations = [
    { id: 'a', name: 'A', stocked: true, stockedJars: 6, stockedAt: iso(-5), lastTapAt: iso(-5) },
    { id: 'b', name: 'B' },
    { id: 'c', name: 'C', stocked: true, stockedJars: 6, stockedAt: iso(-5), lastTapAt: iso(-5) },
  ];
  const view = boardView({ event, stations, plan }, min(-2));
  assert.deepEqual(view.tiles.map((t) => `${t.station.name}:${t.status}`), ['B:not_stocked', 'A:ok', 'C:ok']);
});

test('a stock count clears earlier "Last jar" and "Cups low" and sets jars left', () => {
  const s = status({ lastJarAt: iso(30), cupsLowAt: iso(30), stockedJars: 8, stockedAt: iso(40), swapTimes: [iso(20), iso(50)], lastTapAt: iso(50) });
  assert.deepEqual([s.flags.lastJar, s.flags.cupsLow], [false, false]);
  assert.equal(s.projection.jarsLeft, 7, '8 counted at 40, one swap after');
  assert.equal(s.status, 'ok');
});

test('time ago in plain words', () => {
  assert.equal(ago(iso(59.5), min(60)), 'just now');
  assert.equal(ago(iso(56), min(60)), '4 min ago');
  assert.equal(ago(iso(-5), min(60)), '1 h 5 min ago');
  assert.equal(ago(null, min(60)), 'never');
});
