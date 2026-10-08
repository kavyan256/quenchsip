import { api, param, escape } from './api.js';
import { TAP_TYPES, newTapId } from './core/tap.js';

const $ = (id) => document.getElementById(id);
const eventId = param('e');
const stationId = param('s');

// Two presses of the same button within this window are one tap (a real swap takes longer).
const DOUBLE_TAP_MS = 3000;
const lastPress = {};
const recent = [];

const time = (iso) => new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

function feedback(kind, html) {
  $('feedback').className = `feedback ${kind}`;
  $('feedback').innerHTML = html;
}

function renderRecent() {
  $('recent').innerHTML = recent.length
    ? recent.slice(0, 5).map((t) => `<li><span>${escape(TAP_TYPES[t.type])}</span><span class="small">${time(t.at)}${t.saved ? ' · saved' : ' · not saved'}</span></li>`).join('')
    : '<li class="small">None yet.</li>';
}

async function send(tap) {
  feedback('pending', `Saving <strong>${escape(TAP_TYPES[tap.type])}</strong>…`);
  try {
    await api('POST', `/events/${eventId}/stations/${stationId}/taps`, { body: { uuid: tap.uuid, type: tap.type, deviceTs: tap.at } });
    tap.saved = true;
    feedback('ok', `<strong>Saved:</strong> ${escape(TAP_TYPES[tap.type])} at ${time(tap.at)}`);
  } catch (err) {
    // Same tap id on retry, so it can never be counted twice.
    feedback('warn', `<strong>Not saved.</strong> ${escape(err.message)} <button type="button" class="ghost" id="retry">Try again</button>`);
    $('retry').addEventListener('click', () => send(tap), { once: true });
  }
  renderRecent();
}

$('buttons').addEventListener('click', (e) => {
  const button = e.target.closest('button.tap');
  if (!button) return;
  const type = button.dataset.type;
  const now = Date.now();
  if (now - (lastPress[type] || 0) < DOUBLE_TAP_MS) {
    feedback('ok', `Already counted that ${escape(TAP_TYPES[type]).toLowerCase()} tap.`);
    return;
  }
  lastPress[type] = now;
  if (navigator.vibrate) navigator.vibrate(30);
  const tap = { uuid: newTapId(), type, at: new Date(now).toISOString(), saved: false };
  recent.unshift(tap);
  send(tap);
});

async function load() {
  if (!eventId || !stationId) throw new Error('This link is incomplete. Scan the QR code at your station again.');
  const { event, stations } = await api('GET', `/events/${eventId}`);
  const station = stations.find((s) => s.id === stationId);
  if (!station) throw new Error('This station was removed. Ask the organiser for the new QR code.');
  document.title = `${station.name} · QuenchSip`;
  $('eventName').textContent = event.name;
  $('station').textContent = station.name;
  $('zone').textContent = `Zone: ${station.zone}`;
  $('buttons').hidden = false;
}

load().catch((err) => {
  $('station').textContent = 'Station not found';
  $('loadError').textContent = err.message;
  $('loadError').hidden = false;
});
