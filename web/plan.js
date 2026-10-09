import { planEvent, readiness } from './core/plan.js';
import { hourLabels as labelsFor } from './core/event.js';
import { api, savePin, escape, param } from './api.js';

const $ = (id) => document.getElementById(id);
const num = (id) => Number($(id).value) || 0;

let stations = [
  { id: 's1', name: 'Main gate', zone: 'Gate' },
  { id: 's2', name: 'Food court', zone: 'Food' },
  { id: 's3', name: 'Stage left', zone: 'Stage' },
  { id: 's4', name: 'Stage right', zone: 'Stage' },
];
let nextId = 5;
// share[zone][hour] in percent, kept across re-renders.
let share = {};

const zones = () => [...new Set(stations.map((s) => s.zone.trim() || 'Unnamed'))];

const hourLabels = () => labelsFor(num('startHour'), Math.max(1, num('hourCount')));

function renderStations() {
  $('stations').innerHTML = stations
    .map(
      (s, i) => `
      <div class="station-row">
        <label>Station name <input data-i="${i}" data-field="name" value="${escape(s.name)}"></label>
        <label>Zone <input data-i="${i}" data-field="zone" value="${escape(s.zone)}"></label>
        <button class="ghost" type="button" data-remove="${i}" aria-label="Remove ${escape(s.name)}">Remove</button>
      </div>`
    )
    .join('');
}

// Fills missing cells with an equal split; keeps anything the organiser typed.
function syncShare() {
  const zs = zones();
  const n = hourLabels().length;
  const even = Math.round(100 / zs.length);
  const next = {};
  for (const z of zs) {
    next[z] = Array.from({ length: n }, (_, h) => (share[z] && share[z][h] !== undefined ? share[z][h] : even));
  }
  share = next;
}

function renderShareTable() {
  const hours = hourLabels();
  const head = `<tr><th>Zone</th>${hours.map((h) => `<th>${h}</th>`).join('')}</tr>`;
  const body = zones()
    .map(
      (z) =>
        `<tr><td>${escape(z)}</td>${hours
          .map((_, h) => `<td><input type="number" min="0" max="100" data-zone="${escape(z)}" data-hour="${h}" value="${share[z][h]}" aria-label="${escape(z)} at ${hours[h]}, percent"></td>`)
          .join('')}</tr>`
    )
    .join('');
  $('shareTable').innerHTML = head + body;
}

function calculate() {
  const hours = hourLabels();
  const fractionShare = Object.fromEntries(Object.entries(share).map(([z, arr]) => [z, arr.map((p) => (Number(p) || 0) / 100)]));
  const plan = planEvent({
    attendees: num('attendees'),
    hours,
    stations: stations.map((s) => ({ ...s, zone: s.zone.trim() || 'Unnamed' })),
    share: fractionShare,
    litresPerPersonHr: { low: num('lphLow'), high: num('lphHigh') },
    heatFactor: Number($('heat').value),
  });
  const ready = readiness({
    attendees: num('attendees'),
    stationCount: stations.length,
    volunteerCount: num('volunteers'),
    jarSupplier: $('supplier').value === 'yes',
    signal: $('signal').value === 'yes',
  });

  const warnings = [...ready.warnings, ...plan.warnings];
  $('readiness').innerHTML = warnings.length
    ? `<div class="status warn"><strong>Fix before the event:</strong><ul>${warnings.map((w) => `<li>${escape(w)}</li>`).join('')}</ul></div>`
    : `<div class="status ok"><strong>Ready.</strong> Enough stations, volunteers, a supplier and signal.</div>`;

  const t = plan.total;
  $('totals').innerHTML = `
    <div><div class="big">${t.jarsLow}–${t.jarsHigh}</div><div class="small">20 L jars</div></div>
    <div><div class="big">${t.cupsLow.toLocaleString('en-IN')}–${t.cupsHigh.toLocaleString('en-IN')}</div><div class="small">cups (200 ml)</div></div>
    <div><div class="big">${Math.round(t.litresLow).toLocaleString('en-IN')}–${Math.round(t.litresHigh).toLocaleString('en-IN')}</div><div class="small">litres of water</div></div>`;

  const head = `<tr><th>Station</th>${hours.map((h) => `<th>${h}</th>`).join('')}<th>Total jars</th><th>Total cups</th></tr>`;
  const body = plan.rows
    .map(
      (r) =>
        `<tr><td>${escape(r.station.name)} <span class="small">(${escape(r.station.zone)})</span></td>${r.byHour
          .map((x) => `<td>${x.low.jars}–${x.high.jars}</td>`)
          .join('')}<td><strong>${r.total.jarsLow}–${r.total.jarsHigh}</strong></td><td>${r.total.cupsLow.toLocaleString('en-IN')}–${r.total.cupsHigh.toLocaleString('en-IN')}</td></tr>`
    )
    .join('');
  $('planTable').innerHTML = head + body;
}

