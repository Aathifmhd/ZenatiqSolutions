// Password hashing and rules, temporary passwords, and the email that carries them through Resend.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hashPassword, verifyPassword, temporaryPassword, passwordProblem } from '../passwords.js';
import { createMailer, passwordEmail } from '../mail.js';

async function withEnv(values, fn) {
  const saved = Object.fromEntries(Object.keys(values).map((name) => [name, process.env[name]]));
  const apply = (vals) => Object.entries(vals).forEach(([k, v]) => (v === undefined ? delete process.env[k] : (process.env[k] = v)));
  apply(values);
  try { return await fn(); } finally { apply(saved); }
}
// Answers fetch calls with `answer` and records them, for the length of fn.
async function withFetch(answer, fn) {
  const calls = [];
  const real = globalThis.fetch;
  globalThis.fetch = async (url, init) => { calls.push({ url, init }); return answer(); };
  try { await fn(calls); } finally { globalThis.fetch = real; }
}

test('hashes are salted and check out', async () => {
  const [a, b] = [await hashPassword('correct horse'), await hashPassword('correct horse')];
  assert.notEqual(a, b, 'each hash gets its own salt');
  assert.equal(await verifyPassword('correct horse', a), true);
  assert.equal(await verifyPassword('correct horsE', a), false);
  assert.equal(await verifyPassword('correct horse', undefined), false, 'no stored hash never matches');
  assert.equal(await verifyPassword({ $ne: null }, a), false);
});
test('temporary passwords: 12 characters that are easy to read, different each time', () => {
  const seen = new Set(Array.from({ length: 200 }, temporaryPassword));
  assert.equal(seen.size, 200);
  for (const p of seen) assert.match(p, /^[A-HJ-NP-Za-km-z2-9]{4}-[A-HJ-NP-Za-km-z2-9]{4}-[A-HJ-NP-Za-km-z2-9]{4}$/);
});
test('password rules', () => {
  assert.match(passwordProblem('short'), /at least 10/);
  assert.match(passwordProblem('x'.repeat(201)), /too long/);
  assert.match(passwordProblem('same-as-before', { old: 'same-as-before' }), /different/);
  assert.match(passwordProblem('Me@Example.com', { email: 'me@example.com' }), /email/);
  assert.equal(passwordProblem('a good long password'), null);
});

test('the email has the username, temporary password and link, with names made safe', () => {
  const email = passwordEmail({ member: { full_name: '<b>Ann</b>', email: 'ann@example.com' }, password: 'Abcd-Efgh-2345', by: 'Owner Person', welcome: true });
  assert.equal(email.to, 'ann@example.com');
  assert.equal(email.subject, 'Your Zenatiq admin portal account');
  assert.match(email.text, /Owner Person added you/);
  assert.match(email.text, /Username: ann@example\.com\nTemporary password: Abcd-Efgh-2345/);
  assert.match(email.text, /https:\/\/www\.zenatiqsolutions\.com\/admin/);
  assert.ok(email.html.includes('&lt;b&gt;Ann&lt;/b&gt;') && !email.html.includes('<b>Ann</b>'), 'names are escaped in the HTML');
  const again = passwordEmail({ member: { full_name: 'Ann', email: 'ann@example.com' }, password: 'x', by: null, welcome: false });
  assert.equal(again.subject, 'Your new Zenatiq admin portal password');
});
test('emails go to Resend with the API key', () => withEnv({ RESEND_API_KEY: 're_test_123', MAIL_FROM: undefined }, () =>
  withFetch(() => Response.json({ id: 'email-1' }), async (calls) => {
    const result = await createMailer()({ to: 'ann@example.com', subject: 'Hi', text: 'Hello', html: '<p>Hello</p>' });
    assert.deepEqual(result, { sent: true });
    assert.equal(calls[0].url, 'https://api.resend.com/emails');
    assert.equal(calls[0].init.headers.Authorization, 'Bearer re_test_123');
    assert.deepEqual(JSON.parse(calls[0].init.body), {
      from: 'Zenatiq Solutions <portal@zenatiqsolutions.com>', to: ['ann@example.com'], subject: 'Hi', text: 'Hello', html: '<p>Hello</p>',
    });
  })));
test("MAIL_FROM changes the sender, and Resend's own error is passed on", () =>
  withEnv({ RESEND_API_KEY: 're_test_123', MAIL_FROM: 'Zenatiq <team@zenatiqsolutions.com>' }, () =>
    withFetch(() => Response.json({ name: 'validation_error', message: 'The zenatiqsolutions.com domain is not verified.' }, { status: 403 }), async (calls) => {
      await assert.rejects(createMailer()({ to: 'a@b.lk', subject: 's', text: 't', html: 'h' }), {
        code: 'email_failed', message: "The email couldn't be sent: The zenatiqsolutions.com domain is not verified.",
      });
      assert.equal(JSON.parse(calls[0].init.body).from, 'Zenatiq <team@zenatiqsolutions.com>');
    })));
test('without a key: printed on your own computer, refused on Vercel', () => withEnv({ RESEND_API_KEY: undefined }, async () => {
  const printed = [];
  const log = console.log;
  console.log = (line) => printed.push(line);
  try {
    assert.deepEqual(await createMailer()({ to: 'a@b.lk', subject: 'Subject', text: 'Temporary password: x' }), { sent: false });
  } finally {
    console.log = log;
  }
  assert.match(printed.join('\n'), /To: a@b\.lk[\s\S]*Temporary password: x/);
  await withEnv({ VERCEL: '1' }, () => assert.rejects(createMailer()({ to: 'a@b.lk', subject: 's', text: 't' }), { code: 'email_not_configured' }));
}));
