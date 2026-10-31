// Adds someone to the portal, or sends them a new temporary password, from your own computer.
// It reads MONGODB_URI and RESEND_API_KEY from .env and needs nobody to be signed in, which makes
// it the way the first owners get in. Everyone after that can be added on the Team page.
//
//   npm run member -- add <email> "<full name>" [owner|admin|member] ["<job title>"]
//   npm run member -- password <email>
//
// The email with the temporary password goes out through Resend. Without RESEND_API_KEY, add
// --print to show that email here instead.
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { database, storeFor } from './db.js';
import { createPortal, SYSTEM } from './core/ops.js';
import { createMailer } from './mail.js';

const root = fileURLToPath(new URL('..', import.meta.url));
for (const file of ['.env.local', '.env']) {
  if (existsSync(root + file)) process.loadEnvFile(root + file);
}

const args = process.argv.slice(2);
const print = args.includes('--print');
const [command, email, fullName, role = 'member', jobTitle] = args.filter((a) => a !== '--print');
const stop = (message) => {
  console.error(message);
  process.exit(1);
};

if (!(command === 'add' && email && fullName) && !(command === 'password' && email)) {
  stop('Usage:\n  npm run member -- add <email> "<full name>" [owner|admin|member] ["<job title>"]\n  npm run member -- password <email>');
}
if (!process.env.MONGODB_URI?.trim()) stop('Put MONGODB_URI in .env first.');
if (!process.env.RESEND_API_KEY?.trim() && !print) {
  stop("RESEND_API_KEY isn't in .env, so no email can be sent. Add it, or run this again with --print to see the email here.");
}

const db = await database();
try {
  const store = storeFor(db);
  const portal = createPortal(store, { mailer: createMailer() });
  let member;
  let result;
  if (command === 'add') {
    member = await portal.run(SYSTEM, 'team.add', { row: { email, full_name: fullName, role, job_title: jobTitle } });
    console.log(`Added ${member.full_name} (${member.email}) as ${member.role}.`);
    result = member.invite;
  } else {
    member = await store.col('team_members').findOne({ email: email.trim().toLowerCase() });
    if (!member) stop(`${email} isn't on the team. Add them with: npm run member -- add ${email} "<full name>"`);
    result = await portal.run(SYSTEM, 'team.sendPassword', { id: member.id });
  }
  if (result.problem) stop(`No password was sent. ${result.problem}`);
  console.log(result.emailed
    ? `Emailed ${member.email} their username and a temporary password.`
    : 'Email is not set up, so the email is printed above instead of sent.');
} catch (err) {
  process.exitCode = 1;
  console.error(err.message);
} finally {
  await db.client.close();
}
