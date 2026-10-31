// Runs the whole site on your computer: the pages in frontend/ and the API, on one port.
//   npm run dev    restarts by itself when files in backend/ change
//   npm run demo   the same, but always with sample data
// Settings come from .env.local or .env in the project folder, when there is one. Without
// MONGODB_URI it runs the demo: sample data in memory, fresh each time the server starts.
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createApp } from './app.js';
import { createDemo } from './demo.js';

const root = fileURLToPath(new URL('..', import.meta.url));
for (const file of ['.env.local', '.env']) {
  if (existsSync(root + file)) process.loadEnvFile(root + file);
}

const demo = process.argv.includes('--demo') || !process.env.MONGODB_URI?.trim() ? await createDemo() : null;
const port = Number(process.env.PORT) || 3000;

// Only this computer can reach it (the demo's sign-in button has no password).
createApp({ demo, pages: root + 'frontend' }).listen(port, 'localhost', (err) => {
  if (err?.code === 'EADDRINUSE') {
    console.error(`Port ${port} is already in use by another program. Close it, or put PORT=${port + 1} in .env to use another port.`);
    process.exit(1);
  }
  if (err) throw err;
  console.log(`Zenatiq is running at http://localhost:${port}`);
  console.log(demo
    ? `Demo mode: sample data in memory. Sign in as ${demo.signIn.email} with the password ${demo.signIn.password}.`
    : 'Using the MongoDB database in MONGODB_URI.');
});
