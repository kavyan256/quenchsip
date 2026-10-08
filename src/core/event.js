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

export const validateStation = (s) => ({
  name: text(s?.name, 'Station name', LIMITS.label),
  zone: text(s?.zone, 'Zone', LIMITS.label),
});

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
  const zones = new Set(cleanStations.map((s) => s.zone));
  const share = {};
  for (const zone of zones) {
    const row = input?.share?.[zone];
    if (!Array.isArray(row) || row.length !== hourCount) fail(`Crowd share for zone "${zone}" must have one value per hour.`);
    share[zone] = row.map((v) => number(v, `Crowd share for ${zone}`, 0, 1));
  }

  const low = number(input?.litresPerPersonHr?.low, 'Water per person per hour (low)', 0, 5);
  const high = number(input?.litresPerPersonHr?.high, 'Water per person per hour (high)', 0, 5);
  if (low > high) fail('Low water per person must not be more than high.');

  return {
    name: text(input?.name, 'Event name', LIMITS.name),
    attendees: number(input?.attendees, 'People expected', 1, 500000, { integer: true }),
    startHour: number(input?.startHour, 'Start hour', 0, 23, { integer: true }),
    hourCount,
    heatFactor: number(input?.heatFactor ?? 1, 'Weather factor', 0.5, 3),
    litresPerPersonHr: { low, high },
    share,
    volunteerCount: number(input?.volunteerCount ?? 0, 'Volunteers', 0, 10000, { integer: true }),
    jarSupplier: input?.jarSupplier !== false,
    signal: input?.signal !== false,
    stations: cleanStations,
    runners: runners.map(validateRunner),
  };
}

export const hourLabels = (startHour, hourCount) =>
  Array.from({ length: hourCount }, (_, i) => `${String((startHour + i) % 24).padStart(2, '0')}:00`);
