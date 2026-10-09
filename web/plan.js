// Set up: one typed field (the name); everything else is a tap with a sensible default.
import { api, param } from './api.js';
import { rememberEvent } from './store.js';
import { DEFAULT_LITRES_PER_PERSON_HR, JAR_LITRES, CUP_LITRES, PEOPLE_PER_OUTLET } from './core/plan.js';

const $ = (id) => document.getElementById(id);
const HOT_FACTOR = 1.3;
const TEMPLATES = {
  fest: { people: 3000, hours: 4, hot: false },
  run: { people: 5000, hours: 3, hot: true },
  concert: { people: 10000, hours: 4, hot: false },
};

// Steppers follow the crowd size until the organiser changes them by hand.
const counts = { stations: 4, runners: 2 };
const touched = { stations: false, runners: false };
// Carried over from an earlier event ("Use as next year's plan").
let carried = { stations: null, runners: null };

const people = () => Math.max(1, Math.round(Number($('people').value) || 0));
const hours = () => Number(document.querySelector('input[name="hours"]:checked').value);
const nf = (n) => n.toLocaleString('en-IN');

const suggestedStations = (p) => Math.max(2, Math.ceil(p / PEOPLE_PER_OUTLET));
const suggestedRunners = (s) => Math.max(1, Math.ceil(s / 3));

function update() {
  if (!touched.stations && !carried.stations) counts.stations = Math.min(50, suggestedStations(people()));
  if (!touched.runners && !carried.runners) counts.runners = Math.min(30, suggestedRunners(counts.stations));
  $('stations').value = $('stations').textContent = counts.stations;
  $('runners').value = $('runners').textContent = counts.runners;

  const heat = $('hot').checked ? HOT_FACTOR : 1;
  const litres = (rate) => people() * rate * heat * hours();
  const low = litres(DEFAULT_LITRES_PER_PERSON_HR.low);
  const high = litres(DEFAULT_LITRES_PER_PERSON_HR.high);
  $('order').textContent = `Order about ${nf(Math.ceil(low / JAR_LITRES))}–${nf(Math.ceil(high / JAR_LITRES))} jars and ${nf(Math.ceil(low / CUP_LITRES))}–${nf(Math.ceil(high / CUP_LITRES))} cups`;
  $('basis').textContent = `1 station per ${PEOPLE_PER_OUTLET} people · ${DEFAULT_LITRES_PER_PERSON_HR.low}–${DEFAULT_LITRES_PER_PERSON_HR.high} L per person per hour${heat > 1 ? ' (+30% hot day)' : ''} · 20 L jars, 200 ml cups`;
}

function setPeople(n) {
  $('people').value = n;
  for (const r of document.querySelectorAll('input[name="people"]')) r.checked = Number(r.value) === n;
  update();
}

function step(which, delta, max) {
  touched[which] = true;
  carried[which] = null;
  counts[which] = Math.min(max, Math.max(1, counts[which] + delta));
  update();
}

// Next full hour, local time.
function defaultStart() {
  const d = new Date();
  d.setHours(d.getHours() + 1, 0, 0, 0);
  $('start').value = `${String(d.getHours()).padStart(2, '0')}:00`;
}

function eventStart() {
  const [hh, mm] = ($('start').value || '17:00').split(':').map(Number);
  const choice = document.querySelector('input[name="day"]:checked').value;
  let d = new Date();
  if (choice === 'tomorrow') d.setDate(d.getDate() + 1);
  if (choice === 'pick' && $('date').value) {
    const [y, m, day] = $('date').value.split('-').map(Number);
    d = new Date(y, m - 1, day);
  }
  d.setHours(hh, mm || 0, 0, 0);
  return d;
}

document.querySelectorAll('input[name="people"]').forEach((r) => r.addEventListener('change', () => setPeople(Number(r.value))));
$('people').addEventListener('input', () => {
  for (const r of document.querySelectorAll('input[name="people"]')) r.checked = Number(r.value) === people();
  update();
});
document.querySelectorAll('input[name="hours"]').forEach((r) => r.addEventListener('change', update));
$('hot').addEventListener('change', update);
document.querySelectorAll('input[name="day"]').forEach((r) =>
  r.addEventListener('change', () => {
    $('date').hidden = r.value !== 'pick' || !r.checked;
    if (!$('date').hidden) $('date').focus();
  })
);
$('stationsMinus').addEventListener('click', () => step('stations', -1, 50));
$('stationsPlus').addEventListener('click', () => step('stations', 1, 50));
$('runnersMinus').addEventListener('click', () => step('runners', -1, 30));
$('runnersPlus').addEventListener('click', () => step('runners', 1, 30));

document.querySelectorAll('[data-template]').forEach((b) =>
  b.addEventListener('click', () => {
    const t = TEMPLATES[b.dataset.template];
    document.querySelectorAll('[data-template]').forEach((x) => x.classList.toggle('on', x === b));
    for (const r of document.querySelectorAll('input[name="hours"]')) r.checked = Number(r.value) === t.hours;
    $('hot').checked = t.hot;
    touched.stations = touched.runners = false;
    setPeople(t.people);
    if (!$('name').value) $('name').focus();
  })
);

$('name').addEventListener('input', () => {
  $('nameError').hidden = true;
  $('name').removeAttribute('aria-invalid');
});

$('setup').addEventListener('submit', async (e) => {
  e.preventDefault();
  const name = $('name').value.trim();
  if (!name) {
    $('nameError').hidden = false;
    $('name').setAttribute('aria-invalid', 'true');
    $('name').focus();
    return;
  }
  const start = eventStart();
  const stations =
    carried.stations && carried.stations.length === counts.stations
      ? carried.stations
      : Array.from({ length: counts.stations }, (_, i) => carried.stations?.[i] || { name: `Station ${i + 1}` });
  const runners = Array.from({ length: counts.runners }, (_, i) => carried.runners?.[i] || { name: `Runner ${i + 1}` });

  $('create').disabled = true;
  $('create').textContent = 'Creating…';
  try {
    const { id, key } = await api('POST', '/events', {
      body: {
        name,
        attendees: people(),
        startsAt: start.toISOString(),
        startHour: start.getHours(),
        hourCount: hours(),
        heatFactor: $('hot').checked ? HOT_FACTOR : 1,
        stations,
        runners,
      },
    });
    rememberEvent({ id, name, startsAt: start.toISOString(), key });
    location.href = `event.html?e=${id}#k=${key}`;
  } catch (err) {
    $('createStatus').textContent = err.message;
    $('createStatus').classList.add('error');
    $('create').disabled = false;
    $('create').textContent = 'Create event';
  }
});

// "Use as next year's plan": start from an earlier event (new date and time).
async function prefill(fromId) {
  const { event, stations, runners } = await api('GET', `/events/${fromId}`);
  $('name').value = event.name;
  for (const r of document.querySelectorAll('input[name="hours"]')) r.checked = Number(r.value) === event.hourCount;
  $('hot').checked = (event.heatFactor || 1) > 1;
  carried = {
    stations: stations.map((s) => ({ name: s.name, busy: Boolean(s.busy) })),
    runners: (runners || []).map((r) => ({ name: r.name })),
  };
  counts.stations = carried.stations.length;
  counts.runners = Math.max(1, carried.runners.length);
  setPeople(event.attendees);
  $('createStatus').textContent = `Started from "${event.name}": same stations and runners. Pick the new date, then create.`;
}

defaultStart();
update();
const fromId = param('from');
if (fromId) prefill(fromId).catch((err) => ($('createStatus').textContent = `Could not load the earlier event: ${err.message}`));
