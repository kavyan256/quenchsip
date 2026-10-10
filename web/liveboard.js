// Live board markup, shared by board.html (laptop) and the Live tab of the event hub.
import { escape } from './api.js';
import { boardView, ago, STATUS } from './core/board.js';
import { jobLine } from './core/dispatch.js';
import { svg, statusIcon } from './art.js';

const time = (ms) => new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

function detail(t, now) {
  const p = t.projection;
  const dry = p.dryAt ? (p.dry ? `Probably dry since ${time(Date.parse(p.dryAt))}` : `Runs dry about ${time(Date.parse(p.dryAt))} (in ${p.minutesToDry} min)`) : '';
  if (t.status === 'needs_jars') return dry || `Last jar tapped ${ago(t.lastJarAt, now)}`;
  if (t.status === 'not_stocked') return 'Volunteer has not counted jars and cups yet';
  if (t.status === 'quiet') return t.lastTapAt ? `No taps for ${t.silentMin} min` : `No taps since the event started (${t.silentMin} min)`;
  if (t.status === 'cups_low') return `Cups low since ${ago(t.station.cupsLowAt, now)}`;
  return dry || `Last tap ${ago(t.lastTapAt, now)}`;
}

function basis(t) {
  const p = t.projection;
  const parts = [];
  if (p.jarsLeft !== null) parts.push(`${p.jarsLeft} jar${p.jarsLeft === 1 ? '' : 's'} left`);
  else parts.push(t.flags.notStocked ? 'Jars left: not known until counted' : 'Jars left: not known yet');
  if (p.intervalMin) parts.push(`~${Math.round(p.intervalMin)} min per jar (${p.intervalSource === 'measured' ? 'measured' : 'from plan'})`);
  return parts.join(' · ');
}

// Delivery-app style progress line for a runner job.
function jobTimeline(job) {
  if (job.state === 'waiting') return 'Waiting for a free runner';
  const step = (label, at) => `${label} ${at ? time(Date.parse(at)) : '—'}`;
  return [step('Assigned', job.assignedAt), step('On the way', job.ackedAt), step('Delivered', job.closedAt && job.state === 'done' ? job.closedAt : null)].join('  →  ');
}

function tile(t, data, now) {
  const job = t.station.openJobId && (data.jobs || []).find((j) => j.id === t.station.openJobId);
  const extra = t.status !== 'cups_low' && t.flags.cupsLow ? `<span class="chip st-cups_low">${statusIcon('cups_low')} Cups low</span>` : '';
  return `<article class="tile st-${t.status}" aria-label="${escape(t.station.name)}: ${escape(t.label)}">
    <div class="tile-head"><span class="st-icon">${statusIcon(t.status)}</span><span class="tile-status">${escape(t.label)}</span></div>
    <div class="tile-name">${escape(t.station.name)}</div>
    ${t.station.zone ? `<div class="small">${escape(t.station.zone)}</div>` : ''}
    <div class="tile-detail">${escape(detail(t, now))}</div>
    <div class="small">${escape(basis(t))} · ${t.swapCount} swapped</div>
    ${job ? `<div class="job-chip">${escape(jobLine(job))}${job.jars ? ` · ${job.jars} jars` : ''}</div><div class="small job-line">${escape(jobTimeline(job))}</div>` : ''}
    ${extra}
  </article>`;
}

// Problems first; stations that are fine fold into one "All good" group.
// Before the start, "not counted yet" is expected, so it is one calm card, not an alarm per station.
export function boardMarkup(data, now = Date.now(), { wide = true } = {}) {
  const view = boardView(data, now);
  const { clock } = view;
  const clockText = !clock.known
    ? 'Event time not set'
    : clock.live
      ? `Live · ${time(clock.start)}–${time(clock.end)}`
      : clock.beforeStart
        ? `Starts at ${time(clock.start)}`
        : `Ended at ${time(clock.end)}`;
  const summaryHtml = Object.entries(STATUS)
    .filter(([k]) => view.summary[k] > 0 && !(k === 'not_stocked' && clock.beforeStart)) // shown as the calm card instead
    .map(([k, s]) => `<span class="chip st-${k}">${statusIcon(k)} ${view.summary[k]} ${escape(s.label.split(':')[0].toLowerCase())}</span>`)
    .join('');

  const notCounted = view.tiles.filter((t) => t.status === 'not_stocked');
  const uncounted = clock.known && clock.beforeStart ? notCounted : [];
  // After the start, stations still not counted are one red card with their names, not a wall of identical tiles.
  const lateCount = uncounted.length ? [] : notCounted;
  const needs = view.tiles.filter((t) => t.status !== 'ok' && !notCounted.includes(t));
  const fine = view.tiles.filter((t) => t.status === 'ok');

  const pre = uncounted.length
    ? `<section class="card pre-start"><span class="art lg">${svg('clipboard')}</span><div><h2 class="group-title">Before the gates open: ${view.tiles.length - uncounted.length} of ${view.tiles.length} stations counted</h2>
        <p class="small">Waiting for: ${uncounted.map((t) => escape(t.station.name)).join(', ')}</p></div></section>`
    : '';
  const late = lateCount.length
    ? `<section class="card not-counted st-not_stocked" aria-label="${lateCount.length} not counted yet"><span class="st-icon big">${statusIcon('not_stocked')}</span><div>
        <h3 class="not-counted-title">${lateCount.length} station${lateCount.length === 1 ? '' : 's'} not counted yet: ${lateCount.map((t) => escape(t.station.name)).join(', ')}</h3>
        <p class="small">Ask ${lateCount.length === 1 ? 'its volunteer' : 'their volunteers'} to count jars and cups in Quench.</p></div></section>`
    : '';
  const needCount = needs.length + lateCount.length;
  const needsHtml = needCount
    ? `<h2 class="group-title">Needs you now (${needCount})</h2>${late}${needs.length ? `<div class="tiles">${needs.map((t) => tile(t, data, now)).join('')}</div>` : ''}`
    : uncounted.length
      ? ''
      : `<section class="calm"><span class="art xl">${svg('dropCheer')}</span><p class="all-calm">Nothing needs you right now.</p><p class="small">Stations that need help will appear here first.</p></section>`;
  const fineHtml = fine.length
    ? `<details class="all-good" ${wide || !needs.length ? 'open' : ''}><summary>All good (${fine.length}) <span class="small">${fine.map((t) => escape(t.station.name)).join(' · ')}</span></summary><div class="tiles">${fine.map((t) => tile(t, data, now)).join('')}</div></details>`
    : '';
  return { clockText, summaryHtml, tilesHtml: pre + needsHtml + fineHtml };
}
