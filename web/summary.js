import { api, escape, param } from './api.js';
import { stationsCsv } from './core/summary.js';

const $ = (id) => document.getElementById(id);
const eventId = param('e');
const n = (x) => Number(x).toLocaleString('en-IN');
const stat = (big, label) => `<div><div class="big">${big}</div><div class="small">${escape(label)}</div></div>`;

async function load() {
  if (!eventId) throw new Error('No event in the link.');
  const s = await api('GET', `/events/${eventId}/summary`);
  document.title = `${s.event.name} · Summary · Quench`;
  $('title').textContent = `${s.event.name}: summary`;
  $('subtitle').textContent = s.event.startsAt
    ? `${new Date(s.event.startsAt).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })} · ${s.event.hourCount} h · ${n(s.event.attendees)} people expected`
    : `${n(s.event.attendees)} people expected`;
  $('back').href = `event.html?e=${eventId}`;
  $('template').href = `plan.html?from=${eventId}`;

  $('water').innerHTML =
    stat(`${n(s.water.litres)} L`, 'water dispensed') +
    stat(`up to ${n(s.water.bottlesUpTo)}`, 'plastic bottles (500 ml) not bought') +
    stat(`${s.water.petKg.low}–${s.water.petKg.high} kg`, 'PET plastic avoided, at most');
  $('formula').textContent = s.water.formula;

  $('dry').innerHTML =
    stat(`${s.totals.stockedBeforeStart} of ${s.totals.stations}`, 'stations stocked before the start') +
    stat(`${s.totals.stationsThatRanDry}`, 'stations that ran dry') +
    stat(`${n(s.totals.dryMinutes)} min`, 'dry minutes in total');

  const d = s.dispatch;
  $('dispatch').innerHTML =
    stat(`${d.delivered} of ${d.jobs}`, 'runner jobs delivered') +
    stat(`${n(d.jarsDelivered)}`, 'jars delivered by runners') +
    stat(d.medianMinutesToDeliver === null ? '–' : `${d.medianMinutesToDeliver} min`, 'typical time from alert to delivery (median)') +
    stat(d.medianMinutesToOnMyWay === null ? '–' : `${d.medianMinutesToOnMyWay} min`, 'typical time for a runner to set off (median)');

  $('stations').innerHTML =
    '<tr><th>Station</th><th>Jars swapped</th><th>Litres</th><th>Dry min</th><th>Stocked before start</th><th>Last-jar taps</th><th>Restocks (jars)</th></tr>' +
    s.stations
      .map((r) => `<tr><td>${escape(r.name)} <span class="small">(${escape(r.zone)})</span></td><td>${r.swaps}</td><td>${n(r.litres)}</td><td>${r.dryMinutes}</td><td>${r.stockedBeforeStart ? 'yes' : 'no'}</td><td>${r.lastJarTaps}</td><td>${r.restocks} (${r.jarsDelivered})</td></tr>`)
      .join('');

  $('csv').onclick = () => {
    const url = URL.createObjectURL(new Blob([stationsCsv(s)], { type: 'text/csv' }));
    const a = Object.assign(document.createElement('a'), { href: url, download: `${s.event.name.replace(/[^\w-]+/g, '_')}_stations.csv` });
    a.click();
    URL.revokeObjectURL(url);
  };
  $('print').onclick = () => window.print();
  $('content').hidden = false;
}

load().catch((err) => {
  $('loadError').textContent = err.message;
  $('loadError').hidden = false;
});
