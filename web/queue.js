// The phone's tap queue, kept in IndexedDB so taps survive no signal, reloads and the browser closing.
// IndexedDB works on plain http:// too (unlike service workers).
const DB_NAME = 'quenchsip';
const STORE = 'taps';
const KEEP_SENT_MS = 24 * 60 * 60 * 1000;

let dbPromise;
function openDb() {
  dbPromise ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const store = req.result.createObjectStore(STORE, { keyPath: 'uuid' });
      store.createIndex('station', ['eventId', 'stationId']);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

async function run(mode, fn) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const result = fn(tx.objectStore(STORE));
    tx.oncomplete = () => resolve(result?.result ?? result);
    tx.onerror = () => reject(tx.error);
  });
}

export const saveTap = (tap) => run('readwrite', (s) => s.put(tap));

export async function stationTaps(eventId, stationId) {
  const all = await run('readonly', (s) => s.index('station').getAll([eventId, stationId]));
  return all.sort((a, b) => a.at.localeCompare(b.at));
}

// Drop sent taps older than a day so the phone does not fill up.
export async function pruneSent(eventId, stationId, now = Date.now()) {
  const old = (await stationTaps(eventId, stationId)).filter((t) => t.status === 'sent' && now - Date.parse(t.at) > KEEP_SENT_MS);
  await run('readwrite', (s) => old.forEach((t) => s.delete(t.uuid)));
}
