// Summary markup, shared by summary.html and the Summary tab of the event hub.
import { api, escape } from './api.js';
import { stationsCsv } from './core/summary.js';
import { shareText } from './share.js';
import { svg } from './art.js';

const n = (x) => Number(x).toLocaleString('en-IN');
const stat = (big, label, art) => `<div class="stat">${art ? `<span class="art">${svg(art)}</span>` : ''}<div><div class="big">${big}</div><div class="small">${escape(label)}</div></div></div>`;

export async function mountSummary(container, eventId) {
  const s = await api('GET', `/events/${eventId}/summary`);
  const d = s.dispatch;
  // Nothing has happened yet: one calm card instead of a page of zeros.
  if (!s.water.litres && !d.jobs) {
    const counted = s.totals.stockedBeforeStart;
    container.innerHTML = `
      <section class="calm summary-empty" id="summaryEmpty">
        <span class="art xl">${svg('dropRest')}</span>
        <p class="all-calm">Fills in during the event</p>
        <p class="small">As volunteers tap "Jar swapped", you'll see the water served, plastic bottles avoided, dry minutes and runner times here.</p>
        ${counted ? `<p class="small">${counted} of ${s.totals.stations} stations have counted their stock so far.</p>` : ''}
      </section>`;
    return s;
  }
  container.innerHTML = `
    <div id="content">
      <section class="card">
        <h2>Water from refill stations</h2>
        <div class="totals" id="water">
          ${stat(`${n(s.water.litres)} L`, 'water dispensed', 'jar')}
          ${stat(`up to ${n(s.water.bottlesUpTo)}`, 'plastic bottles (500 ml) avoided', 'bottleNo')}
          ${stat(`${s.water.petKg.low}–${s.water.petKg.high} kg`, 'PET plastic avoided, at most', 'dropCheer')}
        </div>
        <p class="note" id="formula">${escape(s.water.formula)}</p>
      </section>
      <section class="card">
        <h2>Did stations run dry?</h2>
        <div class="totals" id="dry">
          ${stat(`${s.totals.stockedBeforeStart} of ${s.totals.stations}`, 'stations stocked before the start', 'clipboard')}
          ${stat(`${s.totals.stationsThatRanDry}`, 'stations that ran dry', 'station')}
          ${stat(`${n(s.totals.dryMinutes)} min`, 'dry minutes in total', 'stopwatch')}
        </div>
        <p class="note">Dry minutes are counted by the check every 2 minutes, while a station is past its expected run-dry time with no new jars.</p>
      </section>
      <section class="card">
        <h2>Runners</h2>
        <div class="totals" id="dispatch">
          ${stat(`${d.delivered} of ${d.jobs}`, 'runner jobs delivered', 'runner')}
          ${stat(`${n(d.jarsDelivered)}`, 'jars delivered by runners', 'truck')}
          ${stat(d.medianMinutesToDeliver === null ? '–' : `${d.medianMinutesToDeliver} min`, 'typical time from alert to delivery (median)', 'stopwatch')}
        </div>
      </section>
      <section class="card">
        <h2>By station</h2>
        <div class="table-wrap"><table>
          <tr><th>Station</th><th>Jars swapped</th><th>Litres</th><th>Dry min</th><th>Counted before start</th><th>Restocks (jars)</th></tr>
          ${s.stations.map((r) => `<tr><td>${escape(r.name)}</td><td>${r.swaps}</td><td>${n(r.litres)}</td><td>${r.dryMinutes}</td><td>${r.stockedBeforeStart ? 'yes' : 'no'}</td><td>${r.restocks} (${r.jarsDelivered})</td></tr>`).join('')}
        </table></div>
      </section>
      <div class="summary-actions no-print">
        <button type="button" class="primary-btn" data-act="share">Share on WhatsApp</button>
        <button type="button" class="ghost" data-act="csv">Download CSV</button>
        <button type="button" class="ghost" data-act="print">Print</button>
        <a class="ghost-link" href="plan.html?from=${eventId}">Use as next year's plan →</a>
      </div>
    </div>`;

  container.querySelector('[data-act="share"]').onclick = () =>
    shareText(
      `${s.event.name}: ${n(s.water.litres)} L of water served from refill stations, up to ${n(s.water.bottlesUpTo)} plastic bottles avoided. ${s.totals.stockedBeforeStart} of ${s.totals.stations} stations ready before the start. ${location.origin}/summary.html?e=${eventId}`,
      `${s.event.name} summary`
    );
  container.querySelector('[data-act="csv"]').onclick = () => {
    const url = URL.createObjectURL(new Blob([stationsCsv(s)], { type: 'text/csv' }));
    const a = Object.assign(document.createElement('a'), { href: url, download: `${s.event.name.replace(/[^\w-]+/g, '_')}_stations.csv` });
    a.click();
    URL.revokeObjectURL(url);
  };
  container.querySelector('[data-act="print"]').onclick = () => window.print();
  return s;
}
