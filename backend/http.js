// Request and response helpers shared by the API routes in backend/routes.

const MAX_BODY = 64 * 1024;

export class HttpError extends Error {
  constructor(message, code, status) {
    super(message);
    this.name = 'HttpError';
    this.code = code;
    this.status = status;
  }
}

// The JSON body. Vercel parses it into req.body; a plain Node server leaves the stream to read.
// Text bodies are parsed too: the widget sends text/plain so browsers skip the CORS preflight.
export async function readJson(req) {
  let body;
  try {
    body = req.body;
  } catch {
    throw new HttpError('The request was not valid JSON.', 'bad_request', 400);
  }
  if (body === undefined) {
    const chunks = [];
    let size = 0;
    for await (const chunk of req) {
      size += chunk.length;
      if (size > MAX_BODY) throw new HttpError('The request is too large.', 'too_large', 413);
      chunks.push(chunk);
    }
    body = Buffer.concat(chunks).toString('utf8');
  }
  if (Buffer.isBuffer(body)) body = body.toString('utf8');
  if (typeof body === 'string') {
    if (body.length > MAX_BODY) throw new HttpError('The request is too large.', 'too_large', 413);
    try {
      body = body ? JSON.parse(body) : {};
    } catch {
      throw new HttpError('The request was not valid JSON.', 'bad_request', 400);
    }
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new HttpError('The request was not valid JSON.', 'bad_request', 400);
  return body;
}

// Portal requests must come from the portal itself: JSON (which other sites can't send without
// permission) and, when the browser says where it came from, this same site.
export function checkPortalRequest(req) {
  if (!/^application\/json\b/i.test(req.headers['content-type'] || '')) {
    throw new HttpError('Requests must be sent as JSON.', 'bad_request', 415);
  }
  const origin = req.headers.origin;
  if (!origin) return;
  let host = '';
  try {
    host = new URL(origin).host;
  } catch { /* checked below */ }
  const hosts = [req.headers['x-forwarded-host'], req.headers.host].filter(Boolean).flatMap((h) => String(h).split(',').map((s) => s.trim()));
  if (!host || !hosts.includes(host)) throw new HttpError("You don't have permission to do that.", 'forbidden', 403);
}

export function send(res, status, data, headers = {}) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  for (const [name, value] of Object.entries(headers)) res.setHeader(name, value);
  res.end(JSON.stringify(data));
}

// Turns any error into a JSON answer with a message people can act on.
export function fail(res, err, headers = {}) {
  if ((err?.name === 'OpError' || err?.name === 'HttpError') && typeof err.status === 'number') {
    return send(res, err.status, { error: { code: err.code, message: err.message, ...(err.extra || {}) } }, headers);
  }
  if (err?.code === 11000) {
    const message = /email/.test(err.message) ? 'That email is already on the team.' : 'That already exists. Please try again.';
    return send(res, 409, { error: { code: 'duplicate', message } }, headers);
  }
  const name = String(err?.name || '');
  if (name === 'MongoParseError' || /Invalid scheme|URI must include/i.test(err?.message || '')) {
    return send(res, 503, { error: { code: 'db_settings', message: "MONGODB_URI isn't a valid MongoDB connection string. Copy it again from MongoDB Atlas." } }, headers);
  }
  if (err?.codeName === 'AuthenticationFailed' || /bad auth|authentication failed/i.test(err?.message || '')) {
    return send(res, 503, { error: { code: 'db_login', message: 'MongoDB refused the username or password in MONGODB_URI.' } }, headers);
  }
  if (/^Mongo(ServerSelection|Network|Topology)/.test(name)) {
    return send(res, 503, { error: { code: 'db_unreachable', message: "The portal can't reach its database. In MongoDB Atlas, check Network Access allows 0.0.0.0/0, then try again." } }, headers);
  }
  console.error(err);
  return send(res, 500, { error: { code: 'server', message: 'Something went wrong on the server. Please try again.' } }, headers);
}
