import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stationHourDemand, planEvent, shareWarnings, readiness } from '../src/core/plan.js';

const oneStation = (attendees, share, rate, heatFactor = 1) =>
  planEvent({
    attendees,
    hours: ['18:00'],
    stations: [{ id: 's1', name: 'Gate', zone: 'A' }],
    share: { A: [share] },
    litresPerPersonHr: { low: rate, high: rate },
    heatFactor,
  });

test('U1: 1,000 people, 1 station, share 1.0, 0.3 L/p/hr -> 300 L, 15 jars, 1,500 cups', () => {
  assert.deepEqual(stationHourDemand(1000, 0.3), { litres: 300, jars: 15, cups: 1500 });
  const plan = oneStation(1000, 1, 0.3);
  assert.equal(plan.total.litresHigh, 300);
  assert.equal(plan.total.jarsHigh, 15);
  assert.equal(plan.total.cupsHigh, 1500);
});

test('U2: zero crowd share -> 0 jars, 0 cups', () => {
  const plan = oneStation(1000, 0, 0.3);
  assert.equal(plan.total.jarsHigh, 0);
  assert.equal(plan.total.cupsHigh, 0);
});

test('U3: heat factor 2 doubles U1', () => {
  assert.deepEqual(stationHourDemand(1000, 0.3, 2), { litres: 600, jars: 30, cups: 3000 });
});

test('U14: 5,000 attendees, 8 stations -> warning, needs 10', () => {
  const r = readiness({ attendees: 5000, stationCount: 8 });
  assert.equal(r.ok, false);
  assert.equal(r.stationsNeeded, 10);
  assert.match(r.warnings[0], /at least 10/);
});

test('U15: 3,000 attendees, 8 stations -> OK', () => {
  const r = readiness({ attendees: 3000, stationCount: 8 });
  assert.equal(r.ok, true);
  assert.equal(r.warnings.length, 0);
});

test('two stations in one zone split the zone demand equally', () => {
  const plan = planEvent({
    attendees: 1000,
    hours: ['18:00'],
    stations: [
      { id: 's1', name: 'Stage left', zone: 'Stage' },
      { id: 's2', name: 'Stage right', zone: 'Stage' },
    ],
    share: { Stage: [1] },
    litresPerPersonHr: { low: 0.3, high: 0.3 },
  });
  assert.equal(plan.rows[0].byHour[0].high.litres, 150);
  assert.equal(plan.rows[1].byHour[0].high.litres, 150);
  assert.equal(plan.total.litresHigh, 300);
});

test('low/high range comes from the two rates', () => {
  const plan = planEvent({
    attendees: 1000,
    hours: ['18:00', '19:00'],
    stations: [{ id: 's1', name: 'Gate', zone: 'A' }],
    share: { A: [1, 1] },
  });
  assert.equal(plan.total.litresLow, 500); // 1000 x 0.25 x 2 h
  assert.equal(plan.total.litresHigh, 1000); // 1000 x 0.5 x 2 h
  assert.equal(plan.total.jarsLow, 25);
  assert.equal(plan.total.jarsHigh, 50);
});

test('zone shares over 100% in an hour give a warning', () => {
  const w = shareWarnings({ A: [0.7, 0.5], B: [0.5, 0.5] }, 2);
  assert.equal(w.length, 1);
  assert.match(w[0], /Hour 1/);
  assert.deepEqual(shareWarnings({ A: [0.5], B: [0.5] }, 1), []);
});

test('float noise does not add an extra jar', () => {
  // 0.1 + 0.2 style noise: 200 people x 0.1 L x 3 = 60.00000000000001 L
  assert.deepEqual(stationHourDemand(200, 0.1, 3), { litres: 60, jars: 3, cups: 300 });
});

test('readiness wording uses singular for 1', () => {
  const r = readiness({ attendees: 1000, stationCount: 1, volunteerCount: 0 });
  assert.match(r.warnings[0], /You have 1 water station\./);
  assert.match(r.warnings[1], /0 volunteers for 1 station\./);
});

test('readiness flags volunteers, supplier and signal in plain words', () => {
  const r = readiness({ attendees: 1000, stationCount: 2, volunteerCount: 1, jarSupplier: false, signal: false });
  assert.equal(r.ok, false);
  assert.equal(r.warnings.length, 3);
});
