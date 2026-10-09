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
