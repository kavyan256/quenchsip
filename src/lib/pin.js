// Organiser PIN hashing (scrypt + random salt). Node only.
import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

export function hashPin(pin) {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(pin, salt, 32).toString('hex');
  return `${salt}:${hash}`;
}

export function verifyPin(pin, stored) {
  if (typeof pin !== 'string' || typeof stored !== 'string' || !stored.includes(':')) return false;
  const [salt, hash] = stored.split(':');
  const expected = Buffer.from(hash, 'hex');
  const actual = scryptSync(pin, salt, expected.length);
  return timingSafeEqual(expected, actual);
}

// Short, URL-safe ids without look-alike characters.
const ALPHABET = '23456789abcdefghjkmnpqrstuvwxyz';
export function newId(length = 8) {
  const bytes = randomBytes(length);
  return Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length]).join('');
}

// Compares a link secret without leaking how much of it matched (both sides hashed to the same length).
export function sameSecret(given, stored) {
  if (typeof given !== 'string' || typeof stored !== 'string') return false;
  const h = (x) => createHash('sha256').update(x).digest();
  return timingSafeEqual(h(given), h(stored));
}
