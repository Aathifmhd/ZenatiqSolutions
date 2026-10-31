// Contact with Zenatiq: the API behind the widget on clients' admin panels.
// POST { op, key, ... }. Each project's secret key only reaches that project's conversations,
// and any website may call it (the widget runs on clients' own domains), so no cookies are used.
import { database, storeFor } from '../lib/mongo.js';
import { readJson, send, fail, HttpError } from '../lib/http.js';
import { createConnect } from '../public/admin/js/core/ops.js';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Max-Age': '86400',
};

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    for (const [name, value] of Object.entries(CORS)) res.setHeader(name, value);
    return res.end();
  }
  try {
    if (req.method !== 'POST') throw new HttpError('Use POST.', 'method', 405);
    if (!process.env.MONGODB_URI?.trim()) throw new HttpError('Contact with Zenatiq is not connected yet.', 'not_configured', 503);
    const body = await readJson(req);
    const data = await createConnect(storeFor(await database())).run(body.op, body);
    return send(res, 200, { data: data ?? null }, CORS);
  } catch (err) {
    return fail(res, err, CORS);
  }
}
