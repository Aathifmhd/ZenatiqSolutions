// The ZenPOS renewal page (frontend/renew/zenpos.html, the renew_url in ZenPOS licences) and the
// Buy ZenPOS page (frontend/zenpos.html). A licence's secret link opens its renewal page, so no
// sign-in is needed; staff check bank slips and requests in the Key Maker.
// POST /api/zenpos { op: "info", token }        the licence, what's included, the terms, the ways to pay
// POST /api/zenpos { op: "checkout", token, name, email, phone, address, city }   a PayHere form for a year
// POST /api/zenpos { op: "order", token, order } whether an online payment has gone through
// POST /api/zenpos { op: "slip", token, image, reference, payer }   a bank slip for staff to check
// POST /api/zenpos { op: "request", shop, name, phone, device, email, note }   a new shop asking for ZenPOS
import { randomBytes, randomUUID } from 'node:crypto';
import { Router } from 'express';
import { readJson, checkPortalRequest, send, fail, clientIp, HttpError } from '../http.js';
import { today, daysBetween } from '../core/renewals.js';
import * as zenpos from '../core/zenpos.js';
import { checkoutForm, payhereStatus } from '../payhere.js';
import { siteOf } from './renew.js';

const WHATSAPP = '+94 75 811 2170';
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const SLIP = /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/]+=*$/;
const MAX_SLIP = 1_500_000; // characters of a picture, after the page has shrunk it
const cut = (value, max) => (typeof value === 'string' ? value.trim().slice(0, max) : '');
const hourAgo = () => new Date(Date.now() - 3600e3).toISOString();

export function zenposRoutes(api) {
  const router = Router();

  router.post('/', async (req, res) => {
    if (api.missing().includes('MONGODB_URI')) throw new HttpError('ZenPOS payments are not available yet.', 'not_configured', 503);
    checkPortalRequest(req);
    const body = await readJson(req, { max: MAX_SLIP + 20_000 });
    const store = await api.store();
    if (body.op === 'request') return send(res, 200, await request(store, body, clientIp(req)));
    const lic = await licenceFor(store, body.token);
    if (body.op === 'info') return send(res, 200, await info(store, lic));
    if (body.op === 'checkout') return send(res, 200, await checkout(req, store, lic, body));
    if (body.op === 'order') return send(res, 200, await orderStatus(store, lic, body.order));
    if (body.op === 'slip') return send(res, 200, await slip(store, lic, body, clientIp(req)));
    throw new HttpError('Unknown request.', 'unknown_op', 404);
  });

  router.all('/', (req, res) => send(res, 405, { error: { code: 'method', message: 'Use POST.' } }, { Allow: 'POST' }));
  router.use((err, req, res, next) => fail(res, err));
  return router;
}

async function licenceFor(store, token) {
  const lic = typeof token === 'string' && /^[0-9a-f]{48}$/.test(token) ? await store.col('zenpos_licences').findOne({ renew_token: token }) : null;
  if (!lic) throw new HttpError(`This renewal link isn't valid. Please WhatsApp Zenatiq on ${WHATSAPP} for a new one.`, 'bad_link', 404);
  return lic;
}
const usable = (lic) => {
  if (lic.status === 'cancelled') throw new HttpError(`This ZenPOS licence was cancelled. Please WhatsApp Zenatiq on ${WHATSAPP}.`, 'cancelled', 409);
};

async function info(store, lic) {
  const settings = await store.col('settings').findOne({ id: 'renewal-page' });
  const day = today();
  return {
    licence_id: lic.licence_id, shop: lic.shop, package: lic.package, price: lic.price, currency: lic.currency,
    paid_until: lic.paid_until, grace_until: lic.grace_until, state: zenpos.statusOf(lic, day), days_left: daysBetween(day, lic.paid_until),
    renews_to: zenpos.renewedUntil(lic, day), services: zenpos.SERVICES, terms: zenpos.termsFor(lic.price),
    bank_details: settings?.bank_details ?? null, whatsapp: WHATSAPP, ...payhereStatus(),
    customer: { name: lic.owner || '', email: lic.email || '', phone: lic.phone || '', address: lic.address || '' },
  };
}

