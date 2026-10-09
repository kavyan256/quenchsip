import { api, param } from './api.js';
import { boardMarkup } from './liveboard.js';

const $ = (id) => document.getElementById(id);
const eventId = param('e');
const POLL_MS = 5000;
const STALE_MS = 30000;

let data = null;
let lastOk = 0;

const time = (ms) => new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

function render() {
  if (!data) return;
  const now = Date.now();
  const { clockText, summaryHtml, tilesHtml } = boardMarkup(data, now, { wide: window.innerWidth >= 700 });
  $('clock').textContent = clockText;
  $('summary').innerHTML = summaryHtml;
  // Keep a folded "All good" group folded between refreshes.
  const wasOpen = document.querySelector('#tiles details.all-good')?.open;
  $('tiles').innerHTML = tilesHtml;
  const group = document.querySelector('#tiles details.all-good');
  if (group && wasOpen !== undefined) group.open = wasOpen;

  const age = now - lastOk;
  $('freshness').className = `freshness ${age > STALE_MS ? 'stale' : ''}`;
  $('freshness').textContent = age > STALE_MS ? `Not updating: last update ${time(lastOk)}. Check the internet connection.` : `Updated ${Math.max(0, Math.round(age / 1000))} s ago`;
}

async function poll() {
  try {
    data = await api('GET', `/events/${eventId}`);
    lastOk = Date.now();
    document.title = `${data.event.name} · Live board`;
    $('title').textContent = data.event.name;
    $('loadError').hidden = true;
  } catch (err) {
    if (!data) {
      $('loadError').textContent = err.message;
      $('loadError').hidden = false;
    }
  }
  render();
}

if (!eventId) {
  $('loadError').textContent = 'No event in the link.';
  $('loadError').hidden = false;
} else {
  $('back').href = `event.html?e=${eventId}`;
  poll();
  setInterval(poll, POLL_MS);
  setInterval(render, 1000); // keep "x min ago" and freshness current between polls
}
