// When will a station run dry? Pure functions, shared by the scheduled Lambda and the live board,
// so both always agree.
import { JAR_LITRES } from './plan.js';

const MIN = 60 * 1000;
export const DEFAULT_RUNNER_TRIP_MIN = 10;
export const ALERT_BUFFER_MIN = 10; // send a runner this long before the runner's trip would be too late
export const QUIET_FLOOR_MIN = 10;
const MEASURED_INTERVALS = 3; // average of the last 3 gaps between swaps

const minutesPerJar = (litresPerHour) => (litresPerHour > 0 ? (JAR_LITRES / litresPerHour) * 60 : null);
const sortedMs = (list) => (list || []).map((x) => Date.parse(typeof x === 'string' ? x : x.at)).filter(Number.isFinite).sort((a, b) => a - b);

// Minutes one jar lasts: measured from recent swaps once there are two, else from the plan.
export function swapInterval(swapTimes, plannedLitresPerHour) {
  const t = sortedMs(swapTimes);
  if (t.length >= 2) {
    const recent = t.slice(-(MEASURED_INTERVALS + 1));
    const gaps = recent.slice(1).map((x, i) => (x - recent[i]) / MIN);
    return { intervalMin: gaps.reduce((a, b) => a + b, 0) / gaps.length, source: 'measured' };
  }
  const planned = minutesPerJar(plannedLitresPerHour);
  return planned ? { intervalMin: planned, source: 'plan' } : { intervalMin: null, source: 'none' };
}

// Full jars still at the station, counting the one on the tap. null = not known.
//  - after "Last jar": 1, minus swaps since, plus jars restocked since
//  - else, once the start stock is known: stocked + restocked - swapped
export function jarsLeft(station) {
  const swaps = sortedMs(station.swapTimes);
  const restocks = (station.restocks || []).map((r) => ({ at: Date.parse(r.at), jars: r.jars || 0 }));
  if (station.lastJarAt) {
    const since = Date.parse(station.lastJarAt);
    const left = 1 - swaps.filter((t) => t > since).length + restocks.filter((r) => r.at > since).reduce((a, r) => a + r.jars, 0);
    return Math.max(0, left);
  }
  if (Number.isFinite(station.stockedJars)) {
    return Math.max(0, station.stockedJars + restocks.reduce((a, r) => a + r.jars, 0) - swaps.length);
  }
  return null;
}

// Full projection for one station at `now`.
// planned: { highLph, lowLph } this hour; clock: { live, start }; runnerTripMin: minutes for a runner to reach it.
export function project(station, { now, clock, planned, runnerTripMin = DEFAULT_RUNNER_TRIP_MIN }) {
  const { intervalMin, source } = swapInterval(station.swapTimes, planned.highLph);
  const left = jarsLeft(station);

  // The jar in use went on at the last swap, or at the start of the event (or when stocked) if none yet.
  const swaps = sortedMs(station.swapTimes);
  const anchor = swaps.length ? swaps[swaps.length - 1] : clock?.start ?? (station.stockedAt ? Date.parse(station.stockedAt) : null);

  let dryAt = null;
  if (left !== null && intervalMin && anchor !== null) dryAt = anchor + left * intervalMin * MIN;
  const minutesToDry = dryAt === null ? null : (dryAt - now) / MIN;
  const alert = minutesToDry !== null && minutesToDry < runnerTripMin + ALERT_BUFFER_MIN;

  // Quiet: no tap for 1.5x the time a jar lasts. With no measurements yet, use the plan's low estimate
  // (longer per jar), so a slow start does not raise false alarms.
  const quietBase = source === 'measured' ? intervalMin : minutesPerJar(planned.lowLph);
  const quietAfterMin = quietBase ? Math.max(QUIET_FLOOR_MIN, Math.round(1.5 * quietBase)) : Infinity;
  const silentSince = station.lastTapAt ? Date.parse(station.lastTapAt) : clock?.start ?? null;
  const silentMin = silentSince === null ? null : Math.max(0, (now - silentSince) / MIN);
  const quiet = Boolean(clock?.live) && silentMin !== null && silentMin > quietAfterMin;

  return {
    intervalMin: intervalMin === null ? null : Math.round(intervalMin * 10) / 10,
    intervalSource: source,
    jarsLeft: left,
    dryAt: dryAt === null ? null : new Date(dryAt).toISOString(),
    minutesToDry: minutesToDry === null ? null : Math.round(minutesToDry),
    dry: minutesToDry !== null && minutesToDry <= 0,
    alert,
    quiet,
    silentMin: silentMin === null ? null : Math.floor(silentMin),
    quietAfterMin,
  };
}
