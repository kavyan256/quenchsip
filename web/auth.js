// Organiser accounts (Amazon Cognito). The browser talks to Cognito's API directly (no SDK); the Quench API
// then checks the ID token itself. Locally there's no Cognito: a stand-in on the dev server signs tokens.
// Importing this module makes api() send the signed-in organiser's token.
import { API, setTokenSource } from './api.js';

const KEY = 'qs-auth';
let config = null;
async function getConfig() {
  config ??= await fetch(`${API}/config`).then((r) => r.json());
  return config;
}

const load = () => { try { return JSON.parse(localStorage.getItem(KEY)); } catch { return null; } };
const keep = (s) => { try { if (s) localStorage.setItem(KEY, JSON.stringify(s)); else localStorage.removeItem(KEY); } catch {} };
const claims = (jwt) => JSON.parse(atob(jwt.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));

export class AuthError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

// Cognito's error names, in plain words.
const MESSAGES = {
  NotAuthorizedException: 'Wrong email or password.',
  UserNotFoundException: 'Wrong email or password.',
  UsernameExistsException: 'An account with this email already exists. Sign in instead.',
  UserNotConfirmedException: 'Please verify your email first. We can send you a new code.',
  CodeMismatchException: "That code isn't right. Check the email and try again.",
  ExpiredCodeException: 'That code has expired. Send a new one.',
  InvalidPasswordException: 'Use at least 8 characters, with a number.',
  InvalidParameterException: 'Check the email address and password.',
  LimitExceededException: 'Too many tries. Wait a minute and try again.',
  TooManyRequestsException: 'Too many tries. Wait a minute and try again.',
};

async function cognito(action, body) {
  const c = await getConfig();
  let res;
  try {
    res = await fetch(`https://cognito-idp.${c.region}.amazonaws.com/`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-amz-json-1.1', 'x-amz-target': `AWSCognitoIdentityProviderService.${action}` },
      body: JSON.stringify({ ClientId: c.clientId, ...body }),
    });
  } catch {
    throw new AuthError('Network', 'Cannot reach the sign-in service. Check your internet connection.');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const code = String(data.__type || '').split('#').pop();
    throw new AuthError(code, MESSAGES[code] || data.message || 'Sign-in failed. Please try again.');
  }
  return data;
}

export async function isLocalAuth() {
  return (await getConfig()).auth === 'local';
}

export async function signIn(email, password) {
  email = email.trim().toLowerCase();
  if (await isLocalAuth()) {
    const res = await fetch(`${API}/dev/token`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email }) });
    const data = await res.json();
    if (!res.ok) throw new AuthError('Local', data.error);
    keep({ idToken: data.idToken });
    return currentUser();
  }
  const { AuthenticationResult: r } = await cognito('InitiateAuth', { AuthFlow: 'USER_PASSWORD_AUTH', AuthParameters: { USERNAME: email, PASSWORD: password } });
  keep({ idToken: r.IdToken, refreshToken: r.RefreshToken });
  return currentUser();
}

// Returns { confirm: true } when Cognito has emailed a code to verify the address.
export async function signUp(email, password) {
  email = email.trim().toLowerCase();
  if (await isLocalAuth()) return { confirm: false };
  await cognito('SignUp', { Username: email, Password: password, UserAttributes: [{ Name: 'email', Value: email }] });
  return { confirm: true };
}
export const confirmSignUp = (email, code) => cognito('ConfirmSignUp', { Username: email.trim().toLowerCase(), ConfirmationCode: code.trim() });
export const resendCode = (email) => cognito('ResendConfirmationCode', { Username: email.trim().toLowerCase() });

// A fresh ID token for the API, refreshed with the refresh token when it has expired; null when signed out.
export async function idToken() {
  const s = load();
  if (!s?.idToken) return null;
  if (claims(s.idToken).exp * 1000 - 60000 > Date.now()) return s.idToken;
  if (s.refreshToken) {
    try {
      const { AuthenticationResult: r } = await cognito('InitiateAuth', { AuthFlow: 'REFRESH_TOKEN_AUTH', AuthParameters: { REFRESH_TOKEN: s.refreshToken } });
      keep({ ...s, idToken: r.IdToken });
      return r.IdToken;
    } catch {}
  }
  keep(null);
  return null;
}

export function currentUser() {
  const s = load();
  if (!s?.idToken) return null;
  try {
    const c = claims(s.idToken);
    return { email: c.email, sub: c.sub };
  } catch {
    return null;
  }
}

export function signOut() {
  keep(null);
}

setTokenSource(idToken);
