import { api, param, escape } from './api.js';
import { newTapId } from './core/tap.js';
import { outcome, retryDelay, queueSummary } from './core/sync.js';
import { saveTap, stationTaps, pruneSent } from './queue.js';
import { t, applyStatic, languageButton } from './i18n.js';
import { mountArt } from './art.js';

const $ = (id) => document.getElementById(id);
const eventId = param('e');
const stationId = param('s');
const linkToken = param('t'); // the secret in this station's QR link

// Two presses of the same button within this window are one tap (a real swap takes longer).
const DOUBLE_TAP_MS = 3000;
const lastPress = {};

const time = (iso) => new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
const TAP_KEYS = { swap: 'jarSwapped', last_jar: 'lastJar', cups_low: 'cupsLow', stocked: 'stocked' };
const tapLabel = (x) => (x.type === 'stocked' ? t('stockedTap', { jars: x.jars, cups: x.cups }) : t(TAP_KEYS[x.type]));
let stationInfo = null;
let recounting = false;

function feedback(kind, html) {
  $('feedback').className = `feedback ${kind}`;
  $('feedback').innerHTML = html;
}

async function render() {
  const taps = await stationTaps(eventId, stationId);
  const summary = queueSummary(taps);
  $('syncState').className = `sync ${summary.kind}`;
  $('syncState').textContent = summary.kind === 'warn' ? t('failed', { n: summary.failed }) : summary.kind === 'pending' ? t('waiting', { n: summary.waiting }) : t('allSent');
  const latest = taps.slice(-5).reverse();
  $('recent').innerHTML = latest.length
    ? latest.map((x) => `<li><span>${escape(tapLabel(x))}</span><span class="small">${time(x.at)} · ${t(`st_${x.status}`)}${x.error ? `: ${escape(x.error)}` : ''}</span></li>`).join('')
    : `<li class="small">${t('noneYet')}</li>`;
  renderStock(taps);
}

// Stock card: open until this station's stock is confirmed (on this phone or on the server), then folded away.
function renderStock(taps) {
  const localStock = taps.filter((t) => t.type === 'stocked').at(-1);
  const stock = localStock
    ? { jars: localStock.jars, cups: localStock.cups, at: localStock.at }
    : stationInfo?.stocked
      ? { jars: stationInfo.stockedJars, cups: stationInfo.stockedCups, at: stationInfo.stockedAt }
      : null;
  $('stockCard').hidden = Boolean(stock) && !recounting;
  $('stockDone').hidden = !stock || recounting;
  if (stock) $('stockSummary').textContent = t('stockedAt', { time: time(stock.at), jars: stock.jars, cups: stock.cups });
  $('stockHint').textContent = stationInfo?.plannedJars ? t('countHintPlan', { jars: stationInfo.plannedJars }) : t('countHint');
}

// Sends waiting taps oldest first. Stops at the first "no signal" and tries again later.
let flushing = false;
let attempt = 0;
let retryTimer;
async function flush() {
  if (flushing) return;
  flushing = true;
  clearTimeout(retryTimer);
  try {
    for (const tap of (await stationTaps(eventId, stationId)).filter((t) => t.status === 'pending')) {
      let status;
      try {
        await api('POST', `/events/${eventId}/stations/${stationId}/taps`, { token: linkToken, body: { uuid: tap.uuid, type: tap.type, deviceTs: tap.at, jars: tap.jars, cups: tap.cups } });
        status = 201;
      } catch (err) {
        status = err.status ?? 0;
        tap.error = err.message;
      }
      const next = outcome(status);
      if (next === 'retry') {
        retryTimer = setTimeout(flush, retryDelay(attempt++));
        break;
      }
      attempt = 0;
      tap.status = next;
      if (next === 'sent') delete tap.error;
      await saveTap(tap);
    }
  } finally {
    flushing = false;
    await render();
  }
}

$('buttons').addEventListener('click', async (e) => {
  const button = e.target.closest('button.tap');
  if (!button) return;
  const type = button.dataset.type;
  const now = Date.now();
  if (now - (lastPress[type] || 0) < DOUBLE_TAP_MS) {
    feedback('ok', escape(t('alreadyCounted')));
    return;
  }
  lastPress[type] = now;
  if (navigator.vibrate) navigator.vibrate(30);
  // Save on the phone first, so the tap is never lost, then try to send.
  const tap = { uuid: newTapId(), eventId, stationId, type, at: new Date(now).toISOString(), status: 'pending' };
  await saveTap(tap);
  feedback('ok', `<strong>${t('saved')}</strong> ${escape(t('savedTap', { label: t(TAP_KEYS[type]), time: time(tap.at) }))}`);
  await render();
  attempt = 0;
  flush();
});

