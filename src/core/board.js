// Live board: which station needs help, most urgent first. Pure functions, unit-tested.
// Uses the same projection as the scheduled Lambda, so the board and the alerts agree.
import { project, DEFAULT_RUNNER_TRIP_MIN } from './projection.js';

export const STATUS = {
  needs_jars: { rank: 0, label: 'Needs jars now' },
  not_stocked: { rank: 1, label: 'Not stocked' },
  quiet: { rank: 2, label: 'No taps: check on volunteer' },
  cups_low: { rank: 3, label: 'Cups low' },
  ok: { rank: 4, label: 'OK' },
};

const MIN = 60 * 1000;

// Is the event running at `now`, and which plan hour is it?
export function eventClock(event, now) {
  if (!event.startsAt) return { live: true, hourIndex: 0, known: false, start: null };
  const start = Date.parse(event.startsAt);
  const end = start + event.hourCount * 60 * MIN;
  const live = now >= start && now < end;
  const hourIndex = Math.min(event.hourCount - 1, Math.max(0, Math.floor((now - start) / (60 * MIN))));
  return { live, hourIndex, known: true, start, end, beforeStart: now < start };
}

// A flag stays on until a later restock or stock count clears it.
const raisedAfter = (raisedAt, ...clearedAt) => Boolean(raisedAt) && !clearedAt.some((c) => c && c > raisedAt);

export function stationStatus(station, { now, clock, planned, runnerTripMin }) {
  const p = project(station, { now, clock, planned, runnerTripMin });
  const lastJar = raisedAfter(station.lastJarAt, station.lastRestockAt, station.stockedAt);
  const needsJars = lastJar || p.alert;
  const cupsLow = raisedAfter(station.cupsLowAt, station.lastCupsRestockAt, station.stockedAt);
  const notStocked = station.stocked !== true;

  const status = needsJars ? 'needs_jars' : notStocked ? 'not_stocked' : p.quiet ? 'quiet' : cupsLow ? 'cups_low' : 'ok';
  return {
    status,
    ...STATUS[status],
    flags: { needsJars, lastJar, runningDry: p.alert, notStocked, cupsLow, quiet: p.quiet },
    projection: p,
    silentMin: p.silentMin,
    lastTapAt: station.lastTapAt || null,
    lastJarAt: station.lastJarAt || null,
    swapCount: station.swapCount || 0,
  };
}

// Tiles sorted most urgent first: soonest to run dry, then longest-silent.
export function boardView({ event, stations, plan }, now) {
  const clock = eventClock(event, now);
  const runnerTripMin = event.runnerTripMin ?? DEFAULT_RUNNER_TRIP_MIN;
  const planByStation = Object.fromEntries((plan?.rows || []).map((r) => [r.stationId, r]));

  const tiles = stations.map((station) => {
    const hour = planByStation[station.id]?.byHour?.[clock.hourIndex];
    const planned = { highLph: hour?.high?.litres ?? 0, lowLph: hour?.low?.litres ?? 0 };
    const s = stationStatus(station, { now, clock, planned, runnerTripMin });
    return { station, ...s, plannedJarsPerHour: hour ? { low: hour.low.jars, high: hour.high.jars } : null };
  });

  const dryKey = (t) => (t.projection.dryAt ? Date.parse(t.projection.dryAt) : Infinity);
  tiles.sort((a, b) => {
    if (a.rank !== b.rank) return a.rank - b.rank;
    if (a.status === 'needs_jars') return dryKey(a) - dryKey(b) || (a.lastJarAt || '').localeCompare(b.lastJarAt || '');
    if (a.status === 'quiet') return (b.silentMin ?? 0) - (a.silentMin ?? 0);
    return a.station.name.localeCompare(b.station.name, undefined, { numeric: true }); // "Station 2" before "Station 10"
  });

  const summary = Object.fromEntries(Object.keys(STATUS).map((k) => [k, tiles.filter((t) => t.status === k).length]));
  return { clock, tiles, summary };
}

// "just now", "4 min ago", "1 h 5 min ago"
export function ago(iso, now) {
  if (!iso) return 'never';
  const m = Math.floor((now - Date.parse(iso)) / MIN);
  if (m < 1) return 'just now';
  if (m < 60) return `${m} min ago`;
  return `${Math.floor(m / 60)} h ${m % 60} min ago`;
}
