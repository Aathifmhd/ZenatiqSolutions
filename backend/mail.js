// Email from the portal, sent through Resend (resend.com) with RESEND_API_KEY. Without that key,
// emails are printed in the terminal when the site runs on your computer, and refused on Vercel.
import { HttpError } from './http.js';
import { TEMPORARY_DAYS } from './passwords.js';

const FROM = 'Zenatiq Solutions <portal@zenatiqsolutions.com>';
const PORTAL = 'https://www.zenatiqsolutions.com/admin';

// Returns a function that sends one email: { to, subject, text, html } -> { sent }.
// sent is false when the email was only printed.
export function createMailer() {
  return async function sendEmail({ to, subject, text, html }) {
    const key = process.env.RESEND_API_KEY?.trim();
    if (!key) {
      if (process.env.VERCEL) throw new HttpError("Email isn't set up yet. Add RESEND_API_KEY in Vercel, then redeploy.", 'email_not_configured', 503);
      console.log(`\n--- Email, not sent (RESEND_API_KEY isn't set) ---\nTo: ${to}\nSubject: ${subject}\n\n${text}\n---\n`);
      return { sent: false };
    }
    let res;
    try {
      res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: process.env.MAIL_FROM?.trim() || FROM, to: [to], subject, text, html }),
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
