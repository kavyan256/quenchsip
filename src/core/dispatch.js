// Runner dispatch decisions. Pure functions, unit-tested.

export const JOB_STATES = {
  waiting: 'Waiting for a free runner',
  assigned: 'Runner assigned, not confirmed yet',
  acked: 'Runner on the way',
  done: 'Delivered',
  unassigned: 'No runner was free',
  stale: 'Not confirmed as delivered',
  cancelled: 'Cancelled',
};
export const OPEN_STATES = new Set(['waiting', 'assigned', 'acked']);

export const MAX_JARS_PER_TRIP = 6; // what one runner can move in one trip (trolley); adjustable
export const MIN_JARS_PER_TRIP = 2; // never send a runner across the ground with a single jar
const COVER_MIN = 120; // each delivery should last about 2 hours at the station's own rate

// How many jars to send: enough for about 2 hours at the station's rate, minus what is still there.
// Runner time is the scarce thing at a busy event, not jars: small top-ups mean more trips, and at the peak
// the next runner may not reach this station for a long time. The simulation (src/core/sim.js) showed a
// 1-hour top-up losing to a WhatsApp group; 2 hours with at least 2 jars wins in most runs.
export function jarsToSend({ intervalMin, jarsLeft }) {
  const needed = intervalMin > 0 ? Math.ceil(COVER_MIN / intervalMin) : MIN_JARS_PER_TRIP;
  const need = needed - (jarsLeft ?? 0);
  return Math.min(MAX_JARS_PER_TRIP, Math.max(MIN_JARS_PER_TRIP, need));
}

// Free runner who has waited longest since their last job; never one already tried for this job.
export function pickRunner(runners, excluded = []) {
  const skip = new Set(excluded);
  const free = runners.filter((r) => r.status === 'free' && !skip.has(r.id));
  // Ties (runners added together) go by name, so the choice is predictable.
  free.sort((a, b) => (a.freeSince || a.createdAt || '').localeCompare(b.freeSince || b.createdAt || '') || (a.name || '').localeCompare(b.name || '') || a.id.localeCompare(b.id));
  return free[0] || null;
}

// Whether to open a job for a station that needs jars, and whether to start its state machine now.
//   no_runners: the event has no runners, so a job could never be assigned (the board already shows "needs jars").
//   wait: open the job, but start the state machine only when a runner is free (the scheduled check retries),
//         so a busy team costs nothing while it waits instead of a retry loop of state transitions.
//   start: a runner is free now.
export function dispatchDecision(runners, excluded = []) {
  if (!runners?.length) return 'no_runners';
  return pickRunner(runners, excluded) ? 'start' : 'wait';
}

// Plain words for a job on the board or the runner's screen.
export function jobLine(job) {
  if (!job) return '';
  const who = job.runnerName ? `${job.runnerName}: ` : '';
  return `${who}${JOB_STATES[job.state] || job.state}`;
}

// Minutes from alert to delivery for finished jobs; median for the summary.
export function median(values) {
  const v = values.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (!v.length) return null;
  const mid = Math.floor(v.length / 2);
  return v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2;
}
