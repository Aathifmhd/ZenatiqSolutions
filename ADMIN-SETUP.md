# Zenatiq admin portal: setup

The portal lives at **https://www.zenatiqsolutions.com/admin**. It has:

- **Projects** with their live site, admin panel and repository links, stage, dates and team
- **Task boards** (To do, In progress, Review, Done) for every project
- **Contact with Zenatiq**: an inbox for messages clients send from their own websites
- **Clients**, **Team** (Google sign-in), **Payments** (owners and admins only) and an **Activity** log that can't be edited

Data is stored in **MongoDB Atlas** (free plan). The website and the portal's API (the files in `api/`) run on Vercel, next to each other.

---

## 1. Create the MongoDB database (about 10 minutes)

1. Sign up at [mongodb.com/atlas](https://www.mongodb.com/atlas) and create a project, for example "Zenatiq".
2. Create a cluster:
   - Plan: **Free (M0)**
   - Provider and region: **AWS, Mumbai (ap-south-1)**. That's the closest to Sri Lanka, and the portal's API runs in Mumbai too (`regions` in `vercel.json`).
3. **Security → Database Access → Add new database user**:
   - Username: `zenatiq-portal`
   - Password: click **Autogenerate secure password** and copy it
   - Role: **Read and write to any database**
4. **Security → Network Access → Add IP address → Allow access from anywhere** (`0.0.0.0/0`).
   Vercel's servers don't have fixed addresses, so the username and password protect the database.
5. **Clusters → Connect → Drivers**. Copy the connection string and put the password from step 3 in place of `<db_password>`:

   ```
   mongodb+srv://zenatiq-portal:YOUR_PASSWORD@zenatiq.abcde.mongodb.net/?retryWrites=true&w=majority&appName=zenatiq
   ```

The portal creates its collections and indexes on its own the first time it runs. There's nothing to import.

## 2. Make a Google sign-in client (about 5 minutes)

1. In the [Google Cloud Console](https://console.cloud.google.com), create a project, for example "Zenatiq Portal".
2. Open **Google Auth Platform** (APIs & Services → OAuth consent screen):
   - **Branding**: app name "Zenatiq Admin", your email as the support email, and `zenatiqsolutions.com` as an authorised domain.
   - **Audience**: choose **External**, then **Publish app**, so everyone you add to the team can sign in. Email and profile sign-in doesn't need Google's review.
3. **Clients → Create client → Web application**. Under **Authorised JavaScript origins**, add:
   - `https://www.zenatiqsolutions.com`
   - `https://zenatiq-solutions.vercel.app`
   - `http://localhost` and `http://localhost:3000` (only for running the API on your computer)

   No redirect URIs are needed. Create it and copy the **Client ID** (it ends in `.apps.googleusercontent.com`). It isn't a secret, and there's no client secret to keep.

## 3. Add the settings in Vercel

In Vercel, open the project, then **Settings → Environment Variables**. Add these for **Production**:

| Name | Value |
|---|---|
| `MONGODB_URI` | The connection string from step 1 |
| `GOOGLE_CLIENT_ID` | The Client ID from step 2 |
| `OWNER_EMAIL` | Your Google email. The first time you sign in with it, you become the owner. |
| `MONGODB_DB` | Optional. The database name, `zenatiq` if left out. |

Then go to **Deployments**, open the latest one, choose **⋯ → Redeploy**. New settings only reach new deployments.

Keep `MONGODB_URI` out of the code and out of chat: it holds the database password. If it ever leaks, change the user's password in Atlas (Database Access → Edit), then update the setting in Vercel and redeploy.

## 4. Sign in and add your team

1. Open https://www.zenatiqsolutions.com/admin and choose **Continue with Google** with your `OWNER_EMAIL` account.
2. Go to **Team → Add a team member** and enter each person's **Google email**, name and role.
   They can sign in straight away. **Remove access** signs them out everywhere at once.

`OWNER_EMAIL` only creates an owner while the team has no active owner, so changing it later does nothing on its own.

| | Owner | Admin | Member |
|---|:-:|:-:|:-:|
| Projects, tasks, clients, client messages | ✓ | ✓ | ✓ |
| See quotes and payments | ✓ | ✓ | |
| Add, edit or remove team members | ✓ | ✓ | |
| Delete projects and clients | ✓ | ✓ | |
| Make someone an owner | ✓ | | |

## 5. Connect a client's website ("Contact with Zenatiq")

1. Open the project, then the **Widget** tab.
2. Copy one of the three options into the **client's admin panel** (not their public site):
   - **Floating button** (recommended): paste the script tag before `</body>`.
     For React admin panels, put it in `index.html`.
   - **Inside a page**: for example a "Support" page in their admin panel.
   - **A link**: for systems where you can't add code (for example the Odoo POS at Regal Hardware). Add it as a menu item or bookmark.
3. Use **Open the client view** on the same tab to send yourself a test message.

Each project has its own secret key. A key only reaches that project's conversations, and each project is limited to 30 client messages an hour. If a key ends up somewhere public, click **Make a new key** and paste the new code.

New client messages show a red badge and a pop-up in the portal within about 12 seconds (about a minute when the tab is in the background). Turn on **Desktop alerts** in the sidebar to get a notification when the portal isn't the tab you're looking at.

## 6. Cloudflare (once)

In Cloudflare, open zenatiqsolutions.com, go to **Caching → Configuration → Browser Cache TTL** and choose **Respect Existing Headers**. Cloudflare's default tells browsers to keep scripts and styles for 4 hours, so updates to the portal and the website can take that long to reach anyone who visited recently. Vercel's own settings already make browsers check for a newer copy each time.

## Try it on your computer

**With sample data (no database):**

```bash
firebase serve --only hosting --port 5000
```

Then open http://localhost:5000/admin?demo. The portal's real rules run in your browser with sample data stored only there. Demo mode only works on localhost.

**With the real API**, after `npm install`: link the project and download the settings once with `npx vercel link` and `npx vercel env pull .env.local`, then run `npx vercel dev` and open http://localhost:3000/admin. The `.env*` files stay off GitHub.

## Good to know

- **How it fits together:** `public/` is the website and portal. `api/auth.js` handles sign-in, `api/portal.js` runs the portal's operations, and `api/connect.js` serves the widget. Every rule about who may do what is in `public/admin/js/core/ops.js`, which both the server and demo mode use.
- **Sign-in:** Google signs you in, the server checks the token and keeps a 30-day session in a secure cookie. The database stores only a fingerprint (hash) of each session.
- **Free Atlas plan:** 512 MB of storage, which is years of messages and tasks for a team your size. It has no automatic backups. To keep a copy, export the collections with [MongoDB Compass](https://www.mongodb.com/products/tools/compass), or move to a paid tier with backups.
- **Activity log:** only the server writes it, and the portal has no way to edit or delete it.
- **Vercel plan:** the free Hobby plan allows these three API functions, but it's meant for non-commercial use. A business site should be on Pro.
