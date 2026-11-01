// The ZenPOS renewal page (/renew/zenpos?t=...): ZenPOS's Renew now button and the reminder emails
// open it. The shop renews a year online through PayHere, or by bank transfer with a photo of the
// slip, which Zenatiq checks in the Key Maker. Back from PayHere (?order=...), it waits for the payment.
const box = document.getElementById('renew');
const params = new URLSearchParams(location.search);
const token = params.get('t') || '';
const orderId = params.get('order');
const WHATSAPP = '94758112170';
const MAX_SLIP = 1_400_000;

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const money = (n, currency) => `${currency} ${Number(n).toLocaleString('en-US', { maximumFractionDigits: 2 })}`;
const longDay = (d) => new Date(`${d}T00:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const STATE = { active: 'Active', ending: 'Ending soon', grace: 'Renewal due', expired: 'Read-only', cancelled: 'Cancelled' };
const whatsappLink = (text) => `https://wa.me/${WHATSAPP}?text=${encodeURIComponent(text)}`;

async function api(op, args = {}) {
  let res;
  try {
    res = await fetch('/api/zenpos', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...args, op, token }) });
  } catch {
    throw new Error('Could not reach Zenatiq. Check your internet connection and try again.');
  }
  const json = await res.json().catch(() => null);
  if (!res.ok || !json) throw new Error(json?.error?.message || 'Something went wrong. Please try again.');
  return json;
}

// Where the licence stands, in the shop's words.
function standing(info) {
  if (info.state === 'cancelled') return `<p class="note warn">This licence was cancelled. Please message Zenatiq on WhatsApp.</p>`;
  if (info.state === 'expired') return `<p class="note warn">It ended on ${longDay(info.paid_until)}, so ZenPOS is read-only: selling and changes are paused, and your data is safe. Renew to switch it back on.</p>`;
  if (info.state === 'grace') return `<p class="note warn">It ended on ${longDay(info.paid_until)}. ZenPOS keeps working until ${longDay(info.grace_until)}; renew before then so it doesn't become read-only.</p>`;
  if (info.state === 'ending') return `<p class="note">It ends ${info.days_left === 0 ? 'today' : `in ${plural(info.days_left, 'day')}`}. Renewing now adds the new year after ${longDay(info.paid_until)}, so you don't lose any days.</p>`;
  return `<p class="note">You can renew early: the new year is added after ${longDay(info.paid_until)}.</p>`;
}

