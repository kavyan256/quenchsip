// Simulation of an event's water stations, minute by minute, under two ways of sending runners:
//   "WhatsApp": volunteers message when on the last jar (sometimes) and when empty (always);
//               the lead reads messages after a delay and sends the next free runner, first come first served.
//   "Quench":   taps feed the app's real run-dry projection (src/core/projection.js); every 2 minutes it
//               sends free runners to the stations that will run dry soonest; "Last jar" dispatches at once;
//               empty stations and silent stations are flagged too.
// Missed taps are modelled: with tap rate p, each swap or last-jar tap is recorded with probability p.
// Deterministic for a given seed. Used by the demo page and unit tests. All assumptions are in DEFAULTS.
import { project } from './projection.js';
import { JAR_LITRES } from './plan.js';
import { jarsToSend } from './dispatch.js';

export const DEFAULTS = {
  minutes: 180, // a 3-hour evening
  stations: [
    { name: 'Main gate', baseLph: 70, peak: 1.0 },
    { name: 'Food court', baseLph: 90, peak: 1.3 },
    { name: 'Stage left', baseLph: 80, peak: 2.2 },
    { name: 'Stage right', baseLph: 80, peak: 2.2 },
    { name: 'Hostel road', baseLph: 50, peak: 1.0 },
    { name: 'Sports ground', baseLph: 60, peak: 1.2 },
    { name: 'Library lawn', baseLph: 45, peak: 1.0 },
    { name: 'Exit gate', baseLph: 55, peak: 1.4 },
  ],
  peakFrom: 90, // headliner from minute 90 to 150
  peakTo: 150,
  noise: 0.25, // demand varies +-25% hour to hour
  startJars: 5, // full jars at each station at the start, including the one on the tap
  runners: 3,
  tripMin: 8, // one way from the store to a station
  jarsPerTrip: 6, // WhatsApp: the lead sends a full trolley every time (Quench uses the app's own rule, see send())
  readDelayMin: 4, // WhatsApp: time until the lead reads and acts on a message
  lastJarMessageRate: 0.6, // WhatsApp: share of "last jar" moments that someone messages about
  tapRate: 0.9, // Quench: share of swaps and last-jar moments that volunteers tap
  planError: 0.3, // the plan's estimate of each station's demand is off by up to +-30%
  seed: 1,
};

// Small deterministic random number generator (mulberry32).
export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const T0 = Date.parse('2026-10-10T18:00:00Z');
const iso = (m) => new Date(T0 + m * 60000).toISOString();

// Demand per station per minute (litres), fixed by the seed, identical for both policies.
function demandTable(cfg, rand) {
  return cfg.stations.map((s) => {
    const hourly = Array.from({ length: Math.ceil(cfg.minutes / 60) }, () => 1 + cfg.noise * (2 * rand() - 1));
    return Array.from({ length: cfg.minutes }, (_, t) => {
      const peak = t >= cfg.peakFrom && t < cfg.peakTo ? s.peak : 1;
      return (s.baseLph * peak * hourly[Math.floor(t / 60)]) / 60;
    });
  });
}

