// Who is calling? Organisers sign in with Amazon Cognito; the browser sends the Cognito ID token as
// "Authorization: Bearer <token>". The API checks the token itself (signature against the user pool's
// public keys, issuer, audience, expiry) and takes the user id from the verified token, never from the client.
//
// Local development and tests have no Cognito: when AUTH_LOCAL_SECRET is set (never on AWS), tokens
// signed with that secret are accepted instead, and issueLocalToken() makes one.
import { createHmac, createPublicKey, timingSafeEqual, verify } from 'node:crypto';
import { HttpError } from './events.js';

const b64url = (buf) => Buffer.from(buf).toString('base64url');
const fromB64 = (s) => JSON.parse(Buffer.from(s, 'base64url').toString());

let jwks = null; // the user pool's public keys, fetched once per Lambda instance
async function cognitoKey(kid) {
  const region = process.env.AWS_REGION;
  const url = `https://cognito-idp.${region}.amazonaws.com/${process.env.COGNITO_USER_POOL_ID}/.well-known/jwks.json`;
  if (!jwks || !jwks[kid]) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Could not load Cognito keys (${res.status})`);
    jwks = Object.fromEntries((await res.json()).keys.map((k) => [k.kid, createPublicKey({ key: k, format: 'jwk' })]));
  }
  return jwks[kid];
}

const invalid = () => new HttpError(401, 'Your sign-in has expired. Please sign in again.');

// Returns { sub, email } for a valid token, null when there is no token, and throws 401 for a bad one.
export async function userFromToken(token, now = Date.now()) {
  if (!token) return null;
  const parts = token.split('.');
  if (parts.length !== 3) throw invalid();
  let header, claims;
  try {
    header = fromB64(parts[0]);
    claims = fromB64(parts[1]);
  } catch {
    throw invalid();
  }
  const signed = `${parts[0]}.${parts[1]}`;
  const sig = Buffer.from(parts[2], 'base64url');

  if (process.env.AUTH_LOCAL_SECRET) {
    if (header.alg !== 'HS256') throw invalid();
    const expected = createHmac('sha256', process.env.AUTH_LOCAL_SECRET).update(signed).digest();
    if (sig.length !== expected.length || !timingSafeEqual(sig, expected)) throw invalid();
  } else {
    if (!process.env.COGNITO_USER_POOL_ID) throw new HttpError(503, 'Sign-in is not set up on this server.');
    if (header.alg !== 'RS256' || !header.kid) throw invalid();
    const key = await cognitoKey(header.kid);
    if (!key || !verify('RSA-SHA256', Buffer.from(signed), key, sig)) throw invalid();
    const iss = `https://cognito-idp.${process.env.AWS_REGION}.amazonaws.com/${process.env.COGNITO_USER_POOL_ID}`;
    if (claims.iss !== iss || claims.aud !== process.env.COGNITO_CLIENT_ID || claims.token_use !== 'id') throw invalid();
  }
  if (!claims.sub || !(claims.exp * 1000 > now)) throw invalid();
  return { sub: claims.sub, email: String(claims.email || '').toLowerCase() };
}

// Local dev and tests only: a signed token for an email (the "user id" is derived from the email).
export function issueLocalToken(email, ttlSec = 3600) {
  const secret = process.env.AUTH_LOCAL_SECRET;
  if (!secret) throw new HttpError(404, 'Not found.');
  const e = String(email || '').trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)) throw new HttpError(400, 'Enter a valid email address.');
  const sub = `local-${createHmac('sha256', 'sub').update(e).digest('hex').slice(0, 16)}`;
  const head = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = b64url(JSON.stringify({ sub, email: e, token_use: 'id', exp: Math.floor(Date.now() / 1000) + ttlSec }));
  const sig = createHmac('sha256', secret).update(`${head}.${body}`).digest('base64url');
  return `${head}.${body}.${sig}`;
}

// The demo account for judges has tighter limits (see events.js).
export const isDemo = (user) => Boolean(user && process.env.DEMO_EMAIL && user.email === process.env.DEMO_EMAIL.toLowerCase());