function draw(info) {
  const { customer: c } = info;
  const amount = money(info.price, info.currency);
  const open = info.state !== 'cancelled';
  box.innerHTML = `
    <section class="card">
      <div class="lead"><h1>Renew ZenPOS</h1><p>For ${esc(info.shop)} · Licence ${esc(info.licence_id)}</p></div>
      <div class="facts">
        <div><span>Package</span><b>${esc(info.package)}, ${amount} a year, for one computer</b></div>
        <div><span>Status</span><b><span class="pill ${esc(info.state)}">${STATE[info.state] || esc(info.state)}</span></b></div>
        <div><span>Paid until</span><b>${longDay(info.paid_until)}</b></div>
        <div><span>Last day to renew</span><b>${longDay(info.grace_until)}</b></div>
      </div>
      ${standing(info)}
      ${open ? `<p class="note ok">Renew today and it's paid until ${longDay(info.renews_to)}.</p>` : ''}
    </section>
    <section class="card">
      <h2>What's included</h2>
      <ul class="list">${info.services.map((s) => `<li>${esc(s)}</li>`).join('')}</ul>
      <h2>Terms</h2>
      <ul class="terms">${info.terms.map((t) => `<li>${esc(t)}</li>`).join('')}</ul>
    </section>
    ${open ? `<section class="card">
      <h2>Pay ${amount} for a year</h2>
      <div class="methods">
        ${info.online ? `<form class="method" data-online novalidate>
          <h3>Pay online</h3>
          <p>By card or mobile wallet, through PayHere. ZenPOS is renewed as soon as the payment goes through.</p>
          <div class="fields">
            <label class="field"><span>Your name</span><input name="name" required maxlength="120" autocomplete="name" value="${esc(c.name)}"></label>
            <label class="field"><span>Phone</span><input name="phone" type="tel" required maxlength="40" autocomplete="tel" value="${esc(c.phone)}"></label>
            <label class="field wide"><span>Email, for the receipt</span><input name="email" type="email" required maxlength="200" autocomplete="email" value="${esc(c.email)}"></label>
            <label class="field"><span>Address <em>(optional)</em></span><input name="address" maxlength="200" autocomplete="street-address" value="${esc(c.address)}"></label>
            <label class="field"><span>City <em>(optional)</em></span><input name="city" maxlength="80" autocomplete="address-level2"></label>
          </div>
          <p class="error" role="alert" hidden data-error></p>
          <button class="btn" type="submit">Pay ${amount}</button>
          ${info.sandbox ? '<p class="note">Test mode: no real money is taken.</p>' : ''}
        </form>` : ''}
        <form class="method slip" data-slip novalidate>
          <h3>Pay by bank transfer</h3>
          ${info.bank_details
            ? `<div class="bank">${esc(info.bank_details)}</div>`
            : "<p>Message us on WhatsApp and we'll send you our bank details.</p>"}
          <p>Please use <b>${esc(info.licence_id)}</b> as the reference. Then send us a photo of the slip here, and we renew ZenPOS as soon as we've checked it.</p>
          <label class="field"><span>Photo of the bank slip</span><input name="photo" type="file" accept="image/*" required></label>
          <img class="preview" alt="" hidden data-preview>
          <div class="fields">
            <label class="field"><span>Reference on the slip <em>(optional)</em></span><input name="reference" maxlength="120"></label>
            <label class="field"><span>Your name <em>(optional)</em></span><input name="payer" maxlength="120" value="${esc(c.name)}"></label>
          </div>
          <p class="error" role="alert" hidden data-slip-error></p>
          <button class="btn dark" type="submit">Send the slip</button>
          <a class="btn ghost" href="${whatsappLink(`Hi Zenatiq, I'd like to renew ZenPOS for ${info.shop} (licence ${info.licence_id}).`)}" target="_blank" rel="noopener">Or message us on WhatsApp</a>
        </form>
      </div>
    </section>` : `<a class="btn dark" href="${whatsappLink(`Hi Zenatiq, about ZenPOS licence ${info.licence_id} (${info.shop}).`)}" target="_blank" rel="noopener">Message us on WhatsApp</a>`}`;

  box.querySelector('[data-online]')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = e.currentTarget;
    const error = form.querySelector('[data-error]');
    if (!form.reportValidity()) return;
    const button = form.querySelector('[type=submit]');
    button.disabled = true;
    error.hidden = true;
    const fd = new FormData(form);
    try {
      const { action, fields } = await api('checkout', {
        name: fd.get('name'), email: fd.get('email'), phone: fd.get('phone'), address: fd.get('address'), city: fd.get('city'),
      });
      // Hand over to PayHere's checkout page.
      const post = Object.assign(document.createElement('form'), { method: 'post', action });
      for (const [name, value] of Object.entries(fields)) post.append(Object.assign(document.createElement('input'), { type: 'hidden', name, value }));
      document.body.append(post);
      post.submit();
    } catch (err) {
      error.textContent = err.message;
      error.hidden = false;
      button.disabled = false;
    }
  });

  const slip = box.querySelector('[data-slip]');
  if (!slip) return;
  let photo = null;
  slip.elements.photo.addEventListener('change', async () => {
    const file = slip.elements.photo.files[0];
    const error = slip.querySelector('[data-slip-error]');
    error.hidden = true;
    photo = null;
    if (!file) return;
    try {
      photo = await shrink(file);
      Object.assign(slip.querySelector('[data-preview]'), { src: photo, hidden: false });
    } catch {
      error.textContent = "That photo couldn't be opened. Please choose a JPG or PNG photo of the slip.";
      error.hidden = false;
    }
  });
  slip.addEventListener('submit', async (e) => {
    e.preventDefault();
    const error = slip.querySelector('[data-slip-error]');
    if (!slip.reportValidity() || !photo) return;
    const button = slip.querySelector('[type=submit]');
    button.disabled = true;
    error.hidden = true;
    const fd = new FormData(slip);
    try {
      await api('slip', { image: photo, reference: fd.get('reference'), payer: fd.get('payer') });
      slip.innerHTML = `<h3>Thank you, we've got the slip</h3>
        <p class="note ok">Zenatiq will check it and renew ZenPOS, usually within a day. ZenPOS picks up the new date at its next check, or open Subscription and press "Check with Zenatiq now".</p>`;
    } catch (err) {
      error.textContent = err.message;
      error.hidden = false;
      button.disabled = false;
    }
  });
}

