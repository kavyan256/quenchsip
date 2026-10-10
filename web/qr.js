import qrcode from './vendor/qrcode.js';
import { api, escape, param } from './api.js';
import { organiserKey } from './store.js';

const $ = (id) => document.getElementById(id);
const eventId = param('e');
const key = organiserKey(eventId);

// The link the volunteer's phone opens. Uses this page's own host, so it works on Wi-Fi and after deploy.
// Each link carries its station's or runner's token, which only the organiser's view of the event includes.
const link = (page, idParam, item) => new URL(`${page}?e=${eventId}&${idParam}=${item.id}${item.token ? `&t=${item.token}` : ''}`, location.href).href;
const stationUrl = (s) => link('v.html', 's', s);
const runnerUrl = (r) => link('r.html', 'r', r);

function qrSvg(text) {
  const qr = qrcode(0, 'M');
  qr.addData(text);
  qr.make();
  return qr.createSvgTag({ cellSize: 4, margin: 2, scalable: true });
}

async function load() {
  if (!eventId) throw new Error('No event in the link.');
  if (!key) throw new Error('Open the QR sheet from your organiser link: volunteer and runner codes are private.');
  const { event, stations, runners } = await api('GET', `/events/${eventId}`, { key });
  $('title').textContent = `${event.name}: station QR codes`;
  $('back').href = `event.html?e=${eventId}#k=${key}`;
  $('grid').innerHTML = stations
    .map((s) => {
      const url = stationUrl(s);
      return `<div class="qr-card">
        <div class="small">Quench water station</div>
        <div class="station-name">${escape(s.name)}</div>
        ${s.zone ? `<div class="small">Zone: ${escape(s.zone)}</div>` : ''}
        ${qrSvg(url)}
        <div class="small">Scan to open this station</div>
        <div class="small">${escape(url)}</div>
      </div>`;
    })
    .join('');
  // Runner cards: each runner scans theirs once to open their job screen.
  $('runnerGrid').innerHTML = (runners || [])
    .map((r) => {
      const url = runnerUrl(r);
      return `<div class="qr-card">
        <div class="small">Quench runner</div>
        <div class="station-name">${escape(r.name)}</div>
        ${qrSvg(url)}
        <div class="small">Scan to see your jobs</div>
        <div class="small">${escape(url)}</div>
      </div>`;
    })
    .join('');
  $('runnerSection').hidden = !(runners || []).length;
}

$('print').addEventListener('click', () => window.print());
load().catch((err) => {
  $('loadError').textContent = err.message;
  $('loadError').hidden = false;
});
