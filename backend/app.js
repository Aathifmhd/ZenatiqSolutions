// The Zenatiq API as one Express app: sign-in (/api/auth), the admin portal's data (/api/portal)
// and the Contact with Zenatiq widget (/api/connect). On Vercel it runs as a single function
// (api/index.js) and Vercel serves the pages in frontend/ itself; backend/server.js runs both on
// your computer.
import { existsSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import express from 'express';
import { database, storeFor } from './db.js';
import { send } from './http.js';
import { createMailer } from './mail.js';
import { createGitHub } from './github.js';
import { authRoutes } from './routes/auth.js';
import { portalRoutes } from './routes/portal.js';
import { connectRoutes } from './routes/connect.js';
import { cronRoutes } from './routes/cron.js';

// The live site passes no options. The local server and the tests use:
//   demo:   sample data in memory, with sample accounts (backend/demo.js)
//   store:  a stand-in for MongoDB with the same methods (core/memory.js)
//   mailer: sends email (mail.js); the demo only prints it, and the tests keep it
//   github: reads commit histories (github.js); the tests use a stand-in
//   pages:  a folder of pages to serve as well, the way Vercel serves frontend/
export function createApp({
  demo = null, store = demo?.store ?? null, mailer = createMailer({ printOnly: Boolean(demo) }), github = createGitHub(), pages,
} = {}) {
  if (demo && process.env.VERCEL) throw new Error('The demo only runs on your own computer.');
  const api = {
    demo,
    mailer,
    github,
    // Settings still to add: only the database, which a supplied store stands in for.
    missing: () => (store || process.env.MONGODB_URI?.trim() ? [] : ['MONGODB_URI']),
    store: async () => store ?? storeFor(await database()),
  };

  const app = express();
  app.disable('x-powered-by');
  // Which deployment answered, so a portal left open can tell when a new version is out.
  const build = process.env.VERCEL_DEPLOYMENT_ID || process.env.VERCEL_GIT_COMMIT_SHA;
  if (build) app.use('/api', (req, res, next) => { res.setHeader('X-Portal-Build', build); next(); });
  app.use('/api/auth', authRoutes(api));
  app.use('/api/portal', portalRoutes(api));
  app.use('/api/connect', connectRoutes(api));
  app.use('/api/cron', cronRoutes(api));
  app.use('/api', (req, res) => send(res, 404, { error: { code: 'not_found', message: 'There is no API at this address.' } }));

  if (pages) {
    // Like Vercel's cleanUrls: /about shows about.html and /admin shows admin/index.html.
    const dir = resolve(pages);
    app.use(express.static(dir, { extensions: ['html'], redirect: false }));
    app.use((req, res, next) => {
      const file = join(dir, req.path, 'index.html');
      if (file.startsWith(dir + sep) && existsSync(file)) res.sendFile(file);
      else next();
    });
    app.use((req, res) => res.status(404).sendFile(join(dir, '404.html')));
  }
  return app;
}