$('stockCard').addEventListener('submit', async (e) => {
  e.preventDefault();
  const jars = Number($('stockJars').value);
  const cups = Number($('stockCups').value);
  const tap = { uuid: newTapId(), eventId, stationId, type: 'stocked', jars, cups, at: new Date().toISOString(), status: 'pending' };
  await saveTap(tap);
  recounting = false;
  feedback('ok', `<strong>${t('saved')}</strong> ${escape(t('savedStock', { jars, cups, time: time(tap.at) }))}`);
  await render();
  attempt = 0;
  flush();
});

$('recount').addEventListener('click', async () => {
  recounting = true;
  $('stockJars').value = '';
  $('stockCups').value = '';
  await render();
  $('stockJars').focus();
});

// Try again as soon as the phone gets signal back or the volunteer returns to the page.
addEventListener('online', () => { attempt = 0; flush(); });
document.addEventListener('visibilitychange', () => { if (!document.hidden) flush(); });

// The station name is kept on the phone, so the page still works if it is opened without signal.
const cacheKey = `qs-station-${eventId}-${stationId}`;
async function loadStation() {
  try {
    const [{ event, stations, plan }] = await Promise.all([
      api('GET', `/events/${eventId}`),
      // A link without its token (or an old copy) is caught now, not on the first tap.
      api('GET', `/events/${eventId}/stations/${stationId}/link`, { token: linkToken }).catch((err) => {
        if (err.status === 404) throw Object.assign(new Error('This station was removed. Ask the organiser for the new QR code.'), { status: 404 });
        throw err;
      }),
    ]);
    const station = stations.find((s) => s.id === stationId);
    if (!station) throw Object.assign(new Error('This station was removed. Ask the organiser for the new QR code.'), { status: 404 });
    const planned = plan?.rows?.find((r) => r.stationId === stationId)?.total;
    const info = {
      eventName: event.name,
      name: station.name,
      zone: station.zone,
      stocked: station.stocked === true,
      stockedJars: station.stockedJars,
      stockedCups: station.stockedCups,
      stockedAt: station.stockedAt,
      plannedJars: planned ? `${planned.jarsLow}–${planned.jarsHigh}` : null,
    };
    try { localStorage.setItem(cacheKey, JSON.stringify(info)); } catch {}
    return info;
  } catch (err) {
    if (err.status) throw err;
    let cached = null;
    try { cached = JSON.parse(localStorage.getItem(cacheKey)); } catch {}
    if (!cached) throw new Error('No signal, and this phone has not opened this station before. Try again when you have signal.');
    return { ...cached, offline: true };
  }
}

async function start() {
  if (!eventId || !stationId) throw new Error('This link is incomplete. Scan the QR code at your station again.');
  const info = await loadStation();
  stationInfo = info;
  document.title = `${info.name} · Quench`;
  $('eventName').textContent = info.eventName;
  $('station').textContent = info.name;
  $('zone').textContent = info.zone ? t('zone', { zone: info.zone }) : '';
  // First visit on this phone: one short card, then never again.
  const introKey = `qs-intro-${eventId}-${stationId}`;
  let seen = false;
  try { seen = localStorage.getItem(introKey) === '1'; } catch {}
  if (!seen) {
    $('introTitle').textContent = t('introTitle', { station: info.name });
    $('intro').hidden = false;
    $('introOk').onclick = () => {
      $('intro').hidden = true;
      try { localStorage.setItem(introKey, '1'); } catch {}
      $('station').scrollIntoView({ behavior: 'smooth' });
    };
  }
  if (info.offline) feedback('pending', escape(t('noSignal')));
  $('buttons').hidden = false;
  await pruneSent(eventId, stationId);
  await render();
  flush();
}

// The service worker lets this page open without signal. Browsers only allow it on https or localhost.
if ('serviceWorker' in navigator && window.isSecureContext) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}

mountArt();
applyStatic();
languageButton($('lang'), () => {
  if (stationInfo) {
    $('zone').textContent = stationInfo.zone ? t('zone', { zone: stationInfo.zone }) : '';
    $('introTitle').textContent = t('introTitle', { station: stationInfo.name });
  }
  render();
});

start().catch((err) => {
  $('station').textContent = err.status === 403 ? 'Link not valid' : 'Station not found';
  $('loadError').textContent = err.message;
  $('loadError').hidden = false;
});
