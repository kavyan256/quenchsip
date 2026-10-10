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
export const MIN_JARS_PER_TRIP = 2; // never send a runner across the ground with a single jar (unless that's all it needs)
const COVER_MIN = 120; // each delivery should last about 2 hours at the station's own rate
const END_BUFFER_MIN = 45; // near the end, send what's needed until closing plus this margin

// How many jars to send, from the station's measured rate (minutes per jar):
// - about 2 hours' worth, 2 to 6 jars (a trolley load). Runner time is the scarce thing at a busy event, not jars.
// - NOT minus the jars the app thinks are left: a missed "Jar swapped" tap makes that number too high,
//   and subtracting it sent too little exactly when it mattered.
// - near the end of the event, only what's needed until closing plus 45 minutes.
// Chosen with the simulation (src/core/sim.js) across 2-4 runners, 5-12 minute walks and 70-90% tapping.
export function jarsToSend({ intervalMin, minutesLeft }) {
  const rate = intervalMin > 0 ? intervalMin : null;
  let jars = rate ? Math.ceil(COVER_MIN / rate) : MIN_JARS_PER_TRIP;
  jars = Math.min(MAX_JARS_PER_TRIP, Math.max(MIN_JARS_PER_TRIP, jars));
  if (rate && Number.isFinite(minutesLeft)) jars = Math.min(jars, Math.max(1, Math.ceil((Math.max(0, minutesLeft) + END_BUFFER_MIN) / rate)));
  return jars;
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
