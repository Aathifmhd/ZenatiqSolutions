// Admin portal sign-in, with an email address and a password.
// GET  /api/auth: is the portal set up, and who is signed in?
// POST /api/auth:
//   { op: "signin", email, password }               signs in. With a temporary password the answer
//                                                   is { mustChange: true } and no session yet...
//   { op: "signin", email, password, newPassword }  ...until they choose their own password.
//   { op: "password", password, newPassword }       a signed-in member changes their password.
//   { op: "signout" }
import { Router } from 'express';
import { readJson, checkPortalRequest, send, fail, HttpError } from '../http.js';
import { startSession, endSession, endOtherSessions, currentMember, sessionCookie, clearedCookie } from '../session.js';
import { verifyPassword, passwordProblem, savePassword } from '../passwords.js';

// After 10 wrong passwords for one email, that email waits 15 minutes.
const TRIES = 10;
const WINDOW_MS = 15 * 60e3;

export function authRoutes(api) {
  const router = Router();

  router.get('/', async (req, res) => {
    const missing = api.missing();
    if (missing.length) return send(res, 200, { configured: false, missing });
    const me = await currentMember(req, await api.store());
    send(res, 200, { configured: true, ...(api.demo ? { demo: api.demo.signIn } : {}), me });
  });

  router.post('/', async (req, res) => {
    if (api.missing().length) throw new HttpError('The portal is not set up yet.', 'not_configured', 503);
    checkPortalRequest(req);
    const body = await readJson(req);
    const store = await api.store();

    if (body.op === 'signout') {
      await endSession(req, store);
      return send(res, 200, { ok: true }, { 'Set-Cookie': clearedCookie(req) });
    }
    if (body.op === 'signin') return signIn(req, res, store, body);
    if (body.op === 'password') return changePassword(req, res, store, body);
    throw new HttpError('Unknown request.', 'unknown_op', 404);
  });

  router.all('/', (req, res) => send(res, 405, { error: { code: 'method', message: 'Use GET or POST.' } }, { Allow: 'GET, POST' }));
  router.use((err, req, res, next) => fail(res, err));
  return router;
}

async function signIn(req, res, store, { email, password, newPassword }) {
  const address = typeof email === 'string' ? email.trim().toLowerCase() : '';
  // No real email or password is over 200 characters, so longer ones are refused before any work.
  if (!address || address.length > 200 || typeof password !== 'string' || !password || password.length > 200) {
    throw new HttpError('Enter your email and password.', 'bad_request', 400);
  }
  await checkTries(store, address);

  const member = await store.col('team_members').findOne({ email: address, active: true });
  const credentials = member && (await store.col('credentials').findOne({ member_id: member.id }));
  if (!(await verifyPassword(password, credentials?.password_hash))) {
    await store.col('login_attempts').insertOne({ email: address, at: new Date() });
    throw new HttpError("That email and password don't match.", 'bad_password', 401);
  }
  await store.col('login_attempts').deleteMany({ email: address });

  if (credentials.temporary) {
    if (credentials.expires_at < new Date()) {
      throw new HttpError('Your temporary password has expired. Ask an owner or admin to send you a new one.', 'expired', 401);
    }
    if (newPassword == null) return send(res, 200, { mustChange: true });
    const problem = passwordProblem(newPassword, { email: address, old: password });
    if (problem) throw new HttpError(problem, 'weak_password', 400);
    await savePassword(store, member.id, newPassword);
  }
  const token = await startSession(store, member.id);
  send(res, 200, { me: member }, { 'Set-Cookie': sessionCookie(req, token) });
}

async function changePassword(req, res, store, { password, newPassword }) {
  const me = await currentMember(req, store);
  if (!me) throw new HttpError('Please sign in again.', 'signed_out', 401);
  await checkTries(store, me.email);
  const credentials = await store.col('credentials').findOne({ member_id: me.id });
  if (!(await verifyPassword(password, credentials?.password_hash))) {
    await store.col('login_attempts').insertOne({ email: me.email, at: new Date() });
    throw new HttpError("Your current password isn't right.", 'bad_password', 400);
  }
  const problem = passwordProblem(newPassword, { email: me.email, old: password });
  if (problem) throw new HttpError(problem, 'weak_password', 400);
  await savePassword(store, me.id, newPassword);
  await endOtherSessions(req, store, me.id);
  send(res, 200, { ok: true });
}

async function checkTries(store, email) {
  const recent = await store.col('login_attempts').countDocuments({ email, at: { $gt: new Date(Date.now() - WINDOW_MS) } });
  if (recent >= TRIES) throw new HttpError('Too many tries. Wait 15 minutes, then try again.', 'rate_limited', 429);
}
