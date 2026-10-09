// "My events" on this device, and the organiser key from the private link (…#k=<key>).
// The key sits after "#", so it never reaches the server's logs; the page sends it in a header.
const KEY = 'qs-my-events';

export function myEvents() {
  try {
    return JSON.parse(localStorage.getItem(KEY)) || [];
  } catch {
    return [];
  }
}

export function rememberEvent({ id, name, startsAt, key }) {
  const list = myEvents().filter((e) => e.id !== id);
  const old = myEvents().find((e) => e.id === id);
  list.unshift({ id, name, startsAt, key: key || old?.key || null, savedAt: new Date().toISOString() });
  try {
    localStorage.setItem(KEY, JSON.stringify(list.slice(0, 20)));
  } catch {}
}

// Key from the link (and remember it), else the one saved on this device, else null (view only).
export function organiserKey(eventId) {
  const fromLink = new URLSearchParams(location.hash.slice(1)).get('k');
  if (fromLink) return fromLink;
  return myEvents().find((e) => e.id === eventId)?.key || null;
}

export const organiserLink = (eventId, key) => `${location.origin}/event.html?e=${eventId}#k=${key}`;
