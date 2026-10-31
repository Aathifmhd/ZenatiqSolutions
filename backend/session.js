// Sessions for the admin portal, kept in an HttpOnly cookie. The database stores only a hash of
// each session token.
import { createHash, randomBytes } from 'node:crypto';

const COOKIE = 'zq_session';
const DAYS = 30;
const hash = (token) => createHash('sha256').update(token).digest('hex');

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

// After a password change: signs the member out everywhere except this browser.
export async function endOtherSessions(req, store, memberId) {
  const token = readCookie(req);
  await store.col('sessions').deleteMany({ member_id: memberId, id: { $ne: token ? hash(token) : '' } });
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
