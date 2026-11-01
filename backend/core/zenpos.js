// ZenPOS: Zenatiq's point of sale for mobile phone shops, a Windows app sold as a yearly licence for
// one computer. Here are its rules: licence keys and Computer IDs, the signed licence ZenPOS reads,
// the renewal dates, and the answers to ZenPOS's licence and package requests.
//
// ZenPOS is finished and relies on these formats exactly (the ZenPOS project's
// docs/zenatiq-website-zenpos-key-maker-prompt.md), so change them only together with ZenPOS.
// Its licences are signed with the same private key and code as every other licence (license.js).
import { createCipheriv, createDecipheriv, createHmac, randomBytes, randomUUID } from 'node:crypto';
import { HttpError } from '../http.js';
import { signLicense, licenseSecret } from '../license.js';
import { SITE, today, addDays, addYears, periodEnd, daysBetween } from './renewals.js';

export const PACKAGE = 'ZenPOS Yearly';
export const PRICE = 15000;
export const CURRENCY = 'LKR';
export const GRACE_DAYS = 14;
const CHECK_DAYS = 7;
const WHATSAPP = '075 811 2170';

export const SERVICES = [
  'Service and help on WhatsApp and by phone, all year',
  'Small updates and changes during the subscription',
  'Fixes and new versions of ZenPOS',
  'Help with setup, the receipt printer and backups',
];
const amountText = (n) => `LKR ${Number(n).toLocaleString('en-US')}`;
export const termsFor = (price = PRICE) => [
  `Yearly subscription: ${amountText(price)} a year for one computer, with service and small updates for the whole year.`,
  'Subscription payments are not refundable.',
  'Renewing early adds the new year after the current one.',
  `After the paid-until date there are ${GRACE_DAYS} days to renew. After that ZenPOS is read-only until it's renewed; the shop's data stays safe and can still be viewed, printed and backed up.`,
  'Bigger changes and new features are quoted separately.',
];

// --- Keys and Computer IDs ----------------------------------------------------------------------
// Crockford base32: no I, L, O or U, so keys read out over the phone don't get mixed up.
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const CROCKFORD = /^[0-9A-HJKMNP-TV-Z]+$/;
const groups = (s) => s.match(/.{4}/g).join('-');
function base32(bytes) {
  let out = '';
  let value = 0;
  let bits = 0;
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
    value &= (1 << bits) - 1;
  }
  return out;
}
// A new licence key: ZPOS- and 16 characters, 80 random bits.
export const newKey = () => `ZPOS-${groups(base32(randomBytes(10)))}`;

// Typed-in text as a key or Computer ID, ignoring case, spaces and dashes (and reading O as 0 and
// I or L as 1, as Crockford base32 does), or null when it can't be one.
function normal(input, prefix, length) {
  if (typeof input !== 'string' || input.length > 80) return null;
  const s = input.toUpperCase().replace(/[\s_-]/g, '');
  if (!s.startsWith(prefix)) return null;
  const rest = s.slice(prefix.length).replace(/O/g, '0').replace(/[IL]/g, '1');
  return rest.length === length && CROCKFORD.test(rest) ? `${prefix}-${groups(rest)}` : null;
}
export const normalKey = (input) => normal(input, 'ZPOS', 16);
export const normalDevice = (input) => normal(input, 'ZP', 12);
export const maskKey = (key) => `ZPOS-…${key.slice(-4)}`;

// A request from ZenPOS: its keys start with ZPOS, and it says product "zenpos".
export const isZenposRequest = (body) => body?.product === 'zenpos' || (typeof body?.key === 'string' && /^\s*zpos/i.test(body.key));

