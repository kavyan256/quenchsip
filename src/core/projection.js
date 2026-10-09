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
// Whichever is newer decides:
//  - "Last jar" tapped: 1, minus swaps since, plus jars restocked since
//  - stock count (start of event or a recount): counted jars, minus swaps since, plus jars restocked since
export function jarsLeft(station) {
  const swaps = sortedMs(station.swapTimes);
  const restocks = (station.restocks || []).map((r) => ({ at: Date.parse(r.at), jars: r.jars || 0 }));
  const lastJar = station.lastJarAt ? Date.parse(station.lastJarAt) : null;
  const stockKnown = Number.isFinite(station.stockedJars);
  const stockAt = stockKnown && station.stockedAt ? Date.parse(station.stockedAt) : -Infinity;

  const fromBase = (base, since) =>
    Math.max(0, base - swaps.filter((t) => t > since).length + restocks.filter((r) => r.at > since).reduce((a, r) => a + r.jars, 0));

  if (lastJar !== null && (!stockKnown || lastJar >= stockAt)) return fromBase(1, lastJar);
  if (stockKnown) return fromBase(station.stockedJars, stockAt);
  return null;
}

// Full projection for one station at `now`.
// planned: { highLph, lowLph } this hour; clock: { live, start }; runnerTripMin: minutes for a runner to reach it.
export function project(station, { now, clock, planned, runnerTripMin = DEFAULT_RUNNER_TRIP_MIN }) {
  const { intervalMin, source } = swapInterval(station.swapTimes, planned.highLph);
  const left = jarsLeft(station);

  // The jar in use went on at the last swap, or was full when the station was stocked (whichever is later).
  // With neither, assume it went on when the event started.
  const swaps = sortedMs(station.swapTimes);
  const lastSwap = swaps.length ? swaps[swaps.length - 1] : null;
  const stockedAt = station.stockedAt ? Date.parse(station.stockedAt) : null;
  const known = [lastSwap, stockedAt].filter((x) => x !== null);
  const anchor = known.length ? Math.max(...known) : clock?.start ?? null;

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
