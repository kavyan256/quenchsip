import { api, param, escape, clockTime } from './api.js';
import { JOB_STATES } from './core/dispatch.js';
import { t, applyStatic, languageButton } from './i18n.js';
import { mountArt } from './art.js';

const $ = (id) => document.getElementById(id);
const eventId = param('e');
const runnerId = param('r');
const linkToken = param('t'); // the secret in this runner's link
const POLL_MS = 4000;
let shownJobId = null;
let lastData = null;

const time = clockTime;

function feedback(kind, text) {
  $('feedback').className = `feedback ${kind}`;
  $('feedback').textContent = text;
}

// New job: buzz, two short beeps (browsers allow sound after the first tap on the page),
// and a flashing tab title so it shows even when the runner is in another app tab.
let audio = null;
addEventListener('pointerdown', () => {
  try { audio ??= new AudioContext(); audio.resume(); } catch {}
}, { once: true });
let flash = null;
function alertNewJob(job) {
  if (navigator.vibrate) navigator.vibrate([300, 150, 300, 150, 300]);
  if (audio) {
    for (const at of [0, 0.25]) {
      const o = audio.createOscillator();
      const g = audio.createGain();
      o.frequency.value = 880;
      g.gain.setValueAtTime(0.25, audio.currentTime + at);
      g.gain.exponentialRampToValueAtTime(0.001, audio.currentTime + at + 0.2);
      o.connect(g).connect(audio.destination);
      o.start(audio.currentTime + at);
      o.stop(audio.currentTime + at + 0.2);
    }
  }
  clearInterval(flash);
  const base = document.title;
  const alertTitle = t('newJobTitle', { station: job.stationName });
  let on = false;
  flash = setInterval(() => {
    document.title = (on = !on) ? alertTitle : base;
  }, 1000);
  setTimeout(() => {
    clearInterval(flash);
    document.title = base;
  }, 20000);
}

function render(data) {
  lastData = data;
  const { event, runner, job, lastJob } = data;
  document.title = `${runner.name} · Runner · Quench`;
  $('eventName').textContent = event.name;
  $('runnerName').textContent = runner.name;
  $('idle').hidden = Boolean(job);
  $('job').hidden = !job;
  if (!job) {
    $('lastJob').textContent = lastJob ? t('lastJobLine', { station: lastJob.stationName, state: JOB_STATES[lastJob.state].toLowerCase(), time: time(lastJob.closedAt || lastJob.assignedAt) }) : '';
    shownJobId = null;
    return;
  }
  const isNew = job.id !== shownJobId;
  shownJobId = job.id;
  $('job').className = `card job-card ${job.state === 'acked' ? 'on-way' : 'new-job'}`;
  $('jobState').textContent = job.state === 'acked' ? t('onYourWay') : t('newJob');
  $('jobTitle').textContent = t('take', { n: job.jars }) + (job.cups ? t('andCups', { n: job.cups }) : '');
  $('jobWhere').textContent = job.zone ? t('to', { station: job.stationName, zone: job.zone }) : t('toPlain', { station: job.stationName });
  $('jobWhy').textContent = job.reason === 'last_jar' ? t('whyLastJar') : job.dryAt ? t('whyDry', { time: time(job.dryAt) }) : '';
  $('onMyWay').hidden = job.state === 'acked';
  if (isNew) {
    $('deliveredJars').value = job.jars;
    $('deliveredCups').value = job.cups;
    alertNewJob(job);
  }
}

async function refresh() {
  try {
    render(await api('GET', `/events/${eventId}/runners/${runnerId}`, { token: linkToken }));
    $('loadError').hidden = true;
  } catch (err) {
    $('loadError').textContent = err.status === 404 || err.status === 403 ? 'This runner link is not valid any more. Ask the organiser.' : err.message;
    $('loadError').hidden = false;
  }
}

$('onMyWay').addEventListener('click', async () => {
  try {
    await api('POST', `/events/${eventId}/jobs/${shownJobId}/ack`, { token: linkToken, body: { runnerId } });
    feedback('ok', t('thanksOnWay'));
  } catch (err) {
    feedback('warn', err.message);
  }
  refresh();
});

$('deliveredForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    const out = await api('POST', `/events/${eventId}/jobs/${shownJobId}/done`, { token: linkToken, body: { runnerId, jars: Number($('deliveredJars').value), cups: Number($('deliveredCups').value) } });
    feedback('ok', t('thanksDelivered', { jars: out.jars }));
  } catch (err) {
    feedback('warn', err.message);
  }
  refresh();
});

mountArt();
applyStatic();
languageButton($('lang'), () => lastData && render(lastData));

if (!eventId || !runnerId) {
  $('runnerName').textContent = 'Link incomplete';
  $('loadError').textContent = 'Open the runner link the organiser gave you.';
  $('loadError').hidden = false;
} else {
  refresh();
  setInterval(refresh, POLL_MS);
}
