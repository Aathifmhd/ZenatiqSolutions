// Email from the portal, sent through Resend (resend.com) with RESEND_API_KEY. Without that key,
// emails are printed in the terminal when the site runs on your computer, and refused on Vercel.
import { HttpError } from './http.js';
import { TEMPORARY_DAYS } from './passwords.js';

const FROM = 'Zenatiq Solutions <portal@zenatiqsolutions.com>';
const PORTAL = 'https://www.zenatiqsolutions.com/admin';
const WHATSAPP = '+94 75 811 2170';

// Returns a function that sends one email: { to, subject, text, html } -> { sent }.
// sent is false when the email was only printed. printOnly is for the demo, which never sends
// real email, even when .env has a Resend key.
export function createMailer({ printOnly = false } = {}) {
  return async function sendEmail({ to, subject, text, html }) {
    const key = process.env.RESEND_API_KEY?.trim();
    if (!key || printOnly) {
      if (process.env.VERCEL && !printOnly) throw new HttpError("Email isn't set up yet. Add RESEND_API_KEY in Vercel, then redeploy.", 'email_not_configured', 503);
      console.log(`\n--- Email, not sent (${printOnly ? 'demo' : "RESEND_API_KEY isn't set"}) ---\nTo: ${to}\nSubject: ${subject}\n\n${text}\n---\n`);
      return { sent: false };
    }
    let res;
    try {
      res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: process.env.MAIL_FROM?.trim() || FROM, to: [to], subject, text, html,
          reply_to: process.env.MAIL_REPLY_TO?.trim() || undefined,
        }),
      });
    } catch {
      throw new HttpError("The email couldn't be sent: Resend could not be reached.", 'email_failed', 502);
    }
    if (!res.ok) {
      const answer = await res.json().catch(() => null);
      throw new HttpError(`The email couldn't be sent: ${answer?.message || `Resend answered ${res.status}`}`, 'email_failed', 502);
    }
    return { sent: true };
  };
}

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const longDate = (day) => new Date(`${day}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
const price = (n, currency) => `${currency} ${Number(n).toLocaleString('en-US', { maximumFractionDigits: 2 })}`;

// The email with someone's username and temporary password: a welcome for new people, or a
// replacement when an owner or admin sends a new one.
export function passwordEmail({ member, password, by, welcome }) {
  const subject = welcome ? 'Your Zenatiq admin portal account' : 'Your new Zenatiq admin portal password';
  const intro = welcome
    ? `${by || 'Zenatiq Solutions'} added you to the Zenatiq Solutions admin portal.`
    : `${by || 'Zenatiq Solutions'} sent you a new temporary password for the Zenatiq Solutions admin portal.`;
  const after = `You'll choose your own password when you sign in. This temporary password stops working after ${TEMPORARY_DAYS} days.`;
  const text = [
    `Hi ${member.full_name},`, '', intro, '',
    `Sign in at ${PORTAL}`, `Username: ${member.email}`, `Temporary password: ${password}`, '',
    after, '', 'Zenatiq Solutions',
  ].join('\n');
  const html = `<div style="font-family:Arial,sans-serif;font-size:15px;line-height:1.6;color:#1a1a1f;max-width:520px">
<p>Hi ${esc(member.full_name)},</p>
<p>${esc(intro)}</p>
<table style="margin:18px 0;border-collapse:collapse;font-size:15px">
<tr><td style="padding:4px 16px 4px 0;color:#666">Username</td><td style="padding:4px 0"><b>${esc(member.email)}</b></td></tr>
<tr><td style="padding:4px 16px 4px 0;color:#666">Temporary password</td><td style="padding:4px 0"><b style="font-family:Consolas,monospace;font-size:16px">${esc(password)}</b></td></tr>
</table>
<p><a href="${PORTAL}" style="display:inline-block;padding:11px 20px;border-radius:999px;background:#e10600;color:#fff;font-weight:bold;text-decoration:none">Sign in to the portal</a></p>
<p style="color:#666">${esc(after)}</p>
<p>Zenatiq Solutions</p>
</div>`;
  return { to: member.email, subject, text, html };
}

