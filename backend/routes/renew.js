// The renewal page's API (frontend/renew/). A subscription's secret link, from the client's
// reminder emails or widget, opens its page, so no sign-in is needed.
// POST /api/renew { op: "info", token }          what's due, and the ways to pay
// POST /api/renew { op: "checkout", token, years, name, email, phone, address, city }
//                                                a PayHere checkout form for that many years
// POST /api/renew { op: "order", token, order }  whether an online payment has gone through
import { randomBytes } from 'node:crypto';
import { Router } from 'express';
import { readJson, checkPortalRequest, send, fail, HttpError } from '../http.js';
import { today, addYears, periodEnd, daysBetween, withStatus, graceUntil, SITE } from '../core/renewals.js';
import { checkoutForm, payhereStatus } from '../payhere.js';

const YEARS = [1, 2, 3];
const WHATSAPP = '+94 75 811 2170';
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const cut = (value, max) => (typeof value === 'string' ? value.trim().slice(0, max) : '');
const total = (sub, years) => Math.round(sub.price * years * 100) / 100;
// Where a renewal paid today would take "paid until" (the same rule as recording one in the portal).
const renewedUntil = (sub, years, day = today()) =>
  (daysBetween(sub.ends_on, day) > sub.grace_days ? periodEnd(day, years) : addYears(sub.ends_on, years));
// This site's address for PayHere to send people back to. On Vercel it's always the real site.
const siteOf = (req) => {
  if (process.env.VERCEL) return SITE;
  const host = req.headers.host || 'localhost';
  return `${/^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(host) ? 'http' : 'https'}://${host}`;
};

export function renewRoutes(api) {
  const router = Router();

  router.post('/', async (req, res) => {
    if (api.missing().includes('MONGODB_URI')) throw new HttpError('Renewals are not available yet.', 'not_configured', 503);
    checkPortalRequest(req);
    const body = await readJson(req);
    const store = await api.store();
    const found = await subscriptionFor(store, body.token);
    if (body.op === 'info') return send(res, 200, await info(store, found));
    if (body.op === 'checkout') return send(res, 200, await checkout(req, store, found, body));
    if (body.op === 'order') return send(res, 200, await orderStatus(store, found, body.order));
    throw new HttpError('Unknown request.', 'unknown_op', 404);
  });

  router.all('/', (req, res) => send(res, 405, { error: { code: 'method', message: 'Use POST.' } }, { Allow: 'POST' }));
  router.use((err, req, res, next) => fail(res, err));
  return router;
}

async function subscriptionFor(store, token) {
  const sub = typeof token === 'string' && /^[0-9a-f]{48}$/.test(token) ? await store.col('subscriptions').findOne({ renew_token: token }) : null;
  const project = sub && (await store.col('projects').findOne({ id: sub.project_id }));
  if (!project) throw new HttpError("This renewal link isn't valid any more. Please ask Zenatiq for a new one.", 'bad_link', 404);
  const client = project.client_id ? await store.col('clients').findOne({ id: project.client_id }) : null;
  return { sub, project, client };
}

async function info(store, { sub, project, client }) {
  const shown = withStatus(sub);
  const settings = await store.col('settings').findOne({ id: 'renewal-page' });
  return {
    project: project.name, client: client?.name ?? null, package: sub.package, price: sub.price, currency: sub.currency,
    paid_until: sub.ends_on, grace_until: graceUntil(sub), status: shown.status, days_left: shown.days_left,
    options: YEARS.map((years) => ({ years, amount: total(sub, years), paid_until: renewedUntil(sub, years) })),
    bank_details: settings?.bank_details ?? null, whatsapp: WHATSAPP, ...payhereStatus(),
    customer: {
      name: client?.contact_name || client?.name || '', email: sub.email || client?.email || '',
      phone: client?.phone || '', address: client?.address || '',
    },
  };
}

async function checkout(req, store, { sub, project }, body) {
  if (!payhereStatus().online) throw new HttpError("Online payment isn't available yet. Please pay by bank transfer.", 'online_off', 503);
  const years = Number(body.years);
  if (!YEARS.includes(years)) throw new HttpError('Choose 1, 2 or 3 years.', 'bad_request', 400);
  const amount = total(sub, years);
  if (!(amount > 0)) throw new HttpError("There's nothing to pay online for this subscription. Please contact Zenatiq.", 'bad_request', 400);
  const customer = {
    name: cut(body.name, 120), email: cut(body.email, 200).toLowerCase(), phone: cut(body.phone, 40),
    address: cut(body.address, 200), city: cut(body.city, 80),
  };
  if (!customer.name || !EMAIL.test(customer.email) || !customer.phone) {
    throw new HttpError('Please fill in your name, email and phone number.', 'bad_request', 400);
  }
  const hourAgo = new Date(Date.now() - 3600e3).toISOString();
  if ((await store.col('orders').countDocuments({ subscription_id: sub.id, created_at: { $gt: hourAgo } })) >= 10) {
    throw new HttpError('Too many payment attempts. Please try again later, or pay by bank transfer.', 'rate_limited', 429);
  }
  const order = {
    id: `ZQ${Date.now().toString(36).toUpperCase()}${randomBytes(3).toString('hex').toUpperCase()}`,
    subscription_id: sub.id, project_id: project.id, years, amount, currency: sub.currency, status: 'pending',
    customer, created_at: new Date().toISOString(),
  };
  await store.col('orders').insertOne(order);
  const site = siteOf(req);
  return checkoutForm({
    orderId: order.id, amount, currency: sub.currency, customer,
    items: `${sub.package} for ${project.name}, ${years} year${years > 1 ? 's' : ''}`,
    returnUrl: `${site}/renew?t=${sub.renew_token}&order=${order.id}`,
    cancelUrl: `${site}/renew?t=${sub.renew_token}`,
    notifyUrl: `${site}/api/payhere/notify`,
  });
}

async function orderStatus(store, { sub }, orderId) {
  const order = typeof orderId === 'string' ? await store.col('orders').findOne({ id: orderId, subscription_id: sub.id }) : null;
  if (!order) throw new HttpError('That payment was not found.', 'not_found', 404);
  return { status: order.status, years: order.years, amount: order.amount, currency: order.currency, paid_until: order.status === 'paid' ? sub.ends_on : null };
}
