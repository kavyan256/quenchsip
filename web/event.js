import { api, loadPin, savePin, escape, param } from './api.js';

const $ = (id) => document.getElementById(id);
const eventId = param('e');

const showStatus = (msg, isError = false) => {
  $('actionStatus').textContent = msg;
  $('actionStatus').className = isError ? 'error' : 'small';
};

const pin = () => {
  const p = $('pin').value.trim();
  if (p) savePin(eventId, p);
  return p;
};

async function load() {
  if (!eventId) throw new Error('No event in the link. Start from the plan page.');
  const data = await api('GET', `/events/${eventId}`);
  const { event, stations, runners, plan, warnings } = data;
  const byStation = Object.fromEntries(plan.rows.map((r) => [r.stationId, r.total]));

  document.title = `${event.name} · QuenchSip`;
  $('title').textContent = event.name;
  $('subtitle').textContent = `${event.attendees.toLocaleString('en-IN')} people · ${data.hours[0]} for ${event.hourCount} h · order ${plan.total.jarsLow}–${plan.total.jarsHigh} jars, ${plan.total.cupsLow.toLocaleString('en-IN')}–${plan.total.cupsHigh.toLocaleString('en-IN')} cups`;
  $('qrLink').href = `qr.html?e=${eventId}`;
  $('boardLink').href = `board.html?e=${eventId}`;

  $('warnings').innerHTML = warnings.length
    ? `<div class="status warn"><strong>Fix before the event:</strong><ul>${warnings.map((w) => `<li>${escape(w)}</li>`).join('')}</ul></div>`
    : '<div class="status ok"><strong>Ready.</strong> Enough stations, volunteers, a supplier and signal.</div>';

  $('stations').innerHTML = stations
    .map((s) => {
      const t = byStation[s.id];
      return `<li><span><strong>${escape(s.name)}</strong> <span class="small">${escape(s.zone)} · ${t.jarsLow}–${t.jarsHigh} jars</span></span>
        <button class="ghost" type="button" data-remove-station="${s.id}" aria-label="Remove ${escape(s.name)}">Remove</button></li>`;
    })
    .join('');
  $('zones').innerHTML = [...new Set(stations.map((s) => s.zone))].map((z) => `<option value="${escape(z)}">`).join('');

  $('runners').innerHTML = runners.length
    ? runners
        .map((r) => `<li><span>${escape(r.name)}</span><button class="ghost" type="button" data-remove-runner="${r.id}" aria-label="Remove ${escape(r.name)}">Remove</button></li>`)
        .join('')
    : '<li class="small">No runners yet.</li>';

  $('content').hidden = false;
}

// Runs an organiser action; returns true if it worked.
async function act(fn, done) {
  if (!pin()) {
    showStatus('Enter the organiser PIN first.', true);
    $('pin').focus();
    return false;
  }
  try {
    await fn();
    showStatus(done);
    await load();
    return true;
  } catch (err) {
    showStatus(err.message, true);
    return false;
  }
}

$('addStation').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = new FormData(e.target);
  if (await act(() => api('POST', `/events/${eventId}/stations`, { pin: pin(), body: { name: f.get('name'), zone: f.get('zone') } }), 'Station added.')) e.target.reset();
});

$('addRunner').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = new FormData(e.target);
  if (await act(() => api('POST', `/events/${eventId}/runners`, { pin: pin(), body: { name: f.get('name') } }), 'Runner added.')) e.target.reset();
});

$('stations').addEventListener('click', (e) => {
  const sid = e.target.dataset.removeStation;
  if (sid) act(() => api('DELETE', `/events/${eventId}/stations/${sid}`, { pin: pin() }), 'Station removed.');
});

$('runners').addEventListener('click', (e) => {
  const rid = e.target.dataset.removeRunner;
  if (rid) act(() => api('DELETE', `/events/${eventId}/runners/${rid}`, { pin: pin() }), 'Runner removed.');
});

$('pin').value = loadPin(eventId);
load().catch((err) => {
  $('title').textContent = 'Event not available';
  $('loadError').textContent = err.message;
  $('loadError').hidden = false;
});
