import { api, param, escape } from './api.js';
import { JOB_STATES } from './core/dispatch.js';
import { t, applyStatic, languageButton } from './i18n.js';

const $ = (id) => document.getElementById(id);
const eventId = param('e');
const runnerId = param('r');
const POLL_MS = 4000;
let shownJobId = null;
let lastData = null;

const time = (iso) => new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

function feedback(kind, text) {
  $('feedback').className = `feedback ${kind}`;
  $('feedback').textContent = text;
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
  $('jobWhere').textContent = t('to', { station: job.stationName, zone: job.zone });
  $('jobWhy').textContent = job.reason === 'last_jar' ? t('whyLastJar') : job.dryAt ? t('whyDry', { time: time(job.dryAt) }) : '';
  $('onMyWay').hidden = job.state === 'acked';
  if (isNew) {
    $('deliveredJars').value = job.jars;
    $('deliveredCups').value = job.cups;
    if (navigator.vibrate) navigator.vibrate([200, 100, 200]);
  }
}

async function refresh() {
  try {
    render(await api('GET', `/events/${eventId}/runners/${runnerId}`));
    $('loadError').hidden = true;
  } catch (err) {
    $('loadError').textContent = err.status === 404 ? 'This runner link is not valid any more. Ask the organiser.' : err.message;
    $('loadError').hidden = false;
  }
}

$('onMyWay').addEventListener('click', async () => {
  try {
    await api('POST', `/events/${eventId}/jobs/${shownJobId}/ack`, { body: { runnerId } });
    feedback('ok', t('thanksOnWay'));
  } catch (err) {
    feedback('warn', err.message);
  }
  refresh();
});

$('deliveredForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    const out = await api('POST', `/events/${eventId}/jobs/${shownJobId}/done`, { body: { runnerId, jars: Number($('deliveredJars').value), cups: Number($('deliveredCups').value) } });
    feedback('ok', t('thanksDelivered', { jars: out.jars }));
  } catch (err) {
    feedback('warn', err.message);
  }
  refresh();
});

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