// Keys are kept so a copy of the database doesn't give them away: a fingerprint to find a licence by
// key, and the key itself encrypted, to show it to staff and put it in offline codes. Both secrets
// come from LICENSE_PRIVATE_KEY.
export const keyHash = (key) => createHmac('sha256', licenseSecret('zenpos-key-hash')).update(key).digest('hex');
export function sealKey(key) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', licenseSecret('zenpos-key-seal'), iv);
  const sealed = Buffer.concat([cipher.update(key, 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), sealed]).toString('base64');
}
export function openKey(sealed) {
  const b = Buffer.from(sealed, 'base64');
  const decipher = createDecipheriv('aes-256-gcm', licenseSecret('zenpos-key-seal'), b.subarray(0, 12));
  decipher.setAuthTag(b.subarray(12, 28));
  return Buffer.concat([decipher.update(b.subarray(28)), decipher.final()]).toString('utf8');
}

// --- Dates --------------------------------------------------------------------------------------
export const graceOf = (paidUntil) => addDays(paidUntil, GRACE_DAYS);
// Where "paid until" goes when a year is paid on `day`. On or before the current date, the new year
// is added after it; later, the year starts on the day it's paid.
export const renewedUntil = (lic, day = today()) => (day <= lic.paid_until ? addYears(lic.paid_until, 1) : periodEnd(day, 1));
// active, ending (30 days or fewer), grace ("renewal due", still working), expired (read-only) or cancelled.
export function statusOf(lic, day = today()) {
  if (lic.status === 'cancelled') return 'cancelled';
  const left = daysBetween(day, lic.paid_until);
  if (left > 30) return 'active';
  if (left >= 0) return 'ending';
  return day <= lic.grace_until ? 'grace' : 'expired';
}
// "2026-11-08T22:23:00+05:30": Sri Lanka time, as ZenPOS expects.
export const colomboTime = (at = new Date()) => `${new Date(at.getTime() + 5.5 * 3600e3).toISOString().slice(0, 19)}+05:30`;

// The emails before and after the paid-until date: 30, 7 and 1 days before, and the day after.
// Each goes once, and only the most recent one that's due.
const STAGES = [{ stage: 'before', at: 30 }, { stage: 'before', at: 7 }, { stage: 'before', at: 1 }, { stage: 'ended', at: -1 }];
export function dueReminder(lic, day = today()) {
  if (lic.status === 'cancelled' || !lic.email) return null;
  const left = daysBetween(day, lic.paid_until);
  let due = null;
  for (const s of STAGES) if (left <= s.at) due = s;
  if (!due || left < -8) return null; // nothing about a licence that ended long ago
  const key = `${lic.paid_until}:${due.stage}:${due.at}`;
  return (lic.reminders || []).includes(key) ? null : { stage: due.stage, key, left };
}

// --- The licence ZenPOS reads ----------------------------------------------------------------------
export const renewUrlOf = (lic) => `${SITE}/renew/zenpos?t=${lic.renew_token}`;
// A cancelled licence, or one for the computer it was moved from, stops working at the next check:
// its last day to renew was yesterday.
export function licenceFor(lic, { device = lic.device, cancelled = lic.status === 'cancelled', key = null, at = new Date() } = {}) {
  return {
    product: 'zenpos', licence_id: lic.licence_id, ...(key ? { key } : {}), shop: lic.shop, device,
    status: cancelled ? 'cancelled' : 'active', package: lic.package, price: lic.price, currency: lic.currency,
    paid_until: lic.paid_until, grace_until: cancelled ? addDays(today(at), -1) : lic.grace_until,
    renew_url: renewUrlOf(lic), check_by: colomboTime(new Date(at.getTime() + CHECK_DAYS * 864e5)), issued_at: colomboTime(at),
  };
}

// --- ZenPOS's requests: POST /api/license and POST /api/connect (op "package") ----------------------
const UNKNOWN = `That licence key isn't known to Zenatiq. Check the key, or WhatsApp Zenatiq on ${WHATSAPP}.`;
const RATE = 30; // licence checks a minute from one internet address

async function limit(store, ip, at) {
  if (!ip) return;
  const hits = store.col('license_hits');
  if ((await hits.countDocuments({ ip, at: { $gt: new Date(at.getTime() - 60e3) } })) >= RATE) {
    throw new HttpError('Too many licence checks from this internet connection. Please wait a minute and try again.', 'rate_limited', 429);
  }
  await hits.insertOne({ ip, at });
}
async function licenceOfKey(store, input) {
  const key = normalKey(input);
  const lic = key ? await store.col('zenpos_licences').findOne({ key_hash: keyHash(key) }) : null;
  if (!lic) throw new HttpError(UNKNOWN, 'invalid_key', 404);
  return { key, lic };
}

