# Zenatiq Solutions website

This repository holds three things, deployed as one Vercel project at https://www.zenatiqsolutions.com:
- the public website
- the admin portal
- the Contact with Zenatiq widget

| Folder | What's in it |
|---|---|
| `frontend/` | Everything the browser loads: the website's pages, the admin portal (`admin/`) and the client widget (`connect/`). It's plain HTML, CSS and JavaScript with no build step. |
| `backend/` | The API, one Express app (`app.js`). It has routes for sign-in, the portal and the widget (`routes/`), every access rule (`core/ops.js`) and the MongoDB connection (`db.js`). |
| `api/index.js` | The single Vercel function that runs the Express app for every `/api/...` request. |

## Run it on your computer

```bash
npm install
```

```bash
npm run dev
```

Open http://localhost:3000. Without a database, or with `npm run demo`, the portal runs a demo with sample data. To use your real database, see [ADMIN-SETUP.md](ADMIN-SETUP.md#try-it-on-your-computer).

To add someone or send them a new password from your computer, use `npm run member` (details in [ADMIN-SETUP.md](ADMIN-SETUP.md#4-add-the-founders-then-the-team)).

```bash
npm test
```

## Deploy

Push to `main` and Vercel deploys it. [ADMIN-SETUP.md](ADMIN-SETUP.md) covers the full setup, including the two settings the live site needs: `MONGODB_URI` and `RESEND_API_KEY`.
