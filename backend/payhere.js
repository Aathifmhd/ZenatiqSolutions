// Online payments through PayHere (payhere.lk), for the renewal page. PAYHERE_MERCHANT_ID and
// PAYHERE_MERCHANT_SECRET come from PayHere's settings; PAYHERE_SANDBOX=1 uses PayHere's test
// system instead of real payments.
import { createHash, timingSafeEqual } from 'node:crypto';

const md5 = (text) => createHash('md5').update(text).digest('hex').toUpperCase();
const settings = () => ({
  id: process.env.PAYHERE_MERCHANT_ID?.trim() || '',
  secret: process.env.PAYHERE_MERCHANT_SECRET?.trim() || '',
  sandbox: /^(1|true|yes)$/i.test(process.env.PAYHERE_SANDBOX?.trim() || ''),
});

export const payhereStatus = () => {
  const { id, secret, sandbox } = settings();
  return { online: Boolean(id && secret), sandbox };
};
export const PAID = 2;
const STATUS = { 2: 'paid', 0: 'pending', '-1': 'cancelled', '-2': 'failed', '-3': 'charged_back' };
const amountText = (n) => Number(n).toFixed(2);

// The form the renewal page posts to PayHere's checkout. PayHere checks `hash` to know the order
// and amount came from us.
export function checkoutForm({ orderId, amount, currency, items, customer, returnUrl, cancelUrl, notifyUrl }) {
  const { id, secret, sandbox } = settings();
  const [first, ...rest] = customer.name.trim().split(/\s+/);
  return {
    action: sandbox ? 'https://sandbox.payhere.lk/pay/checkout' : 'https://www.payhere.lk/pay/checkout',
    fields: {
      merchant_id: id, return_url: returnUrl, cancel_url: cancelUrl, notify_url: notifyUrl,
      order_id: orderId, items, currency, amount: amountText(amount),
      first_name: first, last_name: rest.join(' ') || first, email: customer.email, phone: customer.phone,
      address: customer.address || 'Sri Lanka', city: customer.city || 'Colombo', country: 'Sri Lanka',
      hash: md5(`${id}${orderId}${amountText(amount)}${currency}${md5(secret)}`),
    },
  };
}

// A payment notification from PayHere, if it's genuine: PayHere signs each one with our merchant
// secret (md5sig). Returns null for anything else.
export function readNotification(form) {
  const { id, secret } = settings();
  const { merchant_id: merchant, order_id: orderId, payhere_amount: amount, payhere_currency: currency, status_code: code, md5sig, payment_id: paymentId } = form || {};
  if (!id || !secret || merchant !== id || typeof md5sig !== 'string' || !orderId) return null;
  const expected = Buffer.from(md5(`${merchant}${orderId}${amount}${currency}${code}${md5(secret)}`));
  const given = Buffer.from(md5sig.toUpperCase());
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  return { orderId: String(orderId), paymentId: String(paymentId || ''), amount: Number(amount), currency: String(currency), status: STATUS[code] || 'unknown' };
}