// ZenPOS activating or checking its licence: { key, product, device, version }. The first computer to
// use a key keeps it; another one is turned away until Zenatiq moves the licence.
export async function answerLicence(store, body, { ip = null, at = new Date() } = {}) {
  await limit(store, ip, at);
  const { key, lic } = await licenceOfKey(store, body.key);
  const device = normalDevice(body.device);
  if (!device) throw new HttpError(`ZenPOS didn't send this computer's ID. Update ZenPOS, or WhatsApp Zenatiq on ${WHATSAPP}.`, 'bad_device', 400);
  const licences = store.col('zenpos_licences');
  const seen = { last_check_at: at.toISOString(), version: typeof body.version === 'string' ? body.version.slice(0, 40) : null };

  let current = lic;
  if (!lic.device && lic.status !== 'cancelled') {
    // Only one computer can win the first check.
    const bound = await licences.updateOne({ id: lic.id, device: null }, { $set: { device, bound_at: seen.last_check_at } });
    current = bound.modifiedCount ? { ...lic, device } : await licences.findOne({ id: lic.id });
  }
  if (current.device === device) {
    await licences.updateOne({ id: lic.id }, { $set: seen });
    return { license: signLicense(licenceFor(current, { key, at })) };
  }
  if ((current.previous_devices || []).some((d) => d.device === device) || (current.status === 'cancelled' && !current.device)) {
    return { license: signLicense(licenceFor(current, { device, cancelled: true, key, at })) };
  }
  throw new HttpError('This licence key is already used on another computer. Contact Zenatiq to move it.', 'device_mismatch', 409);
}

// What the package includes, for ZenPOS's "What's included".
export async function answerPackage(store, body) {
  if (body.op !== 'package') throw new HttpError('ZenPOS can only ask for its package.', 'unknown_op', 404);
  await licenceOfKey(store, body.key);
  return { type: 'yearly', name: PACKAGE, services: SERVICES };
}

// --- Changing a licence (the Key Maker, the renewal page and PayHere) --------------------------------
// Each licence keeps its own history: who did what, and when.
export const eventOf = (by, action, summary) => ({ at: new Date().toISOString(), by, action, summary });
export async function addEvent(store, lic, event, fields = {}) {
  const events = [...(lic.events || []), event].slice(-200);
  await store.col('zenpos_licences').updateOne({ id: lic.id }, { $set: { ...fields, events, updated_at: event.at } });
  return { ...lic, ...fields, events, updated_at: event.at };
}

const longDay = (day) => new Date(`${day}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
// A year paid for: the new dates, the payment, and the history. `by` is who confirmed it.
export async function renewLicence(store, lic, { amount, method, reference = null, paidOn = today(), by = 'System', byId = null }) {
  const paid_until = renewedUntil(lic, paidOn);
  const payment = {
    id: randomUUID(), licence: lic.id, licence_id: lic.licence_id, amount, currency: lic.currency, method, reference,
    paid_on: paidOn, from_paid_until: lic.paid_until, to_paid_until: paid_until, recorded_by: byId, recorded_by_label: by,
    created_at: new Date().toISOString(),
  };
  await store.col('zenpos_payments').insertOne(payment);
  const summary = `Renewed until ${longDay(paid_until)}: ${amountText(amount)} by ${method.replace('_', ' ')}${reference ? `, ${reference}` : ''}`;
  const renewed = await addEvent(store, lic, eventOf(by, 'renewed', summary),
    { paid_until, grace_until: graceOf(paid_until), reminders: [], ...(lic.status === 'cancelled' ? { status: 'active' } : {}) });
  return { licence: renewed, payment };
}

export const newLicenceId = (n) => `ZL-${String(n).padStart(6, '0')}`;
export const newToken = () => randomBytes(24).toString('hex');
