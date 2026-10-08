// Decisions for the phone's tap queue. Pure functions, unit-tested.

// What to do with a queued tap after trying to send it.
// status 0 = no response (offline, timeout, server unreachable).
export function outcome(status) {
  if (status >= 200 && status < 300) return 'sent'; // 201 new, 200 already stored
  if (status === 0 || status === 408 || status === 429 || status >= 500) return 'retry';
  return 'failed'; // 4xx: retrying will not help (bad tap, station removed)
}

// Wait before the next retry: 1 s, 2 s, 4 s ... capped at 30 s, with up to 20% jitter
// so many phones coming back online do not all retry at the same moment.
export function retryDelay(attempt, random = Math.random) {
  const base = Math.min(30000, 1000 * 2 ** Math.max(0, attempt));
  return Math.round(base * (1 + 0.2 * random()));
}

// One line for the volunteer: is everything sent?
export function queueSummary(taps) {
  const waiting = taps.filter((t) => t.status === 'pending').length;
  const failed = taps.filter((t) => t.status === 'failed').length;
  if (failed) return { kind: 'warn', text: `${failed} tap${failed === 1 ? '' : 's'} could not be saved. Tell the organiser.` };
  if (waiting) return { kind: 'pending', text: `${waiting} tap${waiting === 1 ? '' : 's'} saved on this phone, waiting to send.` };
  return { kind: 'ok', text: 'All taps sent.' };
}