// A renewal reminder to a client. stage: "before" the paid-until date, the day after it "ended",
// or "expired" once the grace days have run out. left: days from today to the paid-until date.
// link: the client's renewal page.
export function renewalEmail({ sub, project, client, to, stage, left, link = null }) {
  const until = longDate(sub.ends_on);
  const what = `${sub.package} for ${project.name}`;
  const yearly = price(sub.price, sub.currency);
  const graceLeft = Math.max(sub.grace_days + left + 1, 0);
  const when = left === 0 ? 'today' : left === 1 ? 'tomorrow' : `in ${left} days`;
  const [subject, ...lines] = {
    before: [`Renewal reminder: ${project.name} is paid until ${until}`,
      `Your ${what} is paid until ${until}, which is ${when}.`,
      `To keep it running without a break, please renew it for another year (${yearly}).`],
    ended: [`Your ${project.name} subscription has ended`,
      `Your ${what} was paid until ${until}.`,
      `It keeps working for ${graceLeft} more day${graceLeft === 1 ? '' : 's'}. Please renew it (${yearly} a year) before then to avoid any interruption.`],
    expired: [`Your ${project.name} subscription has expired`,
      `Your ${what} was paid until ${until}, and the extra days to renew have now run out.`,
      `Please renew it (${yearly} a year) to keep using it.`],
  }[stage];
  const howTo = link
    ? `Renew online or by bank transfer at ${link}. Questions? Message us on WhatsApp at ${WHATSAPP}${process.env.MAIL_REPLY_TO?.trim() ? ' or reply to this email' : ''}.`
    : `To renew, message us on WhatsApp at ${WHATSAPP}${process.env.MAIL_REPLY_TO?.trim() ? ' or reply to this email' : ''}.`;
  const hello = `Hi ${client?.contact_name || client?.name || project.name},`;
  const text = [hello, '', ...lines, '', howTo, '', 'Thank you,', 'Zenatiq Solutions'].join('\n');
  const button = (href, label) => `<a href="${esc(href)}" style="display:inline-block;padding:11px 20px;border-radius:999px;background:#e10600;color:#fff;font-weight:bold;text-decoration:none">${label}</a>`;
  const html = `<div style="font-family:Arial,sans-serif;font-size:15px;line-height:1.6;color:#1a1a1f;max-width:520px">
<p>${esc(hello)}</p>
${lines.map((line) => `<p>${esc(line)}</p>`).join('\n')}
<p style="margin:18px 0">${link ? button(link, 'Renew now') : button(`https://wa.me/${WHATSAPP.replace(/\D/g, '')}`, 'Renew on WhatsApp')}</p>
<p style="color:#666">${link ? `You can pay online or by bank transfer. Questions? Message us on WhatsApp at ${WHATSAPP}.` : esc(howTo)}</p>
<p>Thank you,<br>Zenatiq Solutions</p>
</div>`;
  return { to, subject, text, html };
}

// The thank-you after a client renews online.
export function renewedEmail({ sub, project, client, to, until, amount, reference }) {
  const hello = `Hi ${client?.contact_name || client?.name || project.name},`;
  const lines = [
    `Thank you! We've received your payment of ${price(amount, sub.currency)}.`,
    `Your ${sub.package} for ${project.name} is now paid until ${longDate(until)}.`,
    `Payment reference: ${reference}`,
  ];
  const text = [hello, '', ...lines, '', 'Zenatiq Solutions'].join('\n');
  const html = `<div style="font-family:Arial,sans-serif;font-size:15px;line-height:1.6;color:#1a1a1f;max-width:520px">
<p>${esc(hello)}</p>
${lines.map((line) => `<p>${esc(line)}</p>`).join('\n')}
<p>Zenatiq Solutions</p>
</div>`;
  return { to, subject: `Renewed: ${project.name} is paid until ${longDate(until)}`, text, html };
}

