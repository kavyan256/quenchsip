// Fixtures U4-U10 from BUILD-PLAN.md, plus stock and restock cases.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { swapInterval, jarsLeft, project } from '../src/core/projection.js';

const T0 = Date.parse('2026-10-10T12:00:00Z');
const at = (m) => new Date(T0 + m * 60000).toISOString();
const ms = (m) => T0 + m * 60000;
const live = { live: true, start: T0 };
const planned = { highLph: 120, lowLph: 60 }; // 10 and 20 min per jar

test('U4: swaps at 0, 10, 20 min -> 10 min per jar, measured', () => {
  assert.deepEqual(swapInterval([at(0), at(10), at(20)], 120), { intervalMin: 10, source: 'measured' });
});

test('uses only the last 3 gaps', () => {
  assert.equal(swapInterval([at(0), at(30), at(40), at(50), at(60)], 120).intervalMin, 10);
});

test('U5: one swap only -> planned interval (busy estimate)', () => {
  assert.deepEqual(swapInterval([at(0)], 120), { intervalMin: 10, source: 'plan' });
  assert.deepEqual(swapInterval([], 0), { intervalMin: null, source: 'none' });
});

test('jars left after "Last jar", stocking and restocks', () => {
  assert.equal(jarsLeft({ lastJarAt: at(20) }), 1);
  assert.equal(jarsLeft({ lastJarAt: at(20), swapTimes: [at(10), at(25)] }), 0);
  assert.equal(jarsLeft({ lastJarAt: at(20), restocks: [{ at: at(30), jars: 4 }] }), 5);
  assert.equal(jarsLeft({ stockedJars: 6, swapTimes: [at(10), at(20)] }), 4);
  assert.equal(jarsLeft({ stockedJars: 6, swapTimes: [at(10)], restocks: [{ at: at(15), jars: 3 }] }), 8);
  assert.equal(jarsLeft({ swapTimes: [at(10)] }), null, 'unknown without stock or last-jar');
});

test('stock count: only swaps and restocks after the count, newest of count or "Last jar" wins', () => {
  assert.equal(jarsLeft({ stockedJars: 6, stockedAt: at(15), swapTimes: [at(10), at(20)] }), 5);
  assert.equal(jarsLeft({ stockedJars: 6, stockedAt: at(15), restocks: [{ at: at(5), jars: 9 }, { at: at(25), jars: 2 }] }), 8);
  assert.equal(jarsLeft({ stockedJars: 6, stockedAt: at(15), lastJarAt: at(30), swapTimes: [at(20)] }), 1, 'last jar after the count');
  assert.equal(jarsLeft({ stockedJars: 6, stockedAt: at(30), lastJarAt: at(15), swapTimes: [at(20)] }), 6, 'recount after the last jar');
});

test('the jar on the tap is full when stocked: dry time counts from the later of last swap or stock count', () => {
  // 3 jars counted at 30 (after a swap at 20); 10 min per jar from plan -> dry at 30 + 3 x 10 = 60
  const p = project({ stockedJars: 3, stockedAt: at(30), swapTimes: [at(20)], lastTapAt: at(30) }, { now: ms(31), clock: live, planned });
  assert.equal(p.dryAt, at(60));
});

test('U6: last swap at 20, 10 min per jar, 2 jars left -> dry at 40', () => {
  const p = project({ stockedJars: 5, swapTimes: [at(0), at(10), at(20)], lastTapAt: at(20) }, { now: ms(21), clock: live, planned });
  assert.equal(p.jarsLeft, 2);
  assert.equal(p.dryAt, at(40));
  assert.equal(p.minutesToDry, 19);
});

test('U7: dry in 12 min, runner trip 5 -> alert (12 < 5 + 10)', () => {
  const p = project({ stockedJars: 5, swapTimes: [at(0), at(10), at(20)], lastTapAt: at(20) }, { now: ms(28), clock: live, planned, runnerTripMin: 5 });
  assert.equal(p.minutesToDry, 12);
  assert.equal(p.alert, true);
});

test('U8: dry in 30 min, runner trip 5 -> no alert', () => {
  const p = project({ stockedJars: 6, swapTimes: [at(0), at(10), at(20)], lastTapAt: at(20) }, { now: ms(20), clock: live, planned, runnerTripMin: 5 });
  assert.equal(p.minutesToDry, 30);
  assert.equal(p.alert, false);
});

test('U9: last tap 16 min ago, 10 min per jar measured -> quiet (16 > 15)', () => {
  const p = project({ swapTimes: [at(0), at(10)], lastTapAt: at(10) }, { now: ms(26), clock: live, planned });
  assert.equal(p.quietAfterMin, 15);
  assert.equal(p.quiet, true);
});

test('U10: event not live -> never quiet', () => {
  const p = project({ swapTimes: [at(0), at(10)], lastTapAt: at(10) }, { now: ms(200), clock: { live: false, start: T0 }, planned });
  assert.equal(p.quiet, false);
});

test('quiet uses the floor of 10 min, and the low plan before any measurement', () => {
  assert.equal(project({ lastTapAt: at(0) }, { now: ms(1), clock: live, planned: { highLph: 1200, lowLph: 600 } }).quietAfterMin, 10);
  assert.equal(project({ lastTapAt: at(0) }, { now: ms(1), clock: live, planned }).quietAfterMin, 30); // low: 20 min per jar
});

test('stock unknown -> no dry time and no alert', () => {
  const p = project({ swapTimes: [at(0), at(10)], lastTapAt: at(10) }, { now: ms(12), clock: live, planned });
  assert.equal(p.dryAt, null);
  assert.equal(p.alert, false);
});

test('past the dry time -> dry and alert', () => {
  const p = project({ lastJarAt: at(0), swapTimes: [at(-10), at(0)], lastTapAt: at(0) }, { now: ms(15), clock: live, planned });
  assert.equal(p.dry, true);
  assert.equal(p.alert, true);
});
