// End-to-end browser test (BUILD-PLAN tests C/E1): plan -> save event -> organiser page ->
// wrong/right PIN -> QR sheet -> each QR opens the right volunteer station.
// Needs: DynamoDB Local + table, `npm run api` (port 3001), `npm run serve` (port 8080), Google Chrome.
// Run: npm run test:e2e
import { spawn, execFile } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';

const WEB = process.env.WEB_URL || 'http://localhost:8080';
const API = process.env.API_URL || 'http://localhost:3001';
// API calls the test treats as "the network" when simulating no signal.
const API_PATTERN = process.env.API_URL ? `${process.env.API_URL}/*` : '*:3001/*';
const PORT = 9333;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const profile = mkdtempSync(join(tmpdir(), 'qs-e2e-'));
// CHROME_PROXY: route Chrome through a proxy (for networks that need one to reach the deployed site).
const proxyFlag = process.env.CHROME_PROXY ? `--proxy-server=${process.env.CHROME_PROXY}` : '--no-proxy-server';
const chrome = spawn(process.env.CHROME || 'google-chrome', ['--headless=new', '--disable-gpu', proxyFlag, `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore' });

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
    // While "offline", every request this tab makes to the API is failed as if there were no network.
    if (d.method === 'Fetch.requestPaused') {
      if (serverError) send('Fetch.fulfillRequest', { requestId: d.params.requestId, responseCode: 500, body: Buffer.from('{"error":"Injected server error"}').toString('base64') });
      else send('Fetch.failRequest', { requestId: d.params.requestId, errorReason: 'InternetDisconnected' });
    }
  };
  const send = (method, params) => new Promise((r) => { pending[++id] = r; ws.send(JSON.stringify({ id, method, params })); });
  await send('Runtime.enable');
  const ev = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
    if (r.result.exceptionDetails) throw new Error(`Page script failed: ${r.result.exceptionDetails.exception?.description}`);
    return r.result.result.value;
  };
  await sleep(1500);
  // Like airplane mode for this tab: Chrome's offline emulation, plus interception of API calls
  // (emulation alone can leak a request when a page is navigated or closed).
  // While on, the API answers 500 (a broken server) instead of the network being down.
  let serverError = false;
  const setServerError = async (on) => {
    serverError = on;
    if (on) await send('Fetch.enable', { patterns: [{ urlPattern: API_PATTERN }] });
    else await send('Fetch.disable');
  };
  const setOffline = async (offline) => {
    await send('Network.enable');
    await send('Network.emulateNetworkConditions', { offline, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
    if (offline) await send('Fetch.enable', { patterns: [{ urlPattern: API_PATTERN }] });
    else await send('Fetch.disable');
  };
  return { ev, errors, send, setOffline, setServerError, close: async () => { ws.close(); await fetch(`http://127.0.0.1:${PORT}/json/close/${tab.id}`); } };
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

// JSON call to the Quench API. Through curl when a proxy is set, because Node's fetch ignores proxies
// (needed to reach the deployed site from networks that only allow traffic through a proxy).
async function apiCall(method, url, body, headers = {}) {
  if (!process.env.HTTPS_PROXY || /localhost|127\.0\.0\.1/.test(url)) {
    return (await fetch(url, { method, headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...headers }, body: body ? JSON.stringify(body) : undefined })).json();
  }
  const args = ['-s', '-X', method, url, ...Object.entries(headers).flatMap(([k, v]) => ['-H', `${k}: ${v}`]), ...(body ? ['-H', 'content-type: application/json', '-d', JSON.stringify(body)] : [])];
  const out = await new Promise((resolve, reject) => execFile('curl', args, (err, stdout) => (err ? reject(err) : resolve(stdout))));
  return JSON.parse(out);
}

const createdEvents = [];
try {
  await sleep(1500);

  // Set up: one question per screen; only the name is typed, everything else is a tap with a default.
  const page = await open(`${WEB}/plan.html`);
  const visibleStep = `document.querySelector('.flow-step:not([hidden])').dataset.step`;
  await page.ev(`document.getElementById('next').click()`);
  await sleep(300);
  assert.equal(await page.ev(`document.getElementById('nameError').hidden`), false, 'empty name is caught next to the field');
  assert.equal(await page.ev(`document.activeElement.id`), 'name');
  assert.equal(await page.ev(visibleStep), '1', 'cannot move on without a name');
  await page.ev(`{ const n = document.getElementById('name'); n.value = 'Spring Fest'; n.dispatchEvent(new Event('input')); }`);
  for (const n of ['2', '3', '4', '5']) {
    await page.ev(`document.getElementById('next').click()`);
    assert.equal(await page.ev(visibleStep), n, `Continue moves to question ${n}`);
  }
  await page.ev(`history.back()`);
  await waitFor(page, `${visibleStep} === '4'`);
  await page.ev(`document.getElementById('next').click()`);
  assert.equal(await page.ev(`document.getElementById('create').hidden`), false, 'the plan screen has Create event');
  assert.equal(await page.ev(`document.querySelectorAll('#flowProgress span.on').length`), 5);
  assert.match(await page.ev(`document.getElementById('order').textContent`), /^Order about \d+–\d+ jars/);
  assert.match(await page.ev(`document.getElementById('planJars').textContent`), /^\d+–\d+$/);
  assert.match(await page.ev(`document.querySelector('.flow-step[data-step="5"]').textContent`), /kulhad, bagasse, areca leaf or paper without plastic lining[\s\S]*Skip plastic-lined paper cups/, 'the plan says which cups');
  const sellerLinks = (root) => `[...document.querySelectorAll('${root} a[href*="google.com/maps"]')].map((a) => a.textContent + ': ' + new URL(a.href).searchParams.get('query')).join(' | ')`;
  const sellers = 'Kulhad: kulhad wholesale near me | Bagasse: bagasse cups wholesale near me | Areca leaf: areca leaf cups wholesale near me | Paper, no plastic lining: aqueous coated paper cups wholesale near me';
  assert.equal(await page.ev(sellerLinks('.cup-promo')), sellers, 'the plan links to nearby cup sellers on Maps');
  assert.equal(await page.ev(`document.getElementById('stations').textContent`), '4', '2,000 people -> 4 stations suggested');
  assert.match(await page.ev(`document.getElementById('planLine').textContent`), /^Spring Fest · Today .* · 2,000 people$/);
  await page.ev(`document.getElementById('create').click()`);
  await waitFor(page, `location.pathname === '/event.html'`, 15000);
  const params = new URL(await page.ev('location.href'));
  const eventId = params.searchParams.get('e');
  createdEvents.push(eventId);
  const orgKey = new URLSearchParams(params.hash.slice(1)).get('k');
  assert.match(orgKey, /^[a-z0-9]{24}$/, 'organiser link carries the private key');
  await waitFor(page, `document.getElementById('stationsLine').textContent.startsWith('4 stations')`, 15000);
  assert.match(await page.ev(`document.getElementById('progressText').textContent`), /1 of 4 done/);
  assert.match(await page.ev(`document.querySelector('#step2 .cup-line').textContent`), /kulhad, bagasse, areca leaf or paper without plastic lining/);
  assert.equal(await page.ev(sellerLinks('#step2')), sellers, 'the hub links to the same sellers');
  step('set up, one question per screen (back works), opens the hub: 4 stations, checklist 1 of 4');

  // Stations sheet: rename, busy spot, add a station; saves as you go.
  await page.ev(`document.getElementById('editStations').click()`);
  await page.ev(`{ const i = document.querySelector('#stationRows input[data-field=name]'); i.value = 'Main gate'; i.dispatchEvent(new Event('change', { bubbles: true })); }`);
  await waitFor(page, `document.getElementById('sheetSaved').textContent === 'Saved ✓'`);
  await page.ev(`document.querySelectorAll('#stationRows input[data-field=busy]')[1].click()`);
  await waitFor(page, `document.getElementById('stationsLine').textContent.includes('1 busy spot')`);
  await page.ev(`document.getElementById('addStation').click()`);
  await waitFor(page, `document.querySelectorAll('#stationRows li').length === 5`);
  await page.ev(`document.getElementById('closeSheet').click()`);
  assert.equal(await page.ev(`document.getElementById('stationsLine').textContent`), '5 stations · 1 busy spot · 2 runners');
  assert.equal(await page.ev(`document.getElementById('stationsNames').textContent`), 'Main gate, Station 2, Station 3, Station 4, Station 5');
  assert.equal(await page.ev(`document.querySelectorAll('#tab-setup .step > .art svg').length`), 4, 'each step has its illustration');
  step('stations sheet: rename, busy spot and add save as you go, in order');

  await page.ev(`document.getElementById('markOrdered').click()`);
  await waitFor(page, `document.getElementById('progressText').textContent.includes('2 of 4 done')`);
  assert.equal(await page.ev(`document.getElementById('step2').classList.contains('done')`), true);
  assert.deepEqual(page.errors, []);
  await page.close();
  step('checklist ticks itself: "Mark as ordered" completes step 2');

  // Without the key (another device): view only; edits refused by the API too.
  const viewer = await open(`${WEB}/index.html`);
  await viewer.ev(`localStorage.removeItem('qs-my-events')`);
  await viewer.ev(`location.href = '/event.html?e=${eventId}'`);
  await sleep(1500);
  await waitFor(viewer, `document.getElementById('stationsLine').textContent !== ''`);
  assert.equal(await viewer.ev(`document.getElementById('viewOnly').hidden`), false);
  assert.equal(await viewer.ev(`document.getElementById('editStations').disabled`), true);
  const refused = await fetch(`${API}/events/${eventId}`, { method: 'PATCH', headers: { 'content-type': 'application/json', 'x-organiser-key': 'x'.repeat(24) }, body: '{"runnerTripMin":5}' }).catch(() => null);
  if (refused) assert.equal(refused.status, 403);
  // Opening the organiser link again restores editing and "My events".
  await viewer.ev(`location.href = '/event.html?e=${eventId}#k=${orgKey}'`);
  await sleep(300);
  await viewer.ev(`location.reload()`);
  await sleep(1500);
  await waitFor(viewer, `!document.getElementById('editStations').disabled`);
  await viewer.ev(`location.href = '/index.html'`);
  await sleep(1200);
  assert.match(await viewer.ev(`document.getElementById('eventList').textContent`), /Spring Fest/);
  await viewer.close();
  step('without the organiser link the hub is view only; with it, editing works and the event is in "My events"');

  const qr = await open(`${WEB}/qr.html?e=${eventId}#k=${orgKey}`);
  assert.equal(await qr.ev(`document.querySelectorAll('#grid .qr-card svg').length`), 5);
  assert.equal(await qr.ev(`document.querySelectorAll('#runnerGrid .qr-card svg').length`), 2, 'one card per runner too');
  const cards = await qr.ev(`[...document.querySelectorAll('#grid .qr-card')].map(c => ({ name: c.querySelector('.station-name').textContent, url: c.querySelector('.small:last-child').textContent }))`);
  assert.ok(cards.every((c) => /[?&]t=[a-z0-9]{16}$/.test(c.url)), 'every QR link carries its own token');
  await qr.close();
  step('QR sheet has one code per station, each link with its own token');

  for (const card of cards) {
    const v = await open(card.url);
    assert.equal(await v.ev(`document.getElementById('station').textContent`), card.name);
    await v.close();
  }
  step('each QR link opens the matching volunteer station');

  // Volunteer's first visit: a short card once, then never again on this phone.
  const first = await open(cards[0].url);
  await waitFor(first, `!document.getElementById('intro').hidden`);
  assert.match(await first.ev(`document.getElementById('introTitle').textContent`), new RegExp(cards[0].name));
  assert.equal(await first.ev(`document.getElementById('buttons').hidden`), true, 'first visit: only the intro');
  await first.ev(`document.getElementById('introOk').click()`);
  assert.equal(await first.ev(`document.getElementById('intro').hidden`), true);
  await waitFor(first, `!document.getElementById('stockCard').hidden`);
  assert.equal(await first.ev(`document.getElementById('taps').hidden`), true, 'then only the stock count');
  await first.ev(`document.getElementById('skipStock').click()`);
  await waitFor(first, `!document.getElementById('taps').hidden`);
  assert.equal(await first.ev(`document.getElementById('stockCard').hidden`), true, 'skipping shows the buttons');
  assert.equal(await first.ev(`document.getElementById('countLater').hidden`), false, 'with a "not counted yet" reminder');
  await first.ev('location.reload()');
  await sleep(1500);
  await waitFor(first, `document.getElementById('station').textContent === ${JSON.stringify(cards[0].name)}`);
  assert.equal(await first.ev(`document.getElementById('intro').hidden`), true, 'not shown again');
  await first.close();
  step('volunteer: intro once, then the stock count, then the buttons (count can be skipped)');

  // Hub Live tab before the start: one calm "waiting for the count" card, no alarms.
  const liveTab = await open(`${WEB}/event.html?e=${eventId}&tab=live`);
  await waitFor(liveTab, `document.querySelector('#tiles .pre-start') !== null`);
  assert.match(await liveTab.ev(`document.querySelector('#tiles .pre-start').textContent`), /0 of 5 stations counted/);
  assert.equal(await liveTab.ev(`document.querySelectorAll('#tiles .tile').length`), 0);
  assert.equal(await liveTab.ev(`document.getElementById('tabBtn-live').getAttribute('aria-selected')`), 'true');
  await liveTab.close();
  step('hub Live tab before the start: one calm card instead of an alarm per station');

  // Step 3: volunteer taps
  const stationId = new URL(cards[0].url).searchParams.get('s');
  const counts = async () => (await apiCall('GET', `${API}/events/${eventId}`)).stations.find((s) => s.id === stationId);
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

  // Hindi switch covers every volunteer button and status line, then back to English.
  const hiPage = await open(cards[0].url);
  await waitFor(hiPage, `document.getElementById('syncState').textContent !== ''`);
  await hiPage.ev(`document.getElementById('lang').click()`);
  await waitFor(hiPage, `document.getElementById('syncState').textContent.includes('टैप')`);
  const hi = await hiPage.ev(`[...document.querySelectorAll('button.tap .tap-title'), document.getElementById('syncState')].map(e => e.textContent)`);
  assert.deepEqual(hi.slice(0, 3), ['जार बदला', 'आख़िरी जार', 'कप कम हैं']);
  assert.match(hi[3], /टैप/);
  assert.equal(await hiPage.ev('document.documentElement.lang'), 'hi');
  await hiPage.ev(`document.getElementById('lang').click()`);
  assert.equal(await hiPage.ev(`document.querySelector('button.tap .tap-title').textContent`), 'Jar swapped');
  await hiPage.close();
  step('Hindi switch translates every volunteer button and the status line');

  // Step 4: offline queue
  const sid2 = new URL(cards[1].url).searchParams.get('s');
  const tok2 = new URL(cards[1].url).searchParams.get('t');
  const counts2 = async () => (await apiCall('GET', `${API}/events/${eventId}`)).stations.find((s) => s.id === sid2);
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
  // Leave the page while still offline (closing the tab directly can end the offline simulation first and flush).
  await off.ev(`location.href = 'about:blank'`);
  await sleep(500);
  assert.equal((await counts2()).cupsLowCount, undefined, 'the waiting tap has not been sent');
  await off.close();
  const reopened = await open(cards[1].url);
  await waitFor(reopened, `${sync} === 'All taps sent.'`);
  assert.equal((await counts2()).cupsLowCount, 1);
  assert.equal((await counts2()).swapCount, 2, 'reopening does not resend old taps');
  await reopened.close();
  step('tab closed mid-queue: the waiting tap survives and is sent on reopen');

  // Page opens with no signal: its own local web server (stopped mid-test) + service worker cache.
  // Local runs only: it needs the local API for the station name.
  if (!process.env.WEB_URL) {
    // Page opens with no signal: its own web server (stopped mid-test) + service worker cache.
    const SW_PORT = 8091;
    const webDir = new URL('../web/', import.meta.url).pathname;
    const staticServer = spawn('python3', ['-m', 'http.server', String(SW_PORT), '-d', webDir], { stdio: 'ignore' });
    await sleep(1000);
    const swUrl = `http://localhost:${SW_PORT}/v.html?e=${eventId}&s=${sid2}&t=${tok2}`;
    const sw = await open(swUrl);
    await waitFor(sw, 'navigator.serviceWorker.controller !== null', 8000);
    await new Promise((r) => { staticServer.once('exit', r); staticServer.kill(); });
    await sw.setOffline(true);
    await sw.ev('location.reload()');
    await sleep(2000);
    assert.equal(await sw.ev(`document.getElementById('station').textContent`), cards[1].name);
    assert.match(await sw.ev(`document.getElementById('feedback').textContent`), /No signal right now/);
    // A new address has its own storage, so the intro shows first here.
    await sw.ev(`document.getElementById('intro').hidden || document.getElementById('introOk').click()`);
    assert.equal(await sw.ev(`document.getElementById('buttons').hidden`), false);
    await sw.close();
    step('page opens with no signal (service worker + saved station name)');
  } else {
    console.log('skip - page opens with no signal (local runs only)');
  }

  // L3: the server fails (500). The tap waits on the phone and is delivered once the server recovers.
  const broken = await open(cards[1].url);
  await waitFor(broken, `document.getElementById('syncState').textContent !== ''`);
  const before = (await counts2()).cupsLowCount || 0;
  await broken.setServerError(true);
  await broken.ev(`document.querySelector('[data-type="cups_low"]').click()`);
  await waitFor(broken, `document.getElementById('syncState').textContent.startsWith('1 tap saved')`);
  await sleep(1500);
  assert.equal((await counts2()).cupsLowCount || 0, before, 'not stored while the server fails');
  await broken.setServerError(false);
  await waitFor(broken, `document.getElementById('syncState').textContent === 'All taps sent.'`, 40000);
  assert.equal((await counts2()).cupsLowCount, before + 1, 'delivered exactly once after recovery');
  await broken.close();
  step('server errors: the tap waits on the phone and is sent once the server recovers');

  // Live board: an event that started 30 minutes ago.
  // 1,000 people in one zone, 3 stations: ~83 L/hr each at the low rate -> quiet after 22 min.
  const post = async (path, body, headers) => {
    const out = await apiCall('POST', `${API}${path}`, body, headers);
    if (path === '/events' && out?.id) createdEvents.push(out.id);
    return out;
  };
  // Test events use PIN 2468; the organiser's view includes each station's and runner's link token.
  const orgView = (id) => apiCall('GET', `${API}/events/${id}`, undefined, { 'x-organiser-pin': '2468' });
  const asPhone = (item) => ({ 'x-access-token': item.token });
  const live = await post('/events', {
    name: 'Board Test',
    startsAt: new Date(Date.now() - 30 * 60000).toISOString(),
    attendees: 1000,
    startHour: 0,
    hourCount: 3,
    litresPerPersonHr: { low: 0.25, high: 0.5 },
    share: { Field: [1, 1, 1] },
    stations: [{ name: 'Alpha', zone: 'Field' }, { name: 'Bravo', zone: 'Field' }, { name: 'Charlie', zone: 'Field' }, { name: 'Delta', zone: 'Field' }],
    pin: '2468',
  });
  const liveStations = (await orgView(live.id)).stations;
  const stationOf = (name) => liveStations.find((s) => s.name === name);
  const sidOf = (name) => stationOf(name).id;
  const tapApi = (name, type, deviceTs = new Date().toISOString(), extra = {}) => post(`/events/${live.id}/stations/${sidOf(name)}/taps`, { uuid: crypto.randomUUID(), type, deviceTs, ...extra }, asPhone(stationOf(name)));
  // Every station confirmed 10 jars at the start (~96 min of water at the plan's busy rate).
  for (const name of ['Alpha', 'Bravo', 'Charlie', 'Delta']) await tapApi(name, 'stocked', live.startsAt ?? new Date(Date.now() - 30 * 60000).toISOString(), { jars: 10, cups: 500 });
  await tapApi('Bravo', 'last_jar');
  await tapApi('Charlie', 'swap');
  // 250 people per station at 0.25 L/hr -> 19.2 min per jar -> quiet after 29 min. Delta tapped 20 s short of that.
  await tapApi('Delta', 'swap', new Date(Date.now() - (29 * 60 - 20) * 1000).toISOString());

  const board = await open(`${WEB}/board.html?e=${live.id}`);
  const tiles = `[...document.querySelectorAll('.tile')].map(t => t.querySelector('.tile-name').textContent + ': ' + t.querySelector('.tile-status').textContent)`;
  await waitFor(board, `document.querySelectorAll('.tile').length === 4`);
  assert.deepEqual(await board.ev(tiles), ['Bravo: Needs jars now', 'Alpha: No taps: check on volunteer', 'Charlie: OK', 'Delta: OK']);
  assert.match(await board.ev(`document.getElementById('clock').textContent`), /^Live/);
  assert.equal(await board.ev(`document.querySelectorAll('.tile .st-icon svg').length`), 4, 'every tile has a drawn status icon');
  assert.equal(await board.ev(`[...document.querySelectorAll('#legend .chip')].map((c) => c.textContent.trim()).join(' | ')`), 'Needs jars now | Not stocked | No taps | Cups low | OK', 'one compact legend row');
  assert.doesNotMatch(await board.ev(`document.getElementById('tiles').textContent + document.getElementById('summary').textContent`), /[●◐◌▲]/, 'no text glyphs');
  step('board: needs-jars first, silent station flagged, active station OK');

  await waitFor(board, `${tiles}.includes('Delta: No taps: check on volunteer')`, 30000);
  step('status changes on the board with nobody tapping (Delta went quiet)');

  // After the start, stations nobody has counted are one card with their names, not a wall of red tiles.
  const late = await post('/events', {
    name: 'Late Count', startsAt: new Date(Date.now() - 10 * 60000).toISOString(), attendees: 600, startHour: 0, hourCount: 2,
    litresPerPersonHr: { low: 0.25, high: 0.5 }, share: { Field: [1, 1] }, pin: '2468',
    stations: [{ name: 'Food', zone: 'Field' }, { name: 'Gate', zone: 'Field' }, { name: 'Stage', zone: 'Field' }],
  });
  const lateBoard = await open(`${WEB}/board.html?e=${late.id}`);
  await waitFor(lateBoard, `document.querySelector('.not-counted') !== null`);
  assert.match(await lateBoard.ev(`document.querySelector('.not-counted').textContent`), /3 stations not counted yet: Food, Gate, Stage/);
  assert.equal(await lateBoard.ev(`document.querySelectorAll('.tile').length`), 0, 'no per-station red tiles');
  await lateBoard.close();
  const emptySummary = await open(`${WEB}/summary.html?e=${late.id}`);
  await waitFor(emptySummary, `document.getElementById('summaryEmpty') !== null`);
  assert.match(await emptySummary.ev(`document.getElementById('summaryEmpty').textContent`), /Fills in during the event/);
  assert.doesNotMatch(await emptySummary.ev(`document.getElementById('mount').textContent`), /0–0 kg/, 'no page of zeros');
  await emptySummary.close();
  step('after the start, uncounted stations are one card with their names; an empty summary says it fills in later');

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

  // L2: a board with 20 stations loads quickly on a 4G-like connection.
  const big = await post('/events', {
    name: 'Board Test', startsAt: new Date(Date.now() - 5 * 60000).toISOString(), attendees: 10000, startHour: 0, hourCount: 3,
    litresPerPersonHr: { low: 0.25, high: 0.5 }, share: { Field: [1, 1, 1] },
    stations: Array.from({ length: 20 }, (_, i) => ({ name: `Station ${i + 1}`, zone: 'Field' })), pin: '2468',
  });
  // Every station counted, so the board draws 20 real tiles (uncounted ones would fold into one card).
  for (const st of (await orgView(big.id)).stations) {
    await post(`/events/${big.id}/stations/${st.id}/taps`, { uuid: crypto.randomUUID(), type: 'stocked', jars: 8, cups: 400, deviceTs: new Date().toISOString() }, asPhone(st));
  }
  const slow = await open('about:blank');
  await slow.send('Network.enable');
  // ~4G: 50 ms latency, 4 Mbit/s down, 1 Mbit/s up.
  await slow.send('Network.emulateNetworkConditions', { offline: false, latency: 50, downloadThroughput: 500000, uploadThroughput: 125000 });
  const t0 = Date.now();
  await slow.send('Page.navigate', { url: `${WEB}/board.html?e=${big.id}` });
  await waitFor(slow, `document.querySelectorAll('.tile').length === 20`, 10000);
  const boardMs = Date.now() - t0;
  await slow.close();
  assert.ok(boardMs < 2000, `board took ${boardMs} ms`);
  step(`board with 20 stations ready in ${(boardMs / 1000).toFixed(1)} s on a 4G-like connection (gate: under 2 s)`);

  // Start-of-event stock check: 3 stations, 2 confirmed by API, the third through the volunteer screen.
  const pre = await post('/events', {
    name: 'Stock Test',
    startsAt: new Date(Date.now() + 20 * 60000).toISOString(), // gates open in 20 min
    attendees: 1000, startHour: 0, hourCount: 3,
    litresPerPersonHr: { low: 0.25, high: 0.5 }, share: { Field: [1, 1, 1] },
    stations: [{ name: 'North', zone: 'Field' }, { name: 'South', zone: 'Field' }, { name: 'West', zone: 'Field' }],
    pin: '2468',
  });
  const preStations = (await orgView(pre.id)).stations;
  const preStation = (name) => preStations.find((s) => s.name === name);
  const preSid = (name) => preStation(name).id;
  for (const name of ['North', 'South']) {
    await post(`/events/${pre.id}/stations/${preSid(name)}/taps`, { uuid: crypto.randomUUID(), type: 'stocked', jars: 8, cups: 400, deviceTs: new Date().toISOString() }, asPhone(preStation(name)));
  }
  const preBoard = await open(`${WEB}/board.html?e=${pre.id}`);
  await waitFor(preBoard, `document.querySelectorAll('.tile').length === 2`);
  assert.deepEqual(await preBoard.ev(tiles), ['North: OK', 'South: OK']);
  assert.match(await preBoard.ev(`document.querySelector('.pre-start').textContent`), /2 of 3 stations counted[\s\S]*Waiting for: West/);
  assert.match(await preBoard.ev(`document.getElementById('clock').textContent`), /^Starts at/);
  step('start gate: before the start, exactly the uncounted station is listed, in one calm card');

  const westPhone = await open(`${WEB}/v.html?e=${pre.id}&s=${preSid('West')}&t=${preStation('West').token}`);
  assert.equal(await westPhone.ev(`document.getElementById('stockCard').hidden`), false);
  assert.match(await westPhone.ev(`document.getElementById('stockHint').textContent`), /plan expects about \d+–\d+ jars/);
  await westPhone.ev(`document.getElementById('stockJars').value = '6'; document.getElementById('stockCups').value = '300'; document.getElementById('stockCard').requestSubmit();`);
  // "All taps sent." is also true before the tap exists, so first wait for the saved message.
  await waitFor(westPhone, `document.getElementById('feedback').textContent.startsWith('Saved: 6 jars and 300 cups')`);
  await waitFor(westPhone, `document.getElementById('stockCard').hidden && document.getElementById('syncState').textContent === 'All taps sent.'`);
  assert.match(await westPhone.ev(`document.getElementById('stockSummary').textContent`), /^Stocked at .*: 6 jars, 300 cups$/);
  await westPhone.close();
  await waitFor(preBoard, `${tiles}.includes('West: OK') && !document.querySelector('.pre-start')`, 10000);
  assert.match(await preBoard.ev(`[...document.querySelectorAll('.tile')].find(t => t.textContent.includes('West')).textContent`), /6 jars left/);
  await preBoard.close();
  step('volunteer confirms stock on the phone; board clears the flag and shows jars left');

  // Runner dispatch: "Last jar" -> job on the runner's phone -> on my way -> delivered -> station restocked.
  const disp = await post('/events', {
    name: 'Dispatch Test',
    startsAt: new Date(Date.now() - 10 * 60000).toISOString(),
    // 200 people at 0.5 L/hr -> 12 min per jar: the last jar runs dry in ~2 min, 5 jars last ~50 min.
    attendees: 200, startHour: 0, hourCount: 3, runnerTripMin: 10,
    litresPerPersonHr: { low: 0.25, high: 0.5 }, share: { Field: [1, 1, 1] },
    stations: [{ name: 'North', zone: 'Field' }],
    runners: [{ name: 'Asha' }],
    pin: '2468',
  });
  const dispData = await orgView(disp.id);
  const northId = dispData.stations[0].id;
  const ashaId = dispData.runners[0].id;
  // Stocked a minute before the gates opened.
  await post(`/events/${disp.id}/stations/${northId}/taps`, { uuid: crypto.randomUUID(), type: 'stocked', jars: 10, cups: 400, deviceTs: new Date(Date.now() - 11 * 60000).toISOString() }, asPhone(dispData.stations[0]));
  const runnerPage = await open(`${WEB}/r.html?e=${disp.id}&r=${ashaId}&t=${dispData.runners[0].token}`);
  await waitFor(runnerPage, `!document.getElementById('idle').hidden`);
  const dispBoard = await open(`${WEB}/board.html?e=${disp.id}`);

  await post(`/events/${disp.id}/stations/${northId}/taps`, { uuid: crypto.randomUUID(), type: 'last_jar', deviceTs: new Date().toISOString() }, asPhone(dispData.stations[0]));
  await waitFor(runnerPage, `!document.getElementById('job').hidden && document.getElementById('jobWhere').textContent === 'to North (Field)'`, 20000);
  assert.match(await runnerPage.ev(`document.getElementById('jobTitle').textContent`), /^Take \d+ jars?/);
  await waitFor(dispBoard, `document.querySelector('.tile .job-chip')?.textContent.startsWith('Asha: Runner assigned')`, 15000);
  step('"Last jar" sends a job to the runner\'s phone and shows it on the board');

  await runnerPage.ev(`document.getElementById('onMyWay').click()`);
  await waitFor(runnerPage, `document.getElementById('jobState').textContent === 'On your way'`, 15000);
  await waitFor(dispBoard, `document.querySelector('.tile .job-chip')?.textContent.startsWith('Asha: Runner on the way')`, 15000);
  step('runner taps "On my way"; the board shows it');

  await runnerPage.ev(`document.getElementById('deliveredJars').value = '4'; document.getElementById('deliveredForm').requestSubmit();`);
  await waitFor(runnerPage, `!document.getElementById('idle').hidden`, 15000);
  await waitFor(dispBoard, `!document.querySelector('.tile .job-chip') && document.querySelector('.tile .tile-status').textContent === 'OK'`, 15000);
  assert.match(await dispBoard.ev(`document.querySelector('.tile').textContent`), /5 jars left/); // last jar (1) + 4 delivered
  const north = (await apiCall('GET', `${API}/events/${disp.id}`)).stations[0];
  assert.equal(north.restocks.length, 1);
  assert.deepEqual([runnerPage.errors, dispBoard.errors], [[], []]);
  await runnerPage.close();
  await dispBoard.close();
  step('runner taps "Delivered": station restocked to 5 jars, board back to OK, runner free');

  const summary = await open(`${WEB}/summary.html?e=${disp.id}`);
  await waitFor(summary, `!document.getElementById('content').hidden`);
  assert.match(await summary.ev(`document.getElementById('formula').textContent`), /^0 jars swapped × 20 L = 0 L dispensed/);
  assert.match(await summary.ev(`document.getElementById('dispatch').textContent`), /1 of 1runner jobs delivered/);
  assert.match(await summary.ev(`document.getElementById('dry').textContent`), /1 of 1stations stocked before the start/);
  assert.deepEqual(summary.errors, []);
  await summary.close();
  step('summary shows water (with its formula), stocking and runner jobs');

  const again = await open(`${WEB}/plan.html?from=${disp.id}`);
  await waitFor(again, `document.getElementById('name').value === 'Dispatch Test'`);
  assert.equal(await again.ev(`document.getElementById('stations').textContent`), '1');
  assert.equal(await again.ev(`document.getElementById('runners').textContent`), '1');
  assert.match(await again.ev(`document.getElementById('createStatus').textContent`), /Started from "Dispatch Test"/);
  await again.close();
  step('"Use as next year\'s plan" starts the plan from this event');

  const bad = await open(`${WEB}/v.html?e=${eventId}&s=zzzzzz`);
  assert.match(await bad.ev(`document.getElementById('loadError').textContent`), /removed/);
  await bad.close();
  step('unknown station shows a clear message');

  // A copied link without its token: the public station id alone opens nothing.
  const noToken = await open(cards[0].url.replace(/&t=[a-z0-9]+/, ''));
  await waitFor(noToken, `document.getElementById('station').textContent === 'Link not valid'`);
  assert.match(await noToken.ev(`document.getElementById('loadError').textContent`), /not valid. Ask the organiser/);
  assert.equal(await noToken.ev(`document.getElementById('buttons').hidden`), true, 'no tap buttons');
  await noToken.close();
  const noTokenRunner = await open(`${WEB}/r.html?e=${disp.id}&r=${ashaId}`);
  await waitFor(noTokenRunner, `!document.getElementById('loadError').hidden`);
  assert.match(await noTokenRunner.ev(`document.getElementById('loadError').textContent`), /not valid/);
  await noTokenRunner.close();
  step('a link without its token (just the public id) is refused, for volunteers and runners');

  console.log('# e2e pass');
} catch (err) {
  console.error('not ok -', err.message);
  process.exitCode = 1;
} finally {
  // On AWS, delete exactly the events this run created, so their scheduled checks and runner jobs stop.
  if (process.env.WEB_URL && createdEvents.length) {
    await new Promise((r) => execFile('python3', ['scripts/clear_test_events.py', ...createdEvents.flatMap((id) => ['--id', id]), '--yes'], (err, out) => {
      console.log(err ? `# cleanup failed: ${err.message}` : `# cleanup: ${out.trim().split('\n').pop()}`);
      r();
    }));
  }
  // Wait for Chrome to exit before deleting its profile, or it may still be writing files.
  await new Promise((r) => { chrome.once('exit', r); chrome.kill(); setTimeout(r, 3000); });
  try { rmSync(profile, { recursive: true, force: true, maxRetries: 3 }); } catch {}
}
