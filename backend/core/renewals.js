// Yearly subscriptions: dates, statuses and when renewal reminders are due. Dates are days such as
// "2027-10-31", in Sri Lanka time, and a subscription is paid up to and including its ends_on day.

export const ZONE = 'Asia/Colombo';
export const SOON_DAYS = 30;
export const REMIND_BEFORE = [30, 14, 7, 1];
export const SITE = 'https://www.zenatiqsolutions.com';

// The renewal page for a subscription, opened with its secret token (in reminder emails and the
// clients' widget).
export const renewUrl = (sub, site = SITE) => (sub?.renew_token ? `${site}/renew?t=${sub.renew_token}` : null);

// Today in Sri Lanka, as "YYYY-MM-DD".
export const today = (at = new Date()) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: ZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).format(at);

const toUTC = (day) => {
  const [y, m, d] = day.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
};
const fromUTC = (ms) => new Date(ms).toISOString().slice(0, 10);
export const addDays = (day, n) => fromUTC(toUTC(day) + n * 864e5);
// The same date n years later; 29 February becomes 28 February in other years.
export function addYears(day, n) {
  const [y, m, d] = day.split('-').map(Number);
  const daysInMonth = new Date(Date.UTC(y + n, m, 0)).getUTCDate();
  return fromUTC(Date.UTC(y + n, m - 1, Math.min(d, daysInMonth)));
}
export const daysBetween = (from, to) => Math.round((toUTC(to) - toUTC(from)) / 864e5);
// The last paid day of a period that starts on `starts` and lasts `years` years.
export const periodEnd = (starts, years = 1) => addDays(addYears(starts, years), -1);

// active, ending (within SOON_DAYS), grace (ended, but within its grace days), expired, or cancelled.
export function statusOf(sub, day = today()) {
  if (sub.cancelled) return 'cancelled';
  const left = daysBetween(day, sub.ends_on);
  if (left > SOON_DAYS) return 'active';
  if (left >= 0) return 'ending';
  return -left <= sub.grace_days ? 'grace' : 'expired';
}

// The reminder that's due on `day`, or null. Each goes once per paid-until date: 30, 14, 7 and 1
// days before it, the day after it ("ended"), and when the grace days run out ("expired"). A day
// the job didn't run is caught up the next time, but nobody gets a surprise email about a
// subscription that ran out more than a week ago.
export function dueReminder(sub, day = today()) {
  if (sub.cancelled) return null;
  const left = daysBetween(day, sub.ends_on);
  const stages = [...REMIND_BEFORE.map((d) => ({ stage: 'before', at: d })), { stage: 'ended', at: -1 }, { stage: 'expired', at: -(sub.grace_days + 1) }];
  let due = null;
  for (const s of stages) if (left <= s.at) due = s;
  if (!due || (due.stage === 'expired' && left < due.at - 7)) return null;
  const key = `${sub.ends_on}:${due.stage}:${due.at}`;
  return (sub.reminders || []).includes(key) ? null : { stage: due.stage, key, left };
}

// What the portal shows: the subscription with its status, days left and renewal link, without
// the reminder bookkeeping.
export function withStatus(sub, day = today()) {
  const { reminders, ...shown } = sub;
  return { ...shown, status: statusOf(sub, day), days_left: daysBetween(day, sub.ends_on), renew_url: renewUrl(sub) };
}

// The last day the client can still renew before the system turns read-only.
export const graceUntil = (sub) => addDays(sub.ends_on, sub.grace_days);