// --- ZenPOS licences (core/zenpos.js) ------------------------------------------------------------
const zenposHtml = (hello, lines, link) => `<div style="font-family:Arial,sans-serif;font-size:15px;line-height:1.6;color:#1a1a1f;max-width:520px">
<p>${esc(hello)}</p>
${lines.map((line) => `<p>${esc(line)}</p>`).join('\n')}
${link ? `<p style="margin:18px 0"><a href="${esc(link)}" style="display:inline-block;padding:11px 20px;border-radius:999px;background:#e10600;color:#fff;font-weight:bold;text-decoration:none">Renew now</a></p>
<p style="color:#666">Pay online or by bank transfer. Questions? WhatsApp us at ${WHATSAPP}.</p>` : `<p style="color:#666">Questions? WhatsApp us at ${WHATSAPP}.</p>`}
<p>Thank you,<br>Zenatiq Solutions</p>
</div>`;

// A ZenPOS renewal reminder. stage: "before" the paid-until date, or the day after it "ended".
export function zenposReminderEmail({ lic, to, stage, left, link }) {
  const until = longDate(lic.paid_until);
  const when = left === 0 ? 'today' : left === 1 ? 'tomorrow' : `in ${left} days`;
  const [subject, ...lines] = stage === 'ended'
    ? [`ZenPOS for ${lic.shop}: your subscription has ended`,
      `Your ZenPOS subscription for ${lic.shop} was paid until ${until}.`,
      `ZenPOS keeps working until ${longDate(lic.grace_until)}. Please renew it (${price(lic.price, lic.currency)} a year) before then, or it becomes read-only until it's renewed.`]
    : [`ZenPOS for ${lic.shop} is paid until ${until}`,
      `Your ZenPOS subscription for ${lic.shop} is paid until ${until}, which is ${when}.`,
      `To keep selling without a break, please renew it for another year (${price(lic.price, lic.currency)}). Renewing early adds the new year after the current one.`];
  const hello = `Hi ${lic.owner || lic.shop},`;
  const text = [hello, '', ...lines, '', `Renew online or by bank transfer at ${link}`, '', 'Thank you,', 'Zenatiq Solutions'].join('\n');
  return { to, subject, text, html: zenposHtml(hello, lines, link) };
}

// The receipt after a ZenPOS year is paid.
export function zenposReceiptEmail({ lic, to, payment }) {
  const hello = `Hi ${lic.owner || lic.shop},`;
  const lines = [
    `Thank you! We've received your payment of ${price(payment.amount, payment.currency)}.`,
    `ZenPOS for ${lic.shop} (licence ${lic.licence_id}) is now paid until ${longDate(payment.to_paid_until)}.`,
    `If ZenPOS still shows the old date, open Subscription and press "Check with Zenatiq now".`,
    ...(payment.reference ? [`Payment reference: ${payment.reference}`] : []),
  ];
  const text = [hello, '', ...lines, '', 'Zenatiq Solutions'].join('\n');
  return { to, subject: `Renewed: ZenPOS for ${lic.shop} is paid until ${longDate(payment.to_paid_until)}`, text, html: zenposHtml(hello, lines, null) };
}

// The daily list for the team: ZenPOS shops that are due, in their renewal days, or read-only.
export function zenposDigestEmail({ to, rows, day }) {
  const say = { ending: 'ends in', grace: 'renewal due, ended', expired: 'read-only, ended' };
  const line = (r) => `${r.shop} (${r.licence_id}, ${r.phone}): ${r.state === 'ending'
    ? `${say.ending} ${r.days_left} day${r.days_left === 1 ? '' : 's'}` : `${say[r.state]} ${-r.days_left} day${r.days_left === -1 ? '' : 's'} ago`}`;
  const lines = rows.map(line);
  const subject = `ZenPOS: ${rows.length} shop${rows.length === 1 ? '' : 's'} to follow up (${longDate(day)})`;
  const text = ['ZenPOS shops due to renew, in their renewal days, or read-only:', '', ...lines.map((l) => `- ${l}`), '', `Open the Key Maker: ${PORTAL}#/zenpos`].join('\n');
  const html = `<div style="font-family:Arial,sans-serif;font-size:15px;line-height:1.6;color:#1a1a1f;max-width:560px">
<p>ZenPOS shops due to renew, in their renewal days, or read-only:</p>
<ul>${lines.map((l) => `<li>${esc(l)}</li>`).join('')}</ul>
<p><a href="${PORTAL}#/zenpos">Open the Key Maker</a></p>
</div>`;
  return { to, subject, text, html };
}
