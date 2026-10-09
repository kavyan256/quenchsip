import qrcode from './vendor/qrcode.mjs';
import { api, escape, param } from './api.js';

const $ = (id) => document.getElementById(id);
const eventId = param('e');

// The link the volunteer's phone opens. Uses this page's own host, so it works on Wi-Fi and after deploy.
const stationUrl = (sid) => new URL(`v.html?e=${eventId}&s=${sid}`, location.href).href;

function qrSvg(text) {
  const qr = qrcode(0, 'M');
  qr.addData(text);
  qr.make();
  return qr.createSvgTag({ cellSize: 4, margin: 2, scalable: true });
}

async function load() {
  if (!eventId) throw new Error('No event in the link.');
  const { event, stations } = await api('GET', `/events/${eventId}`);
  $('title').textContent = `${event.name}: station QR codes`;
  $('back').href = `event.html?e=${eventId}`;
  $('grid').innerHTML = stations
    .map((s) => {
      const url = stationUrl(s.id);
      return `<div class="qr-card">
        <div class="small">Quench water station</div>
        <div class="station-name">${escape(s.name)}</div>
        <div class="small">Zone: ${escape(s.zone)}</div>
        ${qrSvg(url)}
        <div class="small">Scan to open this station</div>
        <div class="small">${escape(url)}</div>
      </div>`;
    })
    .join('');
}

$('print').addEventListener('click', () => window.print());
load().catch((err) => {
  $('loadError').textContent = err.message;
  $('loadError').hidden = false;
});
