import { test } from 'node:test';
import assert from 'node:assert/strict';
import { summarize, stationsCsv } from '../src/core/summary.js';

const event = { name: 'Fest', startsAt: '2026-10-10T12:00:00.000Z', hourCount: 3, attendees: 3000 };

test('U13: 42 swaps -> 840 L, up to 1,680 bottles, formula shown', () => {
  const s = summarize({ event, stations: [{ id: 'a', name: 'A', zone: 'Z', swapCount: 30 }, { id: 'b', name: 'B', zone: 'Z', swapCount: 12 }] });
  assert.equal(s.water.swaps, 42);
  assert.equal(s.water.litres, 840);
  assert.equal(s.water.bottlesUpTo, 1680);
  assert.deepEqual(s.water.petKg, { low: 16.8, high: 21.8 });
  assert.match(s.water.formula, /42 jars swapped × 20 L = 840 L dispensed\. 840 L ÷ 0\.5 L = up to 1,680 bottles/);
});

test('stations: dry minutes, stocked before start, restocks', () => {
  const s = summarize({
    event,
    stations: [
      { id: 'a', name: 'A', zone: 'Z', swapCount: 5, dryMinutes: 3.6, stocked: true, stockedAt: '2026-10-10T11:50:00.000Z', restocks: [{ jars: 4 }, { jars: 2 }] },
      { id: 'b', name: 'B', zone: 'Z', stocked: true, stockedAt: '2026-10-10T12:20:00.000Z' },
      { id: 'c', name: 'C', zone: 'Z' },
    ],
  });
  assert.deepEqual(s.stations.map((r) => [r.name, r.dryMinutes, r.stockedBeforeStart, r.restocks, r.jarsDelivered]), [
    ['A', 4, true, 2, 6],
    ['B', 0, false, 0, 0],
    ['C', 0, false, 0, 0],
  ]);
  assert.deepEqual([s.totals.stockedBeforeStart, s.totals.dryMinutes, s.totals.stationsThatRanDry], [1, 4, 1]);
});

test('dispatch: counts by state and median minutes', () => {
  const t = (m) => new Date(Date.parse(event.startsAt) + m * 60000).toISOString();
  const jobs = [
    { state: 'done', createdAt: t(0), assignedAt: t(0), ackedAt: t(2), closedAt: t(10), deliveredJars: 3 },
    { state: 'done', createdAt: t(20), assignedAt: t(21), ackedAt: t(22), closedAt: t(26), deliveredJars: 2 },
    { state: 'done', createdAt: t(40), assignedAt: t(40), closedAt: t(52), deliveredJars: 4 },
    { state: 'stale', createdAt: t(60), assignedAt: t(60) },
  ];
  const s = summarize({ event, stations: [], jobs });
  assert.deepEqual(s.dispatch.byState, { done: 3, stale: 1 });
  assert.equal(s.dispatch.jarsDelivered, 9);
  assert.equal(s.dispatch.medianMinutesToDeliver, 10); // 10, 6, 12
  assert.equal(s.dispatch.medianMinutesToOnMyWay, 1.5); // 2, 1
});

test('CSV escapes commas and quotes', () => {
  const csv = stationsCsv(summarize({ event, stations: [{ id: 'a', name: 'Gate, "main"', zone: 'Z', swapCount: 1 }] }));
  assert.equal(csv.split('\n')[1].split(',')[0], '"Gate');
  assert.match(csv, /^Station,Zone,Jars swapped/);
  assert.match(csv, /"Gate, ""main""",Z,1,20,0,no,0,0,0,0/);
});
