// Signing in to the admin portal: checking Google sign-ins, and sessions kept in an HttpOnly
// cookie. The database stores only a hash of each session token.
import { createHash, randomBytes } from 'node:crypto';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { HttpError } from './http.js';

const COOKIE = 'zq_session';
const DAYS = 30;
const googleKeys = createRemoteJWKSet(new URL('https://www.googleapis.com/oauth2/v3/certs'));
const hash = (token) => createHash('sha256').update(token).digest('hex');

// Checks a Google ID token from the "Sign in with Google" button: signed by Google, made for this
// portal's client ID, not expired, and for a verified email address.
export async function verifyGoogle(credential, clientId) {
  const failed = () => new HttpError('Google sign-in did not work. Please try again.', 'bad_token', 401);
  if (typeof credential !== 'string' || credential.length > 8192) throw failed();
  let payload;
  try {
    ({ payload } = await jwtVerify(credential, googleKeys, {
      issuer: ['https://accounts.google.com', 'accounts.google.com'], audience: clientId,
    }));
  } catch {
    throw failed();
  }
  if (typeof payload.email !== 'string' || !(payload.email_verified === true || payload.email_verified === 'true')) {
    throw new HttpError('This Google account has no verified email address.', 'unverified', 403);
  }
  return { email: payload.email.trim().toLowerCase(), name: typeof payload.name === 'string' ? payload.name : '' };
}

export async function startSession(store, memberId) {
  const token = randomBytes(32).toString('base64url');
  const created = new Date();
  await store.col('sessions').insertOne({
    id: hash(token), member_id: memberId, created_at: created.toISOString(),
    expires_at: new Date(created.getTime() + DAYS * 864e5),
  });
  return token;
}

export async function endSession(req, store) {
  const token = readCookie(req);
  if (token) await store.col('sessions').deleteOne({ id: hash(token) });
}

// The signed-in team member, or null. Access removed on the Team page ends sessions at once.
export async function currentMember(req, store) {
  const token = readCookie(req);
  if (!token) return null;
  const session = await store.col('sessions').findOne({ id: hash(token), expires_at: { $gt: new Date() } });
  if (!session) return null;
  return store.col('team_members').findOne({ id: session.member_id, active: true });
}

const secure = (req) => !/^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(req.headers.host || '');
const cookie = (req, value, maxAge) =>
  `${COOKIE}=${value}; Path=/api; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure(req) ? '; Secure' : ''}`;
export const sessionCookie = (req, token) => cookie(req, token, DAYS * 86400);
export const clearedCookie = (req) => cookie(req, '', 0);

function readCookie(req) {
  for (const part of String(req.headers.cookie || '').split(';')) {
    const [name, ...rest] = part.trim().split('=');
    if (name === COOKIE) return rest.join('=') || null;
  }
  return null;
}
