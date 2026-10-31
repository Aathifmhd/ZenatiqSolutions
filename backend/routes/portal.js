// Admin portal data: POST /api/portal { op, args } runs one operation from core/ops.js for the
// signed-in team member.
import { Router } from 'express';
import { readJson, checkPortalRequest, send, fail, HttpError } from '../http.js';
import { currentMember } from '../session.js';
import { createPortal } from '../core/ops.js';

export function portalRoutes(api) {
  const router = Router();

  router.post('/', async (req, res) => {
    if (api.missing().length) throw new HttpError('The portal is not set up yet.', 'not_configured', 503);
    checkPortalRequest(req);
    const { op, args = {} } = await readJson(req);
    const store = await api.store();
    const me = await currentMember(req, store);
    if (!me) throw new HttpError('Please sign in again.', 'signed_out', 401);

    // The local demo's own buttons: fresh sample data, and a pretend client message.
    if (api.demo && op === 'demo.reset') return send(res, 200, { data: api.demo.reset() ?? null });
    if (api.demo && op === 'demo.clientMessage') return send(res, 200, { data: await api.demo.clientMessage(args) });

    const data = await createPortal(store, { mailer: api.mailer }).run(me, op, args);
    send(res, 200, { data: data ?? null });
  });

  router.all('/', (req, res) => send(res, 405, { error: { code: 'method', message: 'Use POST.' } }, { Allow: 'POST' }));
  router.use((err, req, res, next) => fail(res, err));
  return router;
}
