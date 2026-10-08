import { api, escape, param } from './api.js';
import { boardView, ago, STATUS } from './core/board.js';

const $ = (id) => document.getElementById(id);
const eventId = param('e');
const POLL_MS = 5000;
const STALE_MS = 30000;

let data = null;
let lastOk = 0;

const time = (ms) => new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

function detail(t, now) {
  if (t.status === 'needs_jars') return `Last jar tapped ${ago(t.lastJarAt, now)}`;
  if (t.status === 'quiet') return t.lastTapAt ? `No taps for ${t.silentMin} min` : `No taps since the event started (${t.silentMin} min)`;
  if (t.status === 'cups_low') return `Cups low since ${ago(t.station.cupsLowAt, now)}`;
  return `Last tap ${ago(t.lastTapAt, now)}`;
}

function render() {
  if (!data) return;
  const now = Date.now();
  const view = boardView(data, now);
  const { clock } = view;

  $('clock').textContent = !clock.known
    ? 'Event time not set'
    : clock.live
      ? `Live · ${time(clock.start)}–${time(clock.end)}`
      : clock.beforeStart
        ? `Starts at ${time(clock.start)}`
        : `Ended at ${time(clock.end)}`;

  $('summary').innerHTML = Object.entries(STATUS)
    .filter(([k]) => view.summary[k] > 0)
    .map(([k, s]) => `<span class="chip st-${k}">${view.summary[k]} ${escape(s.label.split(':')[0].toLowerCase())}</span>`)
    .join('');

  $('tiles').innerHTML = view.tiles
    .map((t) => {
      const extra = t.status !== 'cups_low' && t.flags.cupsLow ? '<span class="chip st-cups_low">Cups low</span>' : '';
      const plan = t.plannedJarsPerHour ? `Plan: ${t.plannedJarsPerHour.low}–${t.plannedJarsPerHour.high} jars this hour` : '';
      return `<article class="tile st-${t.status}" aria-label="${escape(t.station.name)}: ${escape(t.label)}">
        <div class="tile-status">${escape(t.label)}</div>
        <div class="tile-name">${escape(t.station.name)}</div>
        <div class="small">${escape(t.station.zone)}</div>
        <div class="tile-detail">${escape(detail(t, now))}</div>
        <div class="small">Jars swapped: ${t.swapCount}${plan ? ` · ${plan}` : ''}</div>
        ${extra}
      </article>`;
    })
    .join('');

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
