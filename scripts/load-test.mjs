// Load test (BUILD-PLAN L1): N taps spread over S seconds against an API, then check nothing was lost.
// Usage: node scripts/load-test.mjs <apiBase> [taps=500] [seconds=30]
// Uses curl (it honours HTTPS_PROXY; Node's fetch does not).
import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';

const [base, tapsArg = '500', secondsArg = '30'] = process.argv.slice(2);
if (!base) {
  console.error('Usage: node scripts/load-test.mjs <apiBase> [taps] [seconds]');
  process.exit(2);
}
const TAPS = Number(tapsArg);
const SECONDS = Number(secondsArg);
const STATIONS = 10;

const curl = (method, url, body, headers = {}) =>
  new Promise((resolve) => {
    const args = ['-s', '-w', '\n%{http_code}', '-X', method, url, ...Object.entries(headers).flatMap(([k, v]) => ['-H', `${k}: ${v}`]), ...(body ? ['-H', 'content-type: application/json', '-d', JSON.stringify(body)] : [])];
    execFile('curl', args, { maxBuffer: 10 * 1024 * 1024 }, (err, out) => {
      const i = (out || '').lastIndexOf('\n');
      resolve({ status: Number((out || '').slice(i + 1)) || 0, body: (out || '').slice(0, i) });
    });
  });

const created = await curl('POST', `${base}/events`, {
  name: 'Load Test', attendees: 10000, startHour: 0, hourCount: 3, litresPerPersonHr: { low: 0.25, high: 0.5 },
  share: { F: [1, 1, 1] }, stations: Array.from({ length: STATIONS }, (_, i) => ({ name: `S${i + 1}`, zone: 'F' })), pin: '2468',
});
const eventId = JSON.parse(created.body).id;
// The organiser's view (PIN 2468) includes each station's QR link token, which phones send with every tap.
const stations = JSON.parse((await curl('GET', `${base}/events/${eventId}`, undefined, { 'x-organiser-pin': '2468' })).body).stations;

const started = Date.now();
const statuses = {};
let retried = 0;
const sends = [];
for (let i = 0; i < TAPS; i++) {
  const at = started + (i * SECONDS * 1000) / TAPS;
  sends.push(
    new Promise((r) => setTimeout(r, Math.max(0, at - Date.now()))).then(async () => {
      // Like the phone's queue: same tap id, retry "busy" and network errors with backoff.
      const tap = { uuid: randomUUID(), type: 'swap', deviceTs: new Date().toISOString() };
      for (let attempt = 0; attempt < 6; attempt++) {
        const station = stations[i % STATIONS];
        const res = await curl('POST', `${base}/events/${eventId}/stations/${station.id}/taps`, tap, { 'x-access-token': station.token });
        statuses[res.status] = (statuses[res.status] || 0) + 1;
        if (res.status >= 200 && res.status < 300) break;
        if (attempt > 0) retried++;
        await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt));
      }
    })
  );
}
await Promise.all(sends);
const sentIn = (Date.now() - started) / 1000;

// Give the queue a moment to drain, then count what was stored.
let stored = 0;
for (let i = 0; i < 20 && stored < TAPS; i++) {
  await new Promise((r) => setTimeout(r, 3000));
  stored = JSON.parse((await curl('GET', `${base}/events/${eventId}`)).body).stations.reduce((a, s) => a + (s.swapCount || 0), 0);
}
console.log(JSON.stringify({ eventId, sent: TAPS, sentInSeconds: Math.round(sentIn), responses: statuses, tapsRetriedMoreThanOnce: retried, stored, lost: TAPS - stored }));
process.exitCode = stored === TAPS ? 0 : 1;
// Delete the test event so the scheduled check stops looking at it.
await new Promise((r) => execFile('python3', [new URL('./clear_test_events.py', import.meta.url).pathname, '--id', eventId, '--yes'], (err, out) => {
  console.log(err ? `cleanup failed: ${err.message}` : `cleanup: ${out.trim().split('\n').pop()}`);
  r();
}));
