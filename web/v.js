import { api, param } from './api.js';

const $ = (id) => document.getElementById(id);
const eventId = param('e');
const stationId = param('s');

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
