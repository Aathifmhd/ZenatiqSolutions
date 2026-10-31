// Admin portal sign-in.
// GET:  is the portal set up, and who is signed in?
// POST: { op: "google", credential } signs in with a Google ID token; { op: "signout" } signs out.
import { database, storeFor, missingSettings } from '../lib/mongo.js';
import { readJson, checkPortalRequest, send, fail, HttpError } from '../lib/http.js';
import { verifyGoogle, startSession, endSession, currentMember, sessionCookie, clearedCookie } from '../lib/session.js';
import { createPortal } from '../public/admin/js/core/ops.js';

export default async function handler(req, res) {
  try {
    const missing = missingSettings();
    if (req.method === 'GET') {
      if (missing.length) return send(res, 200, { configured: false, missing });
      const store = storeFor(await database());
      return send(res, 200, { configured: true, googleClientId: process.env.GOOGLE_CLIENT_ID.trim(), me: await currentMember(req, store) });
    }
    if (req.method !== 'POST') return send(res, 405, { error: { code: 'method', message: 'Use GET or POST.' } }, { Allow: 'GET, POST' });
    if (missing.length) throw new HttpError('The portal is not set up yet.', 'not_configured', 503);
    checkPortalRequest(req);
    const { op, credential } = await readJson(req);
    const store = storeFor(await database());

    if (op === 'signout') {
      await endSession(req, store);
      return send(res, 200, { ok: true }, { 'Set-Cookie': clearedCookie(req) });
    }
    if (op !== 'google') throw new HttpError('Unknown request.', 'unknown_op', 404);

    const google = await verifyGoogle(credential, process.env.GOOGLE_CLIENT_ID.trim());
    let me = await store.col('team_members').findOne({ email: google.email, active: true });
    if (!me && google.email === process.env.OWNER_EMAIL.trim().toLowerCase()) {
      me = await createPortal(store).bootstrapOwner(google.email, google.name);
    }
    if (!me) {
      const err = new HttpError(`${google.email} isn't on the Zenatiq team.`, 'no_access', 403);
      err.extra = { email: google.email };
      throw err;
    }
    const token = await startSession(store, me.id);
    return send(res, 200, { me }, { 'Set-Cookie': sessionCookie(req, token) });
  } catch (err) {
    return fail(res, err);
  }
}
