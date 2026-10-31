// PayHere's payment notifications (the notify_url in the renewal page's checkout form).
// POST /api/payhere/notify  PayHere sends one when a payment succeeds, fails or is cancelled. A
// successful one renews the subscription straight away, once, and thanks the client by email.
import { Router } from 'express';
import { readForm, send, fail, HttpError } from '../http.js';
import { readNotification } from '../payhere.js';
import { createPortal, SYSTEM } from '../core/ops.js';
import { today } from '../core/renewals.js';
import { renewedEmail } from '../mail.js';

export function payhereRoutes(api) {
  const router = Router();

  router.post('/notify', async (req, res) => {
    if (api.missing().includes('MONGODB_URI')) throw new HttpError('Payments are not available yet.', 'not_configured', 503);
    const note = readNotification(await readForm(req));
    if (!note) throw new HttpError('That is not a genuine PayHere notification.', 'forbidden', 403);
    const store = await api.store();
    const orders = store.col('orders');
    const order = await orders.findOne({ id: note.orderId });
    if (!order) throw new HttpError('Unknown order.', 'not_found', 404);

    const done = { status: { $nin: ['paid', 'renewing'] } };
    if (note.status !== 'paid') {
      await orders.updateOne({ id: order.id, ...done }, { $set: { status: note.status, payment_id: note.paymentId } });
      if (note.status === 'charged_back' && order.status === 'paid') {
        // The renewal stays recorded: the team decides what to do about a reversed payment.
        await orders.updateOne({ id: order.id }, { $set: { charged_back_at: new Date().toISOString() } });
        console.error(`PayHere reversed payment ${note.paymentId} for order ${order.id} (project ${order.project_id}).`);
      }
      return send(res, 200, { ok: true });
    }
    if (note.amount !== order.amount || note.currency !== order.currency) {
      await orders.updateOne({ id: order.id, ...done }, { $set: { status: 'amount_mismatch', payment_id: note.paymentId } });
      throw new HttpError("The amount paid doesn't match the order.", 'mismatch', 400);
    }
    // Only the first notification of a payment renews: PayHere may send it more than once.
    const claimed = await orders.updateOne({ id: order.id, ...done }, { $set: { status: 'renewing', payment_id: note.paymentId } });
    if (claimed.modifiedCount) {
      try {
        await renew(api, store, order, note);
      } catch (err) {
        // Not renewed, so the order isn't marked paid, and PayHere's next notification can try again.
        await orders.updateOne({ id: order.id, status: 'renewing' }, { $set: { status: order.status } });
        console.error(`PayHere payment ${note.paymentId} for order ${order.id} went through, but the renewal couldn't be recorded:`, err.message);
        throw err;
      }
    }
    send(res, 200, { ok: true });
  });

  router.use((err, req, res, next) => fail(res, err));
  return router;
}

// Records the renewal, marks the order paid, then thanks the client by email.
async function renew(api, store, order, note) {
  const reference = `PayHere ${note.paymentId}`;
  const sub = await createPortal(store, { mailer: api.mailer }).run(SYSTEM, 'subscriptions.renew', {
    projectId: order.project_id, years: order.years, amount: order.amount, paid_on: today(), method: 'online', reference,
  });
  await store.col('orders').updateOne({ id: order.id }, { $set: { status: 'paid', paid_at: new Date().toISOString() } });
  try {
    const project = await store.col('projects').findOne({ id: order.project_id });
    const client = project.client_id ? await store.col('clients').findOne({ id: project.client_id }) : null;
    const to = order.customer?.email || sub.email || client?.email; // the email the payer gave "for the receipt"
    if (to) await api.mailer(renewedEmail({ sub, project, client, to, until: sub.ends_on, amount: order.amount, reference }));
  } catch (err) {
    console.error('The thank-you email after an online renewal could not be sent:', err.message);
  }
}
