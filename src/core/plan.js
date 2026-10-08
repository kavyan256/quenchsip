// Plan calculator: how many jars and cups each station needs per hour.
// Pure functions, shared by the browser and (later) the Lambda functions.

export const JAR_LITRES = 20;
export const CUP_LITRES = 0.2; // assumed 200 ml per cup
export const PEOPLE_PER_OUTLET = 500; // NT (Australia) public-event guidance

// Sourced in IDEA.md: high = 500 ml/person/hr (outdoor summer advisory),
// low = 250 ml/person/hr (assumption for cool or seated events).
export const DEFAULT_LITRES_PER_PERSON_HR = { low: 0.25, high: 0.5 };

// Stops float noise (300.00000000000006) from adding an extra jar.
const tidy = (x) => Math.round(x * 1000) / 1000;

export function stationHourDemand(people, litresPerPersonHr, heatFactor = 1) {
  const litres = tidy(people * litresPerPersonHr * heatFactor);
  return {
    litres,
    jars: Math.ceil(tidy(litres / JAR_LITRES)),
    cups: Math.ceil(tidy(litres / CUP_LITRES)),
  };
}

// stations: [{ id, name, zone }]
// share: { [zone]: number[] } fraction of attendees in that zone for each hour.
// Stations in the same zone split that zone's crowd equally.
export function planEvent({
  attendees,
  hours,
  stations,
  share,
  litresPerPersonHr = DEFAULT_LITRES_PER_PERSON_HR,
  heatFactor = 1,
}) {
  const perZone = {};
  for (const s of stations) perZone[s.zone] = (perZone[s.zone] || 0) + 1;

  const rows = stations.map((s) => {
    const zoneShare = share[s.zone] || [];
    const byHour = hours.map((label, h) => {
      const people = (attendees * (zoneShare[h] || 0)) / perZone[s.zone];
      return {
        hour: label,
        people: Math.round(people),
        low: stationHourDemand(people, litresPerPersonHr.low, heatFactor),
        high: stationHourDemand(people, litresPerPersonHr.high, heatFactor),
      };
    });
    const litresLow = tidy(byHour.reduce((t, x) => t + x.low.litres, 0));
    const litresHigh = tidy(byHour.reduce((t, x) => t + x.high.litres, 0));
    return { station: s, byHour, total: totalsFor(litresLow, litresHigh) };
  });

  const sum = (key) => rows.reduce((t, r) => t + r.total[key], 0);
  return {
    rows,
    total: {
      litresLow: tidy(sum('litresLow')),
      litresHigh: tidy(sum('litresHigh')),
      jarsLow: sum('jarsLow'),
      jarsHigh: sum('jarsHigh'),
      cupsLow: sum('cupsLow'),
      cupsHigh: sum('cupsHigh'),
    },
    warnings: shareWarnings(share, hours.length),
  };
}

// A station needs whole jars, so jars are rounded up per station, then summed.
function totalsFor(litresLow, litresHigh) {
  return {
    litresLow,
    litresHigh,
    jarsLow: Math.ceil(tidy(litresLow / JAR_LITRES)),
    jarsHigh: Math.ceil(tidy(litresHigh / JAR_LITRES)),
    cupsLow: Math.ceil(tidy(litresLow / CUP_LITRES)),
    cupsHigh: Math.ceil(tidy(litresHigh / CUP_LITRES)),
  };
}

// Flags hours where zone shares add up to more than 100% of attendees.
export function shareWarnings(share, hourCount) {
  const warnings = [];
  for (let h = 0; h < hourCount; h++) {
    const total = Object.values(share).reduce((t, z) => t + (z[h] || 0), 0);
    if (total > 1.0001) {
      warnings.push(`Hour ${h + 1}: zone shares add up to ${Math.round(total * 100)}%, more than everyone at the event.`);
    }
  }
  return warnings;
}

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

// Plain-language readiness check before the event.
export function readiness({ attendees, stationCount, volunteerCount, jarSupplier, signal }) {
  const warnings = [];
  const stationsNeeded = Math.ceil(attendees / PEOPLE_PER_OUTLET);
  if (stationCount < stationsNeeded) {
    warnings.push(`You have ${plural(stationCount, 'water station')}. For ${attendees} people you need at least ${stationsNeeded} (1 per ${PEOPLE_PER_OUTLET}).`);
  }
  if (volunteerCount !== undefined && volunteerCount < stationCount) {
    warnings.push(`You have ${plural(volunteerCount, 'volunteer')} for ${plural(stationCount, 'station')}. Each station needs its own volunteer.`);
  }
  if (jarSupplier === false) {
    warnings.push('No jar supplier confirmed. There is nothing to restock from.');
  }
  if (signal === false) {
    warnings.push('Weak mobile signal at the venue. Taps will wait on phones and alerts may be late.');
  }
  return { ok: warnings.length === 0, stationsNeeded, warnings };
}
