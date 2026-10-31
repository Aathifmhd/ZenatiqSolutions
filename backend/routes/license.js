// Licences for the systems Zenatiq builds (see license.js, and the licence-check module at
// frontend/license/zenatiq-license.mjs that goes into each system).
// POST /api/license { key }  the project's licence: { license: "<signed>", ...what it says }
// GET  /api/license/key      Zenatiq's public key, for checking licences
// The key is the project's key from its Widget tab. Any website or server may ask, so no cookies.
import { Router } from 'express';
import { readJson, send, fail, HttpError } from '../http.js';
import { licenseFor, signLicense, publicKey } from '../license.js';
import { ensureRenewToken } from '../core/ops.js';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Max-Age': '86400',
};

export function licenseRoutes(api) {
  const router = Router();

  router.options(['/', '/key'], (req, res) => {
    res.statusCode = 204;
    for (const [name, value] of Object.entries(CORS)) res.setHeader(name, value);
    res.end();
  });

  router.post('/', async (req, res) => {
    if (api.missing().includes('MONGODB_URI')) throw new HttpError('Licences are not available yet.', 'not_configured', 503);
    const { key } = await readJson(req);
    const badKey = () => new HttpError('This project key is not valid.', 'bad_key', 403);
    if (typeof key !== 'string' || !/^[0-9a-f]{32,128}$/i.test(key)) throw badKey();
    const store = await api.store();
    const project = await store.col('projects').findOne({ connect_key: key });
    if (!project) throw badKey();
    const sub = await ensureRenewToken(store, await store.col('subscriptions').findOne({ project_id: project.id }));
    const licence = licenseFor(project, sub);
    send(res, 200, { license: signLicense(licence), ...licence }, CORS);
  });

  router.get('/key', (req, res) => send(res, 200, { alg: 'Ed25519', format: 'spki-der-base64', public_key: publicKey() }, CORS));

  router.all(['/', '/key'], () => {
    throw new HttpError('Use POST to ask for a licence.', 'method', 405);
  });
  router.use((err, req, res, next) => fail(res, err, CORS));
  return router;
}