export function simulate(policy, overrides = {}) {
  const cfg = { ...DEFAULTS, ...overrides };
  const demand = demandTable(cfg, rng(cfg.seed)); // same demand for both policies
  const rand = rng(cfg.seed * 7919 + (policy === 'quench' ? 1 : 2)); // taps and messages
  const plannedLph = cfg.stations.map((s, i) => s.baseLph * (1 + cfg.planError * (2 * rng(cfg.seed + 31 * i)() - 1)));

  const st = cfg.stations.map((s) => ({
    name: s.name,
    level: JAR_LITRES,
    spare: cfg.startJars - 1,
    dry: false,
    dryMin: 0,
    served: 0,
    openJob: false,
    // What the app knows (only what volunteers tapped):
    app: { stocked: true, stockedJars: cfg.startJars, stockedAt: iso(-1), swapTimes: [], restocks: [], lastJarAt: null, lastTapAt: iso(-1) },
  }));
  const runners = Array.from({ length: cfg.runners }, () => ({ freeAt: 0 }));
  const deliveries = []; // { station, at, jars }
  const inbox = []; // WhatsApp messages { station, readAt }
  const frames = [];
  let jobs = 0;

  const projectAt = (i, t) =>
    project(st[i].app, { now: T0 + t * 60000, clock: { live: true, start: T0 }, planned: { highLph: plannedLph[i] * 1.2, lowLph: plannedLph[i] * 0.8 }, runnerTripMin: cfg.tripMin });
  const send = (i, t) => {
    const r = runners.find((x) => x.freeAt <= t);
    if (!r || st[i].openJob) return false;
    r.freeAt = t + 2 * cfg.tripMin;
    st[i].openJob = true;
    // Quench sends what the real app would (src/core/dispatch.js jarsToSend).
    const jars = policy === 'quench' ? jarsToSend({ ...projectAt(i, t), minutesLeft: cfg.minutes - t }) : cfg.jarsPerTrip;
    deliveries.push({ station: i, at: t + cfg.tripMin, jars });
    jobs++;
    return true;
  };
  const tapped = () => rand() < cfg.tapRate;

  for (let t = 0; t < cfg.minutes; t++) {
    // 1. Runners arriving.
    for (const d of deliveries.filter((x) => x.at === t)) {
      const s = st[d.station];
      s.spare += d.jars;
      s.openJob = false;
      s.app.restocks.push({ at: iso(t), jars: d.jars });
      s.app.lastTapAt = iso(t);
      if (s.dry) {
        s.dry = false;
        s.spare--;
        s.level = JAR_LITRES;
        if (tapped()) s.app.swapTimes.push(iso(t));
      }
    }

    // 2. People drink.
    st.forEach((s, i) => {
      if (s.dry) {
        s.dryMin++;
        return;
      }
      let need = demand[i][t];
      while (need > 0 && !s.dry) {
        const take = Math.min(need, s.level);
        s.level -= take;
        s.served += take;
        need -= take;
        if (s.level <= 1e-9) {
          if (s.spare > 0) {
            s.spare--;
            s.level = JAR_LITRES;
            if (tapped()) {
              s.app.swapTimes.push(iso(t));
              s.app.lastTapAt = iso(t);
            }
            if (s.spare === 0) {
              // Now on the last jar.
              if (policy === 'quench' && tapped()) {
                s.app.lastJarAt = iso(t);
                s.app.lastTapAt = iso(t);
                send(i, t);
              }
              if (policy === 'whatsapp' && rand() < cfg.lastJarMessageRate) inbox.push({ station: i, readAt: t + cfg.readDelayMin });
            }
          } else {
            s.dry = true;
            // Everyone notices an empty station: a message in both worlds.
            inbox.push({ station: i, readAt: t + cfg.readDelayMin });
          }
        }
      }
    });

    // 3. Sending runners.
    if (policy === 'whatsapp' || policy === 'quench') {
      // Messages read now, first come first served (both worlds; in Quench only "empty" messages arrive here).
      for (const m of inbox.filter((x) => x.readAt <= t && !x.handled)) {
        if (st[m.station].openJob) m.handled = true;
        else if (send(m.station, t)) m.handled = true;
      }
    }
    if (policy === 'quench' && t % 2 === 0) {
      const alerts = st
        .map((s, i) => {
          const p = projectAt(i, t);
          const lastJar = Boolean(s.app.lastJarAt) && !s.app.restocks.some((r) => r.at > s.app.lastJarAt);
          return { i, need: p.alert || p.quiet || lastJar || s.dry, dryAt: p.dryAt ? Date.parse(p.dryAt) : Infinity };
        })
        .filter((a) => a.need && !st[a.i].openJob)
        .sort((a, b) => a.dryAt - b.dryAt);
      for (const a of alerts) if (!send(a.i, t)) break;
    }

    frames.push({
      t,
      dryMinutes: st.reduce((a, s) => a + s.dryMin, 0),
      stations: st.map((s) => ({ level: Math.max(0, s.level) / JAR_LITRES, spare: s.spare, dry: s.dry, job: s.openJob })),
    });
  }

  return {
    policy,
    dryMinutes: st.reduce((a, s) => a + s.dryMin, 0),
    leftover: st.reduce((a, s) => a + s.spare, 0), // full jars still at stations at the end
    stationsThatRanDry: st.filter((s) => s.dryMin > 0).length,
    litresServed: Math.round(st.reduce((a, s) => a + s.served, 0)),
    jobs,
    perStation: st.map((s) => ({ name: s.name, dryMin: s.dryMin })),
    frames,
    config: cfg,
  };
}

// Average dry minutes over several seeds, for both policies, at a given tap rate.
export function compare(overrides = {}, seeds = 20) {
  const runs = Array.from({ length: seeds }, (_, k) => ({
    whatsapp: simulate('whatsapp', { ...overrides, seed: k + 1 }).dryMinutes,
    quench: simulate('quench', { ...overrides, seed: k + 1 }).dryMinutes,
  }));
  const mean = (key) => Math.round(runs.reduce((a, r) => a + r[key], 0) / seeds);
  return { whatsapp: mean('whatsapp'), quench: mean('quench'), seeds };
}