async function checkout(req, store, lic, body) {
  usable(lic);
  if (!payhereStatus().online) throw new HttpError("Online payment isn't available yet. Please pay by bank transfer.", 'online_off', 503);
  const customer = {
    name: cut(body.name, 120), email: cut(body.email, 200).toLowerCase(), phone: cut(body.phone, 40),
    address: cut(body.address, 200), city: cut(body.city, 80),
  };
  if (!customer.name || !EMAIL.test(customer.email) || !customer.phone) throw new HttpError('Please fill in your name, email and phone number.', 'bad_request', 400);
  if ((await store.col('orders').countDocuments({ zenpos_licence: lic.id, created_at: { $gt: hourAgo() } })) >= 10) {
    throw new HttpError('Too many payment attempts. Please try again later, or pay by bank transfer.', 'rate_limited', 429);
  }
  const order = {
    id: `ZP${Date.now().toString(36).toUpperCase()}${randomBytes(3).toString('hex').toUpperCase()}`, kind: 'zenpos', zenpos_licence: lic.id,
    years: 1, amount: lic.price, currency: lic.currency, status: 'pending', customer, created_at: new Date().toISOString(),
  };
  await store.col('orders').insertOne(order);
  const site = siteOf(req);
  return checkoutForm({
    orderId: order.id, amount: order.amount, currency: order.currency, customer,
    items: `${lic.package} for ${lic.shop} (${lic.licence_id}), 1 year`,
    returnUrl: `${site}/renew/zenpos?t=${lic.renew_token}&order=${order.id}`,
    cancelUrl: `${site}/renew/zenpos?t=${lic.renew_token}`,
    notifyUrl: `${site}/api/payhere/notify`,
  });
}

async function orderStatus(store, lic, orderId) {
  const order = typeof orderId === 'string' ? await store.col('orders').findOne({ id: orderId, zenpos_licence: lic.id }) : null;
  if (!order) throw new HttpError('That payment was not found.', 'not_found', 404);
  return { status: order.status, amount: order.amount, currency: order.currency, paid_until: order.status === 'paid' ? lic.paid_until : null };
}

// A photo of a bank slip, shrunk by the page, for staff to approve in the Key Maker.
async function slip(store, lic, body, ip) {
  usable(lic);
  const image = typeof body.image === 'string' ? body.image : '';
  if (!SLIP.test(image)) throw new HttpError('Please choose a photo of the bank slip (JPG or PNG).', 'bad_request', 400);
  if (image.length > MAX_SLIP) throw new HttpError('That photo is too large. Please take a smaller one.', 'too_large', 413);
  const since = new Date(Date.now() - 864e5).toISOString();
  if ((await store.col('zenpos_slips').countDocuments({ licence: lic.id, created_at: { $gt: since } })) >= 5) {
    throw new HttpError(`You've sent several slips today. Zenatiq will check them soon, or WhatsApp ${WHATSAPP}.`, 'rate_limited', 429);
  }
  const doc = {
    id: randomUUID(), licence: lic.id, licence_id: lic.licence_id, shop: lic.shop, amount: lic.price, currency: lic.currency,
    image, size: image.length, reference: cut(body.reference, 120) || null, payer: cut(body.payer, 120) || null,
    status: 'pending', ip, created_at: new Date().toISOString(),
  };
  await store.col('zenpos_slips').insertOne(doc);
  await zenpos.addEvent(store, lic, zenpos.eventOf(`Shop · ${doc.payer || lic.shop}`, 'slip', 'Sent a bank slip from the renewal page'));
  return { received: true };
}

// A new shop asking for ZenPOS on the Buy ZenPOS page. Staff create the licence from it.
async function request(store, body, ip) {
  const shop = cut(body.shop, 120);
  const name = cut(body.name, 120);
  const phone = cut(body.phone, 40);
  const email = cut(body.email, 200).toLowerCase();
  const device = body.device ? zenpos.normalDevice(body.device) : null;
  if (!shop || !name || !phone) throw new HttpError('Please fill in the shop name, your name and your phone number.', 'bad_request', 400);
  if (body.device && !device) throw new HttpError('The Computer ID looks like ZP-XXXX-XXXX-XXXX. You find it in ZenPOS → Subscription.', 'bad_request', 400);
  if (email && !EMAIL.test(email)) throw new HttpError("That email address doesn't look right.", 'bad_request', 400);
  if (ip && (await store.col('zenpos_requests').countDocuments({ ip, created_at: { $gt: hourAgo() } })) >= 5) {
    throw new HttpError(`Thanks, we've got your request. To add anything, WhatsApp us on ${WHATSAPP}.`, 'rate_limited', 429);
  }
  await store.col('zenpos_requests').insertOne({
    id: randomUUID(), shop, name, phone, email: email || null, device, note: cut(body.note, 1000) || null,
    status: 'new', ip, created_at: new Date().toISOString(),
  });
  return { received: true };
}
