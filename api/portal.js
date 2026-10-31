// Admin portal data: POST { op, args } runs one operation from core/ops.js for the signed-in member.
import { database, storeFor, missingSettings } from '../lib/mongo.js';
import { readJson, checkPortalRequest, send, fail, HttpError } from '../lib/http.js';
import { currentMember } from '../lib/session.js';
import { createPortal } from '../public/admin/js/core/ops.js';

export default async function handler(req, res) {
  try {
    if (req.method !== 'POST') return send(res, 405, { error: { code: 'method', message: 'Use POST.' } }, { Allow: 'POST' });
    if (missingSettings().length) throw new HttpError('The portal is not set up yet.', 'not_configured', 503);
    checkPortalRequest(req);
    const { op, args = {} } = await readJson(req);
    const store = storeFor(await database());
    const me = await currentMember(req, store);
    if (!me) throw new HttpError('Please sign in again.', 'signed_out', 401);
    const data = await createPortal(store).run(me, op, args);
    return send(res, 200, { data: data ?? null });
  } catch (err) {
    return fail(res, err);
  }
}
