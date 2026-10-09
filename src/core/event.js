// Event input validation. Pure functions, shared by the browser and the API.

export const LIMITS = { stations: 50, runners: 30, hours: 24, name: 80, label: 40 };

export class ValidationError extends Error {}

const fail = (msg) => {
  throw new ValidationError(msg);
};

const text = (v, field, max) => {
  const s = typeof v === 'string' ? v.trim() : '';
  if (!s) fail(`${field} is required.`);
  if (s.length > max) fail(`${field} must be ${max} characters or fewer.`);
  return s;
};

const number = (v, field, min, max, { integer = false } = {}) => {
  const n = Number(v);
  if (!Number.isFinite(n) || n < min || n > max) fail(`${field} must be between ${min} and ${max}.`);
  if (integer && !Number.isInteger(n)) fail(`${field} must be a whole number.`);
  return n;
};

export const validatePin = (pin) => {
  if (typeof pin !== 'string' || !/^\d{4,8}$/.test(pin)) fail('PIN must be 4 to 8 digits.');
  return pin;
};

const optionalText = (v, field, max) => {
  const s = typeof v === 'string' ? v.trim() : '';
  if (s.length > max) fail(`${field} must be ${max} characters or fewer.`);
  return s;
};

// Zone is optional (older events used zones; new ones use "busy spot" instead).
export const validateStation = (s) => ({
  name: text(s?.name, 'Station name', LIMITS.label),
  zone: optionalText(s?.zone, 'Zone', LIMITS.label),
  busy: s?.busy === true,
});

// Editing a station later: any of name, busy.
export function validateStationPatch(p) {
  const out = {};
  if (p?.name !== undefined) out.name = text(p.name, 'Station name', LIMITS.label);
  if (p?.busy !== undefined) out.busy = p.busy === true;
  if (!Object.keys(out).length) fail('Nothing to change.');
  return out;
}

// Default crowd split: every station gets an equal share, a busy spot counts double.
// Keyed by station id, the same for every hour.
export function crowdShare(stations, hourCount) {
  const weight = (s) => (s.busy ? 2 : 1);
  const total = stations.reduce((a, s) => a + weight(s), 0) || 1;
  return Object.fromEntries(stations.map((s) => [s.id, Array(hourCount).fill(weight(s) / total)]));
}

export const validateRunner = (r) => ({ name: text(r?.name, 'Runner name', LIMITS.label) });

// Returns a clean event definition, or throws ValidationError with a plain-language message.
export function validateEvent(input) {
  const hourCount = number(input?.hourCount, 'Hours', 1, LIMITS.hours, { integer: true });
  const stations = Array.isArray(input?.stations) ? input.stations : [];
  if (stations.length < 1) fail('Add at least one water station.');
  if (stations.length > LIMITS.stations) fail(`At most ${LIMITS.stations} stations.`);
  const runners = Array.isArray(input?.runners) ? input.runners : [];
  if (runners.length > LIMITS.runners) fail(`At most ${LIMITS.runners} runners.`);

  const cleanStations = stations.map(validateStation);
  // Crowd split per zone and hour is optional. Without it, stations share the crowd equally (busy spots double).
  let share;
  if (input?.share !== undefined) {
    share = {};
    for (const zone of new Set(cleanStations.map((s) => s.zone))) {
      const row = input.share?.[zone];
      if (!Array.isArray(row) || row.length !== hourCount) fail(`Crowd share for zone "${zone}" must have one value per hour.`);
      share[zone] = row.map((v) => number(v, `Crowd share for ${zone}`, 0, 1));
    }
  }

  // Defaults: 0.25-0.5 L per person per hour (sources in README).
  const low = number(input?.litresPerPersonHr?.low ?? 0.25, 'Water per person per hour (low)', 0, 5);
  const high = number(input?.litresPerPersonHr?.high ?? 0.5, 'Water per person per hour (high)', 0, 5);
  if (low > high) fail('Low water per person must not be more than high.');

  // When the event starts (ISO time). Optional for older events; the board needs it to know if the event is live.
  let startsAt;
  if (input?.startsAt !== undefined) {
    const t = Date.parse(input.startsAt);
    if (!Number.isFinite(t)) fail('Event date and start time are not valid.');
    startsAt = new Date(t).toISOString();
  }

  return {
    name: text(input?.name, 'Event name', LIMITS.name),
    startsAt,
    attendees: number(input?.attendees, 'People expected', 1, 500000, { integer: true }),
    startHour: number(input?.startHour ?? 0, 'Start hour', 0, 23, { integer: true }),
    hourCount,
    heatFactor: number(input?.heatFactor ?? 1, 'Weather factor', 0.5, 3),
    runnerTripMin: number(input?.runnerTripMin ?? 10, 'Runner trip time', 1, 120),
    litresPerPersonHr: { low, high },
    share,
    // Readiness answers are optional: unknown means no warning.
    volunteerCount: input?.volunteerCount === undefined ? undefined : number(input.volunteerCount, 'Volunteers', 0, 10000, { integer: true }),
    jarSupplier: input?.jarSupplier === undefined ? undefined : input.jarSupplier !== false,
    signal: input?.signal === undefined ? undefined : input.signal !== false,
    stations: cleanStations,
    runners: runners.map(validateRunner),
  };
}

export const hourLabels = (startHour, hourCount) =>
  Array.from({ length: hourCount }, (_, i) => `${String((startHour + i) % 24).padStart(2, '0')}:00`);

// Organiser edits after creation ("Fine-tune" and the set-up checklist).
export function validateEventPatch(p) {
  const out = {};
  if (p?.runnerTripMin !== undefined) out.runnerTripMin = number(p.runnerTripMin, 'Runner walking time', 1, 120);
  if (p?.heatFactor !== undefined) out.heatFactor = number(p.heatFactor, 'Weather factor', 0.5, 3);
  if (p?.litresPerPersonHr !== undefined) {
    const low = number(p.litresPerPersonHr.low, 'Water per person per hour (low)', 0, 5);
    const high = number(p.litresPerPersonHr.high, 'Water per person per hour (high)', 0, 5);
    if (low > high) fail('Low water per person must not be more than high.');
    out.litresPerPersonHr = { low, high };
  }
  if (p?.volunteerCount !== undefined) out.volunteerCount = number(p.volunteerCount, 'Volunteers', 0, 10000, { integer: true });
  for (const k of ['jarSupplier', 'signal']) if (p?.[k] !== undefined) out[k] = p[k] === true;
  if (p?.setup !== undefined) {
    out.setup = {};
    for (const k of ['ordered', 'linksShared']) if (p.setup?.[k] !== undefined) out.setup[k] = p.setup[k] === true;
  }
  if (!Object.keys(out).length) fail('Nothing to change.');
  return out;
}
