// Daily jobs, started by Vercel Cron (see "crons" in vercel.json).
// GET /api/cron/renewals emails the renewal reminders that are due today. Vercel sends
// CRON_SECRET as a bearer token, so nobody else can start it.
import { timingSafeEqual } from 'node:crypto';
import { Router } from 'express';
import { send, fail, HttpError } from '../http.js';
import { createPortal } from '../core/ops.js';

export function cronRoutes(api) {
  const router = Router();

  router.get('/renewals', async (req, res) => {
    const secret = process.env.CRON_SECRET?.trim();
    const given = Buffer.from(String(req.headers.authorization || ''));
    const expected = Buffer.from(`Bearer ${secret}`);
    if (!secret || given.length !== expected.length || !timingSafeEqual(given, expected)) {
      throw new HttpError("This is for Vercel's daily job only.", 'forbidden', 401);
    }
    if (api.missing().length) throw new HttpError('The portal is not set up yet.', 'not_configured', 503);
    send(res, 200, await createPortal(await api.store(), { mailer: api.mailer }).sendDueReminders());
  });

  router.use((err, req, res, next) => fail(res, err));
  return router;
}
