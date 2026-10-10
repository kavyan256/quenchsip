import { test } from 'node:test';
import assert from 'node:assert/strict';
import { simulate, compare, rng, DEFAULTS } from '../src/core/sim.js';

test('deterministic: same seed, same numbers', () => {
  const a = simulate('quench', { seed: 7 });
  const b = simulate('quench', { seed: 7 });
  assert.equal(a.dryMinutes, b.dryMinutes);
  assert.equal(a.litresServed, b.litresServed);
  assert.deepEqual(a.frames.at(-1), b.frames.at(-1));
  assert.notEqual(rng(1)(), rng(2)());
});

test('one frame per minute; dry minutes never go down', () => {
  const r = simulate('whatsapp');
  assert.equal(r.frames.length, DEFAULTS.minutes);
  for (let i = 1; i < r.frames.length; i++) assert.ok(r.frames[i].dryMinutes >= r.frames[i - 1].dryMinutes);
  assert.equal(r.frames.at(-1).dryMinutes, r.dryMinutes);
});

test('runners never deliver more than they could: jobs fit runner time', () => {
  const r = simulate('quench');
  const maxJobs = DEFAULTS.runners * Math.ceil(DEFAULTS.minutes / (2 * DEFAULTS.tripMin));
  assert.ok(r.jobs <= maxJobs, `${r.jobs} jobs > ${maxJobs}`);
});

test('typical WhatsApp group, 90% taps: Quench has fewer dry minutes', () => {
  const c = compare({ tapRate: 0.9 }, 10);
  assert.ok(c.quench < c.whatsapp, JSON.stringify(c));
});

test('honest limit: a very disciplined WhatsApp group beats Quench when only 70% of taps are recorded', () => {
  // Keeps the video and pitch honest: the app depends on volunteers tapping.
  const c = compare({ tapRate: 0.7, lastJarMessageRate: 1, readDelayMin: 2 }, 10);
  assert.ok(c.quench >= c.whatsapp * 0.8, JSON.stringify(c));
});

test('map: a station\'s own walk time is used, and runner trips are recorded', () => {
  const stations = DEFAULTS.stations.map((s, i) => (i === 6 ? { ...s, tripMin: 14 } : s));
  const r = simulate('quench', { stations });
  assert.ok(r.trips.length === r.jobs && r.jobs > 0);
  for (const t of r.trips) {
    const walk = t.station === 6 ? 14 : DEFAULTS.tripMin;
    assert.equal(t.arrive - t.leave, walk);
    assert.equal(t.back - t.arrive, walk);
  }
  // A runner is never on two trips at once.
  for (let k = 0; k < DEFAULTS.runners; k++) {
    const mine = r.trips.filter((t) => t.runner === k);
    for (let j = 1; j < mine.length; j++) assert.ok(mine[j].leave >= mine[j - 1].back);
  }
});

test('map: default layout (every station 8 min away) gives the same numbers as before', () => {
  const ring = DEFAULTS.stations.map((s) => ({ ...s, tripMin: DEFAULTS.tripMin }));
  for (const p of ['quench', 'whatsapp']) assert.equal(simulate(p, { stations: ring }).dryMinutes, simulate(p).dryMinutes);
});