// Shrinks a phone photo to at most 1600 pixels across, as a JPEG, so it uploads quickly.
async function shrink(file) {
  const bitmap = await createImageBitmap(file);
  for (const [size, quality] of [[1600, 0.82], [1200, 0.7], [900, 0.6]]) {
    const scale = Math.min(1, size / Math.max(bitmap.width, bitmap.height));
    const canvas = Object.assign(document.createElement('canvas'), { width: Math.round(bitmap.width * scale), height: Math.round(bitmap.height * scale) });
    canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const data = canvas.toDataURL('image/jpeg', quality);
    if (data.length <= MAX_SLIP) return data;
  }
  throw new Error('too large');
}

// Back from PayHere: PayHere tells our server about the payment separately, usually within seconds.
async function waitForPayment(info) {
  box.innerHTML = '<section class="card"><h1>Confirming your payment…</h1><div class="spinner" role="status" aria-label="Waiting"></div></section>';
  for (let tries = 0; tries < 40; tries++) {
    const order = await api('order', { order: orderId }).catch(() => null);
    if (order?.status === 'paid') {
      box.innerHTML = `<section class="card">
        <div class="lead"><h1>Thank you!</h1><p>Your payment of ${money(order.amount, order.currency)} is confirmed.</p></div>
        <p class="note ok">ZenPOS for ${esc(info.shop)} is now paid until ${longDay(order.paid_until)}. In ZenPOS, open Subscription and press "Check with Zenatiq now" to see it straight away.</p>
        <a class="btn ghost" href="/">Back to Zenatiq Solutions</a></section>`;
      return;
    }
    if (order && ['failed', 'cancelled', 'amount_mismatch', 'charged_back'].includes(order.status)) {
      box.innerHTML = `<section class="card"><h1>The payment didn't go through</h1>
        <p class="note warn">Nothing was renewed. You can try again, or pay by bank transfer.</p>
        <a class="btn" href="/renew/zenpos?t=${encodeURIComponent(token)}">Try again</a></section>`;
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 3000));
  }
  box.innerHTML = `<section class="card"><h1>Still waiting for PayHere</h1>
    <p class="note">We haven't heard from PayHere yet. As soon as the payment is confirmed, ZenPOS is renewed and we email you a receipt.</p>
    <a class="btn ghost" href="/renew/zenpos?t=${encodeURIComponent(token)}">Back to the renewal page</a></section>`;
}

function fail(message) {
  box.innerHTML = `<section class="card"><h1>This renewal link didn't open</h1>
    <p class="error">${esc(message)}</p>
    <a class="btn dark" href="${whatsappLink('Hi Zenatiq, my ZenPOS renewal link is not working.')}" target="_blank" rel="noopener">Message us on WhatsApp</a></section>`;
}

(async () => {
  try {
    if (!token) throw new Error('This link is missing its code. Please use the Renew now button in ZenPOS, or the link in our email.');
    const info = await api('info');
    if (orderId) await waitForPayment(info);
    else draw(info);
  } catch (err) {
    fail(err.message);
  }
})();
