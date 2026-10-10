// End-of-event summary. Pure functions, unit-tested. Every number says how it was worked out.
import { JAR_LITRES } from './plan.js';
import { median } from './dispatch.js';

export const BOTTLE_LITRES = 0.5;
// PET in one 500 ml bottle: ~10-13 g (Indian preform listings; see IDEA.md). Shown as a range.
export const BOTTLE_GRAMS = { low: 10, high: 13 };

const minutesBetween = (a, b) => (a && b ? (Date.parse(b) - Date.parse(a)) / 60000 : null);
const round1 = (x) => (x === null ? null : Math.round(x * 10) / 10);

export function summarize({ event, stations, jobs = [], taps = [] }) {
  const start = event.startsAt ? Date.parse(event.startsAt) : null;

  const rows = stations.map((s) => {
    const swaps = s.swapCount || 0;
    const restocks = s.restocks || [];
    return {
      id: s.id,
      name: s.name,
      zone: s.zone,
      swaps,
      litres: swaps * JAR_LITRES,
      dryMinutes: Math.round(s.dryMinutes || 0),
      stockedBeforeStart: Boolean(s.stocked && s.stockedAt && start !== null && Date.parse(s.stockedAt) <= start),
      stocked: Boolean(s.stocked),
      lastJarTaps: s.lastJarCount || 0,
      cupsLowTaps: s.cupsLowCount || 0,
      restocks: restocks.length,
      jarsDelivered: restocks.reduce((a, r) => a + (r.jars || 0), 0),
    };
  });

  const swaps = rows.reduce((a, r) => a + r.swaps, 0);
  const litres = swaps * JAR_LITRES;
  const bottlesUpTo = Math.floor(litres / BOTTLE_LITRES);

  const done = jobs.filter((j) => j.state === 'done');
  const byState = jobs.reduce((acc, j) => ({ ...acc, [j.state]: (acc[j.state] || 0) + 1 }), {});

  return {
    event: { name: event.name, startsAt: event.startsAt || null, hourCount: event.hourCount, attendees: event.attendees },
    water: {
      swaps,
      litres,
      bottlesUpTo,
      petKg: { low: round1((bottlesUpTo * BOTTLE_GRAMS.low) / 1000), high: round1((bottlesUpTo * BOTTLE_GRAMS.high) / 1000) },
      formula: `${swaps} jars swapped × ${JAR_LITRES} L = ${litres.toLocaleString('en-IN')} L dispensed. ${litres.toLocaleString('en-IN')} L ÷ ${BOTTLE_LITRES} L = up to ${bottlesUpTo.toLocaleString('en-IN')} bottles of 500 ml not bought (if every litre would otherwise have come in a bottle). PET at ${BOTTLE_GRAMS.low}-${BOTTLE_GRAMS.high} g per bottle.`,
    },
    stations: rows,
    totals: {
      stations: rows.length,
      stockedBeforeStart: rows.filter((r) => r.stockedBeforeStart).length,
      dryMinutes: rows.reduce((a, r) => a + r.dryMinutes, 0),
      stationsThatRanDry: rows.filter((r) => r.dryMinutes > 0).length,
      taps: taps.length,
    },
    dispatch: {
      jobs: jobs.length,
      byState,
      delivered: done.length,
      jarsDelivered: done.reduce((a, j) => a + (j.deliveredJars || 0), 0),
      medianMinutesToDeliver: round1(median(done.map((j) => minutesBetween(j.createdAt, j.closedAt)))),
      medianMinutesToOnMyWay: round1(median(jobs.filter((j) => j.ackedAt).map((j) => minutesBetween(j.assignedAt, j.ackedAt)))),
    },
  };
}

// CSV of the per-station table, for spreadsheets.
export function stationsCsv(summary) {
  const header = ['Station', 'Zone', 'Jars swapped', 'Litres', 'Dry minutes', 'Stocked before start', 'Last-jar taps', 'Cups-low taps', 'Restocks', 'Jars delivered'];
  // A name starting with = + - @ would run as a formula in Excel, so it is prefixed with ' (shown as text).
  const safe = (v) => (typeof v === 'string' && /^[=+\-@\t\r]/.test(v) ? `'${v}` : String(v));
  const esc = (v) => { const x = safe(v); return /[",\n]/.test(x) ? `"${x.replace(/"/g, '""')}"` : x; };
  const lines = summary.stations.map((r) => [r.name, r.zone, r.swaps, r.litres, r.dryMinutes, r.stockedBeforeStart ? 'yes' : 'no', r.lastJarTaps, r.cupsLowTaps, r.restocks, r.jarsDelivered]);
  return [header, ...lines].map((row) => row.map(esc).join(',')).join('\n');
}
