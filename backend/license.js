// Licences for the systems Zenatiq builds. A system asks /api/license, with its project key,
// what its yearly subscription allows, and gets a licence signed with Zenatiq's private key
// (LICENSE_PRIVATE_KEY, Ed25519). The licence-check module in each system checks the signature
// with Zenatiq's public key, so nobody can make up or edit a licence, even one saved for days
// without internet.
import { createPrivateKey, createPublicKey, generateKeyPairSync, sign, verify } from 'node:crypto';
import { HttpError } from './http.js';
import { today, statusOf, graceUntil, renewUrl } from './core/renewals.js';

// How long a system may rely on a saved licence before it should check again. Dates in the
// licence still apply offline, so a paid-up system keeps working without internet.
export const CHECK_DAYS = 7;

let loaded = null;
function privateKey() {
  const text = process.env.LICENSE_PRIVATE_KEY?.trim();
  if (!text) throw new HttpError("Licences aren't set up yet. Add LICENSE_PRIVATE_KEY in Vercel.", 'license_not_configured', 503);
  if (loaded?.text !== text) {
    try {
      loaded = { text, key: createPrivateKey({ key: Buffer.from(text, 'base64'), format: 'der', type: 'pkcs8' }) };
    } catch {
      throw new HttpError("LICENSE_PRIVATE_KEY isn't a valid key. Make a new one with: npm run license-key", 'license_not_configured', 503);
    }
  }
  return loaded.key;
}

// Zenatiq's public key (base64 SPKI DER), which client systems use to check licences.
export const publicKey = () => createPublicKey(privateKey()).export({ format: 'der', type: 'spki' }).toString('base64');

// A new key pair, for `npm run license-key`.
export function newKeyPair() {
  const { privateKey: priv, publicKey: pub } = generateKeyPairSync('ed25519');
  return {
    privateKey: priv.export({ format: 'der', type: 'pkcs8' }).toString('base64'),
    publicKey: pub.export({ format: 'der', type: 'spki' }).toString('base64'),
  };
}

// What a project's subscription allows today. A project without one is a one-time purchase,
// with nothing to renew.
export function licenseFor(project, sub, { day = today(), now = new Date() } = {}) {
  const status = sub ? statusOf(sub, day) : 'none';
  const lastDay = sub ? graceUntil(sub) : null;
  return {
    v: 1,
    project: project.id,
    name: project.name,
    package: sub?.package ?? null,
    price: sub?.price ?? null,
    currency: sub?.currency ?? null,
    status,
    paid_until: sub?.ends_on ?? null,
    grace_until: lastDay,
    read_only: Boolean(lastDay) && day > lastDay,
    renew_url: renewUrl(sub),
    issued_at: now.toISOString(),
    check_by: new Date(now.getTime() + CHECK_DAYS * 864e5).toISOString(),
  };
}

// "payload.signature", both base64url. The payload is the licence as JSON.
export function signLicense(payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${body}.${sign(null, Buffer.from(body), privateKey()).toString('base64url')}`;
}

// The licence inside a signed licence, or null if the signature doesn't match. key: a public key
// as base64 SPKI DER. (Client systems do the same in frontend/license/zenatiq-license.mjs.)
export function readLicense(token, key) {
  const [body, signature] = String(token).split('.');
  if (!body || !signature) return null;
  try {
    const publicKeyObject = createPublicKey({ key: Buffer.from(key, 'base64'), format: 'der', type: 'spki' });
    if (!verify(null, Buffer.from(body), publicKeyObject, Buffer.from(signature, 'base64url'))) return null;
    return JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
}
