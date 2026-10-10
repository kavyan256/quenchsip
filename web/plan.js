// Set up: one question per screen (name, people, when, weather), then the water plan as the payoff.
// Only the name is typed; everything else is a tap with a sensible default.
import { api, param, clockTime } from './api.js';
import { rememberEvent } from './store.js';
import { mountArt } from './art.js';
import { DEFAULT_LITRES_PER_PERSON_HR, JAR_LITRES, CUP_LITRES, PEOPLE_PER_OUTLET } from './core/plan.js';

const $ = (id) => document.getElementById(id);
const STEPS = 5;
const HOT_FACTOR = 1.3;
const TEMPLATES = {
  fest: { people: 2000, hours: 4, hot: false },
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
const isHot = () => document.querySelector('input[name="hot"]:checked').value === 'yes';
const checkRadio = (name, value) => {
  for (const r of document.querySelectorAll(`input[name="${name}"]`)) r.checked = String(r.value) === String(value);
};
const nf = (n) => n.toLocaleString('en-IN');
const dayLabel = (d) => d.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' });
const timeLabel = clockTime;

const suggestedStations = (p) => Math.max(2, Math.ceil(p / PEOPLE_PER_OUTLET));
const suggestedRunners = (s) => Math.max(1, Math.ceil(s / 3));

// ---------- Steps ----------
let current = 1;

function show(n, { focus = true } = {}) {
  current = n;
  for (const s of document.querySelectorAll('.flow-step')) s.hidden = Number(s.dataset.step) !== n;
  document.querySelectorAll('#flowProgress span').forEach((seg, i) => seg.classList.toggle('on', i < n));
  $('flowProgress').setAttribute('aria-valuenow', n);
  $('back').textContent = n === 1 ? '✕' : '←';
  $('back').setAttribute('aria-label', n === 1 ? 'Close set up' : 'Back');
  $('next').hidden = n === STEPS;
  $('create').hidden = n !== STEPS;
  if (n === STEPS) update();
  window.scrollTo(0, 0);
  if (focus) {
    const step = document.querySelector(`.flow-step[data-step="${n}"]`);
    const target = n === 1 ? $('name') : step.querySelector('input:checked') || step.querySelector('h1, input');
    target?.focus({ preventScroll: true });
  }
}

function nameOk() {
  if ($('name').value.trim()) return true;
  $('nameError').hidden = false;
  $('name').setAttribute('aria-invalid', 'true');
  $('name').focus();
  return false;
}

// Forward pushes a history entry so the phone's back button steps back through the questions.
function next() {
  if (current === 1 && !nameOk()) return;
  history.pushState({ step: current + 1 }, '', `#step${current + 1}`);
  show(current + 1);
}

$('next').addEventListener('click', next);
$('back').addEventListener('click', (e) => {
  if (current === 1) return; // ✕ follows its link home
  e.preventDefault();
  history.back();
});
window.addEventListener('popstate', (e) => show(e.state?.step || 1));
// Enter on any step moves on, like Continue (and creates on the last step).
$('setup').addEventListener('keydown', (e) => {
  if (e.key !== 'Enter' || e.target.tagName === 'BUTTON' || e.target.tagName === 'SUMMARY') return;
  e.preventDefault();
  if (current < STEPS) next();
  else $('create').click();
});

// ---------- The plan ----------
function update() {
  if (!touched.stations && !carried.stations) counts.stations = Math.min(50, suggestedStations(people()));
  if (!touched.runners && !carried.runners) counts.runners = Math.min(30, suggestedRunners(counts.stations));
  $('stations').value = $('stations').textContent = counts.stations;
  $('runners').value = $('runners').textContent = counts.runners;

  const heat = isHot() ? HOT_FACTOR : 1;
  const litres = (rate) => people() * rate * heat * hours();
  const low = litres(DEFAULT_LITRES_PER_PERSON_HR.low);
  const high = litres(DEFAULT_LITRES_PER_PERSON_HR.high);
  const jars = `${nf(Math.ceil(low / JAR_LITRES))}–${nf(Math.ceil(high / JAR_LITRES))}`;
  const cups = `${nf(Math.ceil(low / CUP_LITRES))}–${nf(Math.ceil(high / CUP_LITRES))}`;
  $('planJars').textContent = jars;
  $('planCups').textContent = cups;
  $('order').textContent = `Order about ${jars} jars and ${cups} cups`;

  const start = eventStart();
  const end = new Date(start.getTime() + hours() * 3600e3);
  const day = document.querySelector('input[name="day"]:checked').value;
  const when = day === 'today' ? 'Today' : day === 'tomorrow' ? 'Tomorrow' : dayLabel(start);
  $('planLine').textContent = `${$('name').value.trim()} · ${when} ${timeLabel(start)}–${timeLabel(end)} · ${nf(people())} people${heat > 1 ? ' · hot day' : ''}`;
  $('basis').textContent = `${nf(people())} people × ${DEFAULT_LITRES_PER_PERSON_HR.low}–${DEFAULT_LITRES_PER_PERSON_HR.high} L per person per hour × ${hours()} h${heat > 1 ? ' × 1.3 (hot day)' : ''}, in 20 L jars and 200 ml cups. One water station per ${PEOPLE_PER_OUTLET} people, one runner per 3 stations. The high value follows a government advisory for outdoor summer events.`;
}

function setPeople(n) {
  $('people').value = n;
  checkRadio('people', n);
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

// ---------- Inputs ----------
document.querySelectorAll('input[name="people"]').forEach((r) => r.addEventListener('change', () => setPeople(Number(r.value))));
$('exactBtn').addEventListener('click', () => {
  $('exactRow').hidden = false;
  $('exactBtn').hidden = true;
  $('people').focus();
  $('people').select();
});
$('people').addEventListener('input', () => {
  checkRadio('people', people());
  update();
});

const today = new Date();
const tomorrow = new Date(Date.now() + 864e5);
$('todayLabel').textContent = dayLabel(today);
$('tomorrowLabel').textContent = dayLabel(tomorrow);
$('pickBtn').addEventListener('click', () => {
  $('dayPick').checked = true;
  $('date').hidden = false;
  $('date').focus();
  $('date').showPicker?.();
});
document.querySelectorAll('input[name="day"]').forEach((r) =>
  r.addEventListener('change', () => {
    if (r.checked && r.value !== 'pick') $('date').hidden = true;
  })
);

$('stationsMinus').addEventListener('click', () => step('stations', -1, 50));
$('stationsPlus').addEventListener('click', () => step('stations', 1, 50));
$('runnersMinus').addEventListener('click', () => step('runners', -1, 30));
$('runnersPlus').addEventListener('click', () => step('runners', 1, 30));

// A template fills in the later answers (still shown, still changeable) and names the event if it has no name yet.
document.querySelectorAll('[data-template]').forEach((b) =>
  b.addEventListener('click', () => {
    const t = TEMPLATES[b.dataset.template];
    document.querySelectorAll('[data-template]').forEach((x) => x.classList.toggle('on', x === b));
    checkRadio('hours', t.hours);
    checkRadio('hot', t.hot ? 'yes' : 'no');
    touched.stations = touched.runners = false;
    setPeople(t.people);
    if (!$('name').value.trim()) {
      $('name').value = `${b.textContent} ${today.getFullYear()}`;
      $('name').dispatchEvent(new Event('input'));
    }
    $('name').focus();
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
    history.pushState({ step: 1 }, '', '#step1');
    show(1, { focus: false });
    nameOk();
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
        heatFactor: isHot() ? HOT_FACTOR : 1,
        stations,
        runners,
      },
    });
    rememberEvent({ id, name, startsAt: start.toISOString(), key });
    location.replace(`event.html?e=${id}#k=${key}`);
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
  checkRadio('hours', event.hourCount);
  checkRadio('hot', (event.heatFactor || 1) > 1 ? 'yes' : 'no');
  carried = {
    stations: stations.map((s) => ({ name: s.name, busy: Boolean(s.busy) })),
    runners: (runners || []).map((r) => ({ name: r.name })),
  };
  counts.stations = carried.stations.length;
  counts.runners = Math.max(1, carried.runners.length);
  setPeople(event.attendees);
  if (![500, 2000, 5000, 10000].includes(event.attendees)) $('exactBtn').click();
  $('createStatus').textContent = `Started from "${event.name}": same stations and runners. Pick the new date, then create.`;
}

mountArt();
defaultStart();
history.replaceState({ step: 1 }, '', location.pathname + location.search);
show(1, { focus: false });
update();
const fromId = param('from');
if (fromId) prefill(fromId).catch((err) => ($('createStatus').textContent = `Could not load the earlier event: ${err.message}`));
