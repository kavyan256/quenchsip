// Live board: which station needs help, most urgent first. Pure functions, unit-tested.
import { JAR_LITRES } from './plan.js';

export const STATUS = {
  needs_jars: { rank: 0, label: 'Needs jars now' },
  quiet: { rank: 1, label: 'No taps: check on volunteer' },
  cups_low: { rank: 2, label: 'Cups low' },
  ok: { rank: 3, label: 'OK' },
};

const MIN = 60 * 1000;
export const QUIET_FLOOR_MIN = 10;

// Is the event running at `now`, and which plan hour is it?
export function eventClock(event, now) {
  if (!event.startsAt) return { live: true, hourIndex: 0, known: false };
  const start = Date.parse(event.startsAt);
  const end = start + event.hourCount * 60 * MIN;
  const live = now >= start && now < end;
  const hourIndex = Math.min(event.hourCount - 1, Math.max(0, Math.floor((now - start) / (60 * MIN))));
  return { live, hourIndex, known: true, start, end, beforeStart: now < start };
}

// Minutes of silence before a station counts as quiet: 1.5x the planned time to empty one jar
// (using the low demand estimate, so it does not cry wolf), never less than 10 minutes.
export function quietAfterMin(plannedLitresPerHour) {
  if (!(plannedLitresPerHour > 0)) return Infinity;
  const minutesPerJar = (JAR_LITRES / plannedLitresPerHour) * 60;
  return Math.max(QUIET_FLOOR_MIN, Math.round(1.5 * minutesPerJar));
}

// A flag stays on until a later restock clears it (restocks arrive with dispatch).
const raisedAfter = (raisedAt, clearedAt) => Boolean(raisedAt) && !(clearedAt && clearedAt > raisedAt);

export function stationStatus(station, { now, clock, plannedLowLph }) {
  const needsJars = raisedAfter(station.lastJarAt, station.lastRestockAt);
  const cupsLow = raisedAfter(station.cupsLowAt, station.lastCupsRestockAt);

  const quietLimit = quietAfterMin(plannedLowLph);
  // Silence counts from the last tap, or from the start of the event if nobody has tapped yet.
  const silentSince = station.lastTapAt ? Date.parse(station.lastTapAt) : clock.known ? clock.start : null;
  const silentMin = silentSince !== null ? Math.max(0, (now - silentSince) / MIN) : null;
  const quiet = clock.live && silentMin !== null && silentMin > quietLimit;

  const status = needsJars ? 'needs_jars' : quiet ? 'quiet' : cupsLow ? 'cups_low' : 'ok';
  return {
    status,
    ...STATUS[status],
    flags: { needsJars, cupsLow, quiet },
    silentMin: silentMin === null ? null : Math.floor(silentMin),
    quietAfterMin: quietLimit,
    lastTapAt: station.lastTapAt || null,
    lastJarAt: station.lastJarAt || null,
    swapCount: station.swapCount || 0,
  };
}

// Tiles sorted most urgent first: longest-waiting "needs jars", then longest-silent "quiet".
export function boardView({ event, stations, plan }, now) {
  const clock = eventClock(event, now);
  const planByStation = Object.fromEntries((plan?.rows || []).map((r) => [r.stationId, r]));

  const tiles = stations.map((station) => {
    const hour = planByStation[station.id]?.byHour?.[clock.hourIndex];
    const s = stationStatus(station, { now, clock, plannedLowLph: hour?.low?.litres ?? 0 });
    return { station, ...s, plannedJarsPerHour: hour ? { low: hour.low.jars, high: hour.high.jars } : null };
  });

  tiles.sort((a, b) => {
    if (a.rank !== b.rank) return a.rank - b.rank;
    if (a.status === 'needs_jars') return a.lastJarAt.localeCompare(b.lastJarAt);
    if (a.status === 'quiet') return (b.silentMin ?? 0) - (a.silentMin ?? 0);
    return a.station.name.localeCompare(b.station.name);
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
