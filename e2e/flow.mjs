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
  return { ev, errors, close: async () => { ws.close(); await fetch(`http://127.0.0.1:${PORT}/json/close/${tab.id}`); } };
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

  const bad = await open(`${WEB}/v.html?e=${eventId}&s=zzzzzz`);
  assert.match(await bad.ev(`document.getElementById('loadError').textContent`), /removed/);
  await bad.close();
  step('unknown station shows a clear message');

  console.log('# e2e pass');
} catch (err) {
  console.error('not ok -', err.message);
  process.exitCode = 1;
} finally {
  chrome.kill();
  rmSync(profile, { recursive: true, force: true });
}
