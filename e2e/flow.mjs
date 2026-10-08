// End-to-end browser test (BUILD-PLAN tests C/E1): plan -> save event -> organiser page ->
// wrong/right PIN -> QR sheet -> each QR opens the right volunteer station.
// Needs: DynamoDB Local + table, `npm run api` (port 3001), `npm run serve` (port 8080), Google Chrome.
// Run: npm run test:e2e
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';

const WEB = process.env.WEB_URL || 'http://localhost:8080';
const PORT = 9333;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const profile = mkdtempSync(join(tmpdir(), 'qs-e2e-'));
const chrome = spawn(process.env.CHROME || 'google-chrome', ['--headless=new', '--disable-gpu', '--no-proxy-server', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore' });

async function open(url) {
  const tab = await (await fetch(`http://127.0.0.1:${PORT}/json/new?${encodeURIComponent(url)}`, { method: 'PUT' })).json();
  const ws = new WebSocket(tab.webSocketDebuggerUrl);
  await new Promise((r) => (ws.onopen = r));
  let id = 0;
  const pending = {};
  const errors = [];
  ws.onmessage = (m) => {
    const d = JSON.parse(m.data);
    if (pending[d.id]) { pending[d.id](d); delete pending[d.id]; }
    if (d.method === 'Runtime.exceptionThrown') errors.push(d.params.exceptionDetails.exception?.description);
  };
  const send = (method, params) => new Promise((r) => { pending[++id] = r; ws.send(JSON.stringify({ id, method, params })); });
  await send('Runtime.enable');
  const ev = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
    if (r.result.exceptionDetails) throw new Error(`Page script failed: ${r.result.exceptionDetails.exception?.description}`);
    return r.result.result.value;
  };
  await sleep(1500);
  // Like airplane mode for this tab.
  const setOffline = async (offline) => {
    await send('Network.enable');
    await send('Network.emulateNetworkConditions', { offline, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
  };
  return { ev, errors, send, setOffline, close: async () => { ws.close(); await fetch(`http://127.0.0.1:${PORT}/json/close/${tab.id}`); } };
}

// Polls a page expression until it is truthy, or fails after the timeout.
async function waitFor(page, expr, timeoutMs = 15000) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    const v = await page.ev(expr);
    if (v) return v;
    await sleep(200);
  }
  throw new Error(`Timed out waiting for: ${expr}`);
}

const step = (name) => console.log(`ok - ${name}`);

try {
  await sleep(1500);

  const page = await open(`${WEB}/plan.html`);
  await page.ev(`document.getElementById('pin').value = '2468'; document.getElementById('createEvent').click();`);
  await sleep(2000);
  const path = await page.ev('location.pathname + location.search');
  assert.match(path, /^\/event\.html\?e=[a-z0-9]+$/);
  const eventId = path.split('=')[1];
  assert.equal(await page.ev(`document.querySelectorAll('#stations li').length`), 4);
  step('plan saves an event and opens the organiser page');

  await page.ev(`{ document.getElementById('pin').value = '0000'; const f = document.getElementById('addStation'); f.elements.name.value = 'Hack'; f.elements.zone.value = 'Gate'; f.requestSubmit(); }`);
  await sleep(1200);
  assert.equal(await page.ev(`document.getElementById('actionStatus').textContent`), 'Wrong organiser PIN.');
  assert.equal(await page.ev(`document.querySelectorAll('#stations li').length`), 4);
  step('wrong PIN cannot add a station');

  await page.ev(`{ document.getElementById('pin').value = '2468'; const f = document.getElementById('addStation'); f.elements.name.value = 'Exit gate'; f.elements.zone.value = 'Gate'; f.requestSubmit(); }`);
  await sleep(1200);
  assert.equal(await page.ev(`document.getElementById('actionStatus').textContent`), 'Station added.');
  assert.equal(await page.ev(`document.querySelectorAll('#stations li').length`), 5);
  assert.deepEqual(page.errors, []);
  await page.close();
  step('right PIN adds a station');

  const qr = await open(`${WEB}/qr.html?e=${eventId}`);
  assert.equal(await qr.ev(`document.querySelectorAll('.qr-card svg').length`), 5);
  const cards = await qr.ev(`[...document.querySelectorAll('.qr-card')].map(c => ({ name: c.querySelector('.station-name').textContent, url: c.querySelector('.small:last-child').textContent }))`);
  await qr.close();
  step('QR sheet has one code per station');

  for (const card of cards) {
    const v = await open(card.url);
    assert.equal(await v.ev(`document.getElementById('station').textContent`), card.name);
    await v.close();
  }
  step('each QR link opens the matching volunteer station');

  // Step 3: volunteer taps
  const API = process.env.API_URL || 'http://localhost:3001';
  const stationId = new URL(cards[0].url).searchParams.get('s');
  const counts = async () => (await (await fetch(`${API}/events/${eventId}`)).json()).stations.find((s) => s.id === stationId);
  const vol = await open(cards[0].url);
  // Timed until the server has counted it (the phone shows "Saved" sooner, once it is queued).
  const started = Date.now();
  await vol.ev(`document.querySelector('[data-type="swap"]').click()`);
  while (Date.now() - started < 5000 && (await counts()).swapCount !== 1) await sleep(25);
  const tapMs = Date.now() - started;
  assert.equal((await counts()).swapCount, 1);
  assert.match(await vol.ev(`document.getElementById('feedback').textContent`), /^Saved: Jar swapped/);
  assert.ok(tapMs < 2000, `tap took ${tapMs} ms`);
  step(`"Jar swapped" tap reaches the server in ${tapMs} ms (gate: under 2 s)`);

  await vol.ev(`document.querySelector('[data-type="swap"]').click()`);
  await sleep(300);
  assert.match(await vol.ev(`document.getElementById('feedback').textContent`), /Already counted/);
  assert.equal((await counts()).swapCount, 1);
  step('accidental double tap counts once');

  await vol.ev(`document.querySelector('[data-type="last_jar"]').click()`);
  await sleep(1000);
  await vol.ev(`document.querySelector('[data-type="cups_low"]').click()`);
  await sleep(1000);
  const s = await counts();
  assert.deepEqual([s.swapCount, s.lastJarCount, s.cupsLowCount], [1, 1, 1]);
  assert.equal(await vol.ev(`document.querySelectorAll('#recent li').length`), 3);
  assert.equal(await vol.ev('document.documentElement.scrollWidth > window.innerWidth'), false);
  assert.deepEqual(vol.errors, []);
  await vol.close();
  step('"Last jar" and "Cups low" are saved and listed');

  // Step 4: offline queue
  const sid2 = new URL(cards[1].url).searchParams.get('s');
  const counts2 = async () => (await (await fetch(`${API}/events/${eventId}`)).json()).stations.find((s) => s.id === sid2);
  const sync = `document.getElementById('syncState').textContent`;
  const off = await open(cards[1].url);
  await off.setOffline(true);
  await off.ev(`document.querySelector('[data-type="swap"]').click()`);
  await sleep(3200); // past the double-tap guard
  await off.ev(`document.querySelector('[data-type="swap"]').click()`);
  await off.ev(`document.querySelector('[data-type="last_jar"]').click()`);
  await waitFor(off, `${sync}.startsWith('3 taps saved on this phone')`);
  let c2 = await counts2();
  assert.equal(c2.swapCount, undefined, 'nothing reaches the server while offline');
  await off.setOffline(false);
  await waitFor(off, `${sync} === 'All taps sent.'`);
  c2 = await counts2();
  assert.deepEqual([c2.swapCount, c2.lastJarCount], [2, 1]);
  step('offline: 3 taps wait on the phone, all arrive once back online, no duplicates');

  await off.setOffline(true);
  await off.ev(`document.querySelector('[data-type="cups_low"]').click()`);
  await waitFor(off, `${sync}.startsWith('1 tap saved')`);
  await off.close(); // browser tab closed with a tap still waiting
  assert.equal((await counts2()).cupsLowCount, undefined);
  const reopened = await open(cards[1].url);
  await waitFor(reopened, `${sync} === 'All taps sent.'`);
  assert.equal((await counts2()).cupsLowCount, 1);
  assert.equal((await counts2()).swapCount, 2, 'reopening does not resend old taps');
  await reopened.close();
  step('tab closed mid-queue: the waiting tap survives and is sent on reopen');

  // Page opens with no signal: its own web server (stopped mid-test) + service worker cache.
  const SW_PORT = 8091;
  const webDir = new URL('../web/', import.meta.url).pathname;
  const staticServer = spawn('python3', ['-m', 'http.server', String(SW_PORT), '-d', webDir], { stdio: 'ignore' });
  await sleep(1000);
  const swUrl = `http://localhost:${SW_PORT}/v.html?e=${eventId}&s=${sid2}`;
  const sw = await open(swUrl);
  await waitFor(sw, 'navigator.serviceWorker.controller !== null', 8000);
  await new Promise((r) => { staticServer.once('exit', r); staticServer.kill(); });
  await sw.setOffline(true);
  await sw.ev('location.reload()');
  await sleep(2000);
  assert.equal(await sw.ev(`document.getElementById('station').textContent`), cards[1].name);
  assert.match(await sw.ev(`document.getElementById('feedback').textContent`), /No signal right now/);
  assert.equal(await sw.ev(`document.getElementById('buttons').hidden`), false);
  await sw.close();
  step('page opens with no signal (service worker + saved station name)');

  // Live board: an event that started 30 minutes ago.
  // 1,000 people in one zone, 3 stations: ~83 L/hr each at the low rate -> quiet after 22 min.
  const post = (path, body) => fetch(`${API}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }).then((r) => r.json());
  const live = await post('/events', {
    name: 'Board Test',
    startsAt: new Date(Date.now() - 30 * 60000).toISOString(),
    attendees: 1000,
    startHour: 0,
    hourCount: 3,
    litresPerPersonHr: { low: 0.25, high: 0.5 },
    share: { Field: [1, 1, 1] },
    stations: [{ name: 'Alpha', zone: 'Field' }, { name: 'Bravo', zone: 'Field' }, { name: 'Charlie', zone: 'Field' }],
    pin: '2468',
  });
  const liveStations = (await (await fetch(`${API}/events/${live.id}`)).json()).stations;
  const sidOf = (name) => liveStations.find((s) => s.name === name).id;
  const tapApi = (name, type) => post(`/events/${live.id}/stations/${sidOf(name)}/taps`, { uuid: crypto.randomUUID(), type, deviceTs: new Date().toISOString() });
  await tapApi('Bravo', 'last_jar');
  await tapApi('Charlie', 'swap');

  const board = await open(`${WEB}/board.html?e=${live.id}`);
  const tiles = `[...document.querySelectorAll('.tile')].map(t => t.querySelector('.tile-name').textContent + ': ' + t.querySelector('.tile-status').textContent)`;
  await waitFor(board, `document.querySelectorAll('.tile').length === 3`);
  assert.deepEqual(await board.ev(tiles), ['Bravo: Needs jars now', 'Alpha: No taps: check on volunteer', 'Charlie: OK']);
  assert.match(await board.ev(`document.getElementById('clock').textContent`), /^Live/);
  step('board: needs-jars first, silent station flagged, active station OK');

  const tapAt = Date.now();
  await tapApi('Alpha', 'swap');
  await waitFor(board, `${tiles}.includes('Alpha: OK')`, 10000);
  const seenMs = Date.now() - tapAt;
  step(`a tap shows on the board in ${(seenMs / 1000).toFixed(1)} s (gate: under 10 s)`);

  await board.setOffline(true);
  await waitFor(board, `document.getElementById('freshness').textContent.startsWith('Not updating')`, 40000);
  await board.setOffline(false);
  await waitFor(board, `document.getElementById('freshness').textContent.startsWith('Updated')`, 10000);
  assert.equal(await board.ev('document.documentElement.scrollWidth > window.innerWidth'), false);
  assert.deepEqual(board.errors, []);
  await board.close();
  step('board says when it has stopped updating, and recovers');

  const bad = await open(`${WEB}/v.html?e=${eventId}&s=zzzzzz`);
  assert.match(await bad.ev(`document.getElementById('loadError').textContent`), /removed/);
  await bad.close();
  step('unknown station shows a clear message');

  console.log('# e2e pass');
} catch (err) {
  console.error('not ok -', err.message);
  process.exitCode = 1;
} finally {
  // Wait for Chrome to exit before deleting its profile, or it may still be writing files.
  await new Promise((r) => { chrome.once('exit', r); chrome.kill(); setTimeout(r, 3000); });
  try { rmSync(profile, { recursive: true, force: true, maxRetries: 3 }); } catch {}
}
