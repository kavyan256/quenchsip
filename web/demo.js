import { simulate, compare, DEFAULTS } from './core/sim.js';
import { escape } from './api.js';

const $ = (id) => document.getElementById(id);
const PLAY_MS = 30000;
const GROUPS = {
  typical: { lastJarMessageRate: 0.6, readDelayMin: 4 },
  disciplined: { lastJarMessageRate: 1, readDelayMin: 2 },
};
let timer = null;

const settings = () => ({
  ...GROUPS[$('group').value],
  tapRate: Number($('tapRate').value),
  runners: Number($('runners').value),
  seed: Math.max(1, Number($('seed').value) || 1),
});
const clock = (t) => {
  const m = 18 * 60 + t;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
};

function tiles(frame, names) {
  return frame.stations
    .map((s, i) => {
      const cls = s.dry ? 'st-needs_jars' : s.spare === 0 ? 'st-cups_low' : 'st-ok';
      const label = s.dry ? 'DRY' : `${s.spare} spare`;
      return `<div class="sim-tile ${cls}">
        <div class="sim-name">${escape(names[i])}</div>
        <div class="sim-bar"><span style="width:${Math.round((s.dry ? 0 : s.level) * 100)}%"></span></div>
        <div class="small">${label}${s.job ? ' · runner coming' : ''}</div>
      </div>`;
    })
    .join('');
}

function show(w, q, t) {
  const names = DEFAULTS.stations.map((s) => s.name);
  $('tilesW').innerHTML = tiles(w.frames[t], names);
  $('tilesQ').innerHTML = tiles(q.frames[t], names);
  $('dryW').textContent = `${w.frames[t].dryMinutes} dry minutes`;
  $('dryQ').textContent = `${q.frames[t].dryMinutes} dry minutes`;
  $('clock').textContent = `${clock(t)}${t >= 90 && t < 150 ? ' · headliner on stage' : ''}`;
}

function runOne() {
  const s = settings();
  const w = simulate('whatsapp', s);
  const q = simulate('quench', s);
  show(w, q, w.frames.length - 1);
  return { w, q };
}

function averages() {
  const { seed, ...rest } = settings();
  const c = compare(rest, 20);
  $('avg').innerHTML = `<div><div class="big">${c.whatsapp}</div><div class="small">dry station-minutes, WhatsApp (average)</div></div>
    <div><div class="big">${c.quench}</div><div class="small">dry station-minutes, Quench (average)</div></div>`;
  $('verdict').textContent =
    c.quench < c.whatsapp * 0.8
      ? `With these settings Quench cut dry minutes by about ${Math.round((1 - c.quench / Math.max(1, c.whatsapp)) * 100)}%.`
      : c.quench <= c.whatsapp
        ? 'With these settings Quench is only slightly better. It depends on volunteers tapping.'
        : 'With these settings the WhatsApp group does as well or better. Quench only helps when most swaps are tapped.';
}

$('play').addEventListener('click', () => {
  clearInterval(timer);
  const s = settings();
  const w = simulate('whatsapp', s);
  const q = simulate('quench', s);
  let t = 0;
  timer = setInterval(() => {
    show(w, q, t);
    t++;
    if (t >= w.frames.length) clearInterval(timer);
  }, PLAY_MS / w.frames.length);
});
for (const id of ['group', 'tapRate', 'runners', 'seed']) $(id).addEventListener('change', () => {
  clearInterval(timer);
  runOne();
  averages();
});

$('assumptions').innerHTML = [
  `Demand per station: ${DEFAULTS.stations.map((s) => `${s.name} ${s.baseLph} L/hr`).join(', ')}; ±${DEFAULTS.noise * 100}% hour to hour; stage stations ×${DEFAULTS.stations[2].peak} during the headliner.`,
  `Each station starts with ${DEFAULTS.startJars} full 20 L jars. A runner carries ${DEFAULTS.jarsPerTrip} jars; the store is ${DEFAULTS.tripMin} minutes from every station.`,
  'Everyone notices an empty station: in both worlds it is reported and handled after the read delay.',
  `Quench checks every 2 minutes and sends runners to the stations that will run dry soonest (runner trip + 10 min). Its plan is off by up to ±${DEFAULTS.planError * 100}%, so measured swap times matter.`,
  'A "dry minute" is one station without water for one minute. Numbers are from this model only, not from a real event.',
].map((x) => `<li>${escape(x)}</li>`).join('');

runOne();
averages();
