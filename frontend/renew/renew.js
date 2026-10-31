// The renewal page (/renew?t=...): a client renews a yearly subscription from the link in a
// reminder email or their widget. They choose 1 to 3 years and pay online through PayHere, or by
// bank transfer. Back from PayHere (?order=...), the page waits for the payment to be confirmed.
const box = document.getElementById('renew');
const params = new URLSearchParams(location.search);
const token = params.get('t') || '';
const orderId = params.get('order');
const WHATSAPP = '94758112170';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const money = (n, currency) => `${currency} ${Number(n).toLocaleString('en-US', { maximumFractionDigits: 2 })}`;
const longDay = (d) => new Date(`${d}T00:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const STATUS = { active: 'Active', ending: 'Ending soon', grace: 'Renewal due', expired: 'Expired', cancelled: 'Stopped' };

async function api(op, args = {}) {
  let res;
  try {
    res = await fetch('/api/renew', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...args, op, token }) });
  } catch {
    throw new Error('Could not reach Zenatiq. Check your internet connection and try again.');
  }
  const json = await res.json().catch(() => null);
  if (!res.ok || !json) throw new Error(json?.error?.message || 'Something went wrong. Please try again.');
  return json;
}

const whatsappLink = (text) => `https://wa.me/${WHATSAPP}?text=${encodeURIComponent(text)}`;

// What the client should know about where their subscription stands.
function standing(info) {
  // Days it still works, today and the last grace day included.
  const graceLeft = info.days_left + Math.round((Date.parse(info.grace_until) - Date.parse(info.paid_until)) / 864e5) + 1;
  if (info.status === 'expired') return `<p class="note warn">This subscription ended on ${longDay(info.paid_until)}. Renew it to keep using ${esc(info.project)}.</p>`;
  if (info.status === 'grace') return `<p class="note warn">This subscription ended on ${longDay(info.paid_until)}. Renew within ${plural(Math.max(graceLeft, 0), 'day')} to avoid any interruption.</p>`;
  if (info.status === 'ending') return `<p class="note">It ends ${info.days_left === 0 ? 'today' : `in ${plural(info.days_left, 'day')}`}. Renewing now adds the new year on after ${longDay(info.paid_until)}, so you don't lose any days.</p>`;
  if (info.status === 'cancelled') return '<p class="note">This subscription was stopped. Renewing starts it again.</p>';
  return `<p class="note">You can renew early: the new year is added on after ${longDay(info.paid_until)}.</p>`;
}

function draw(info) {
  const { customer: c } = info;
  box.innerHTML = `
    <section class="card">
      <div class="lead"><h1>Renew ${esc(info.package)}</h1><p>For ${esc(info.project)}${info.client ? ` · ${esc(info.client)}` : ''}</p></div>
      <div class="facts">
        <div><span>Paid until</span><b>${longDay(info.paid_until)}</b></div>
        <div><span>Status</span><b><span class="pill ${esc(info.status)}">${STATUS[info.status] || esc(info.status)}</span></b></div>
      </div>
      ${standing(info)}
    </section>
    <section class="card">
      <h2>1. How many years?</h2>
      <div class="years">${info.options.map((o, i) => `
        <label class="year"><input type="radio" name="years" value="${o.years}" ${i === 0 ? 'checked' : ''}>
          <span><b>${plural(o.years, 'year')}</b><small>Paid until ${longDay(o.paid_until)}</small></span>
          <strong>${money(o.amount, info.currency)}</strong></label>`).join('')}</div>
    </section>
    <section class="card">
      <h2>2. Pay</h2>
      <div class="methods">
        ${info.online ? `<form class="method" data-online novalidate>
          <h3>Pay online</h3>
          <p>By card or mobile wallet, through PayHere. Your renewal goes through as soon as the payment does.</p>
          <div class="fields">
            <label class="field"><span>Your name</span><input name="name" required maxlength="120" autocomplete="name" value="${esc(c.name)}"></label>
            <label class="field"><span>Phone</span><input name="phone" type="tel" required maxlength="40" autocomplete="tel" value="${esc(c.phone)}"></label>
            <label class="field wide"><span>Email, for the receipt</span><input name="email" type="email" required maxlength="200" autocomplete="email" value="${esc(c.email)}"></label>
            <label class="field"><span>Address <em>(optional)</em></span><input name="address" maxlength="200" autocomplete="street-address" value="${esc(c.address)}"></label>
            <label class="field"><span>City <em>(optional)</em></span><input name="city" maxlength="80" autocomplete="address-level2"></label>
          </div>
          <p class="error" role="alert" hidden data-error></p>
          <button class="btn" type="submit">Pay <span data-amount></span></button>
          ${info.sandbox ? '<p class="note">Test mode: no real money is taken.</p>' : ''}
        </form>` : ''}
        <div class="method">
          <h3>Pay by bank transfer</h3>
          ${info.bank_details
            ? `<div class="bank">${esc(info.bank_details)}</div>
               <p>Please use <b>${esc(info.project)}</b> as the reference and send us the slip on WhatsApp. We renew it as soon as the money arrives.</p>`
            : "<p>Message us on WhatsApp and we'll send you our bank details.</p>"}
          <a class="btn dark" data-whatsapp target="_blank" rel="noopener">Send on WhatsApp</a>
        </div>
      </div>
    </section>`;

  const chosen = () => info.options.find((o) => String(o.years) === box.querySelector('[name=years]:checked').value);
  const update = () => {
    const o = chosen();
    const amount = money(o.amount, info.currency);
    box.querySelector('[data-amount]')?.replaceChildren(amount);
    box.querySelector('[data-whatsapp]').href = whatsappLink(
      `Hi Zenatiq, I'd like to renew ${info.package} for ${info.project} for ${plural(o.years, 'year')} (${amount}).`);
  };
  box.querySelectorAll('[name=years]').forEach((input) => input.addEventListener('change', update));
  update();

  const form = box.querySelector('[data-online]');
  form?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const error = form.querySelector('[data-error]');
    if (!form.reportValidity()) return;
    const button = form.querySelector('[type=submit]');
    button.disabled = true;
    error.hidden = true;
    const fd = new FormData(form);
    try {
      const { action, fields } = await api('checkout', {
        years: chosen().years, name: fd.get('name'), email: fd.get('email'), phone: fd.get('phone'), address: fd.get('address'), city: fd.get('city'),
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
}

// Back from PayHere: PayHere tells our server about the payment separately, usually within seconds.
async function waitForPayment(info) {
  box.innerHTML = '<section class="card"><h1>Confirming your payment…</h1><div class="spinner" role="status" aria-label="Waiting"></div></section>';
  for (let tries = 0; tries < 40; tries++) {
    const order = await api('order', { order: orderId }).catch(() => null);
    if (order?.status === 'paid') {
      box.innerHTML = `<section class="card">
        <div class="lead"><h1>Thank you!</h1><p>Your payment of ${money(order.amount, order.currency)} is confirmed.</p></div>
        <p class="note ok">${esc(info.package)} for ${esc(info.project)} is now paid until ${longDay(order.paid_until)}. We've emailed you a receipt.</p>
        <a class="btn ghost" href="/">Back to Zenatiq Solutions</a></section>`;
      return;
    }
    if (order && ['failed', 'cancelled', 'amount_mismatch', 'charged_back'].includes(order.status)) {
      box.innerHTML = `<section class="card"><h1>The payment didn't go through</h1>
        <p class="note warn">Nothing was renewed. You can try again, or pay by bank transfer.</p>
        <a class="btn" href="/renew?t=${encodeURIComponent(token)}">Try again</a></section>`;
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 3000));
  }
  box.innerHTML = `<section class="card"><h1>Still waiting for PayHere</h1>
    <p class="note">We haven't heard from PayHere yet. As soon as the payment is confirmed, your subscription is renewed and we email you a receipt.</p>
    <a class="btn ghost" href="/renew?t=${encodeURIComponent(token)}">Back to the renewal page</a></section>`;
}

function fail(message) {
  box.innerHTML = `<section class="card"><h1>This renewal link didn't open</h1>
    <p class="error">${esc(message)}</p>
    <a class="btn dark" href="${whatsappLink('Hi Zenatiq, my renewal link is not working.')}" target="_blank" rel="noopener">Message us on WhatsApp</a></section>`;
}

(async () => {
  try {
    if (!token) throw new Error("This link is missing its code. Please use the link from Zenatiq's email.");
    const info = await api('info');
    if (orderId) await waitForPayment(info);
    else draw(info);
  } catch (err) {
    fail(err.message);
  }
})();
