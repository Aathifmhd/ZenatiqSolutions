// Contact with Zenatiq: the API behind the widget on clients' admin panels.
// POST /api/connect { op, key, ... }. Each project's secret key only reaches that project's
// conversations, and any website may call it (the widget runs on clients' own domains), so no
// cookies are used.
import { Router } from 'express';
import { readJson, send, fail, HttpError } from '../http.js';
import { createConnect } from '../core/ops.js';
import { isZenposRequest, answerPackage } from '../core/zenpos.js';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Max-Age': '86400',
};

export function connectRoutes(api) {
  const router = Router();

  router.options('/', (req, res) => {
    res.statusCode = 204;
    for (const [name, value] of Object.entries(CORS)) res.setHeader(name, value);
    res.end();
  });

  router.post('/', async (req, res) => {
    if (api.missing().includes('MONGODB_URI')) throw new HttpError('Contact with Zenatiq is not connected yet.', 'not_configured', 503);
    const body = await readJson(req);
    // ZenPOS asks for its package with its licence key (core/zenpos.js).
    if (isZenposRequest(body)) return send(res, 200, { data: await answerPackage(await api.store(), body) }, CORS);
    const data = await createConnect(await api.store()).run(body.op, body);
    send(res, 200, { data: data ?? null }, CORS);
  });

  router.all('/', () => {
    throw new HttpError('Use POST.', 'method', 405);
  });
  router.use((err, req, res, next) => fail(res, err, CORS));
  return router;
}