function refreshAll() {
  syncShare();
  renderShareTable();
  calculate();
}

$('stations').addEventListener('input', (e) => {
  const i = e.target.dataset.i;
  if (i === undefined) return;
  stations[i][e.target.dataset.field] = e.target.value;
  if (e.target.dataset.field === 'zone') refreshAll();
  else calculate();
});

$('stations').addEventListener('click', (e) => {
  const i = e.target.dataset.remove;
  if (i === undefined || stations.length === 1) return;
  stations.splice(Number(i), 1);
  renderStations();
  refreshAll();
});

$('addStation').addEventListener('click', () => {
  stations.push({ id: `s${nextId}`, name: `Station ${nextId}`, zone: 'Gate' });
  nextId++;
  renderStations();
  refreshAll();
});

$('shareTable').addEventListener('input', (e) => {
  const { zone, hour } = e.target.dataset;
  if (zone === undefined) return;
  share[zone][Number(hour)] = Number(e.target.value) || 0;
  calculate();
});

for (const id of ['startHour', 'hourCount']) $(id).addEventListener('input', refreshAll);
for (const id of ['attendees', 'heat', 'lphLow', 'lphHigh', 'volunteers', 'supplier', 'signal']) {
  $(id).addEventListener('input', calculate);
  $(id).addEventListener('change', calculate);
}

// Event start in the organiser's own time zone, sent as an ISO time.
const startsAt = () => {
  const [y, m, d] = ($('date').value || '').split('-').map(Number);
  return y ? new Date(y, m - 1, d, num('startHour')).toISOString() : undefined;
};
{
  const today = new Date();
  $('date').value = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
}

// Save the plan as an event, then go to the organiser page.
$('createEvent').addEventListener('click', async () => {
  const status = $('createStatus');
  const pin = $('pin').value.trim();
  if (!/^\d{4,8}$/.test(pin)) {
    status.textContent = 'Choose a PIN of 4 to 8 digits. You need it to change the event later.';
    return;
  }
  $('createEvent').disabled = true;
  status.textContent = 'Saving…';
  try {
    const { id } = await api('POST', '/events', {
      body: {
        name: $('name').value,
        startsAt: startsAt(),
        attendees: num('attendees'),
        startHour: num('startHour'),
        hourCount: Math.max(1, num('hourCount')),
        heatFactor: Number($('heat').value),
        litresPerPersonHr: { low: num('lphLow'), high: num('lphHigh') },
        share: Object.fromEntries(Object.entries(share).map(([z, arr]) => [z, arr.map((p) => (Number(p) || 0) / 100)])),
        volunteerCount: num('volunteers'),
        runnerTripMin: num('runnerTrip') || 10,
        jarSupplier: $('supplier').value === 'yes',
        signal: $('signal').value === 'yes',
        stations: stations.map((s) => ({ name: s.name, zone: s.zone.trim() || 'Unnamed' })),
        runners: $('runners').value.split('\n').map((n) => n.trim()).filter(Boolean).map((name) => ({ name })),
        pin,
      },
    });
    savePin(id, pin);
    location.href = `event.html?e=${id}`;
  } catch (err) {
    status.textContent = err.message;
    $('createEvent').disabled = false;
  }
});

// "Use as next year's plan": start from an earlier event's settings (the date is left for the new event).
async function prefill(fromId) {
  const { event, stations: old, runners } = await api('GET', `/events/${fromId}`);
  $('name').value = event.name;
  $('attendees').value = event.attendees;
  $('startHour').value = event.startHour;
  $('hourCount').value = event.hourCount;
  $('lphLow').value = event.litresPerPersonHr.low;
  $('lphHigh').value = event.litresPerPersonHr.high;
  $('volunteers').value = event.volunteerCount ?? old.length;
  $('runnerTrip').value = event.runnerTripMin ?? 10;
  $('supplier').value = event.jarSupplier === false ? 'no' : 'yes';
  $('signal').value = event.signal === false ? 'no' : 'yes';
  const heat = [...$('heat').options].find((o) => Number(o.value) === event.heatFactor);
  if (heat) $('heat').value = heat.value;
  stations = old.map((s, i) => ({ id: `s${i + 1}`, name: s.name, zone: s.zone }));
  nextId = stations.length + 1;
  share = Object.fromEntries(Object.entries(event.share).map(([z, arr]) => [z, arr.map((f) => Math.round(f * 100))]));
  $('runners').value = (runners || []).map((r) => r.name).join('\n');
  $('createStatus').textContent = `Started from "${event.name}". Pick the new date and a PIN, then save.`;
}

renderStations();
refreshAll();
const fromId = param('from');
if (fromId) {
  prefill(fromId)
    .then(() => {
      renderStations();
      refreshAll();
    })
    .catch((err) => {
      $('createStatus').textContent = `Could not load the earlier event: ${err.message}`;
    });
}
