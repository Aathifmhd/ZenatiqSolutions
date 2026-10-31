# Zenatiq admin portal: setup

The portal lives at **https://www.zenatiqsolutions.com/admin**. It has:

- **Projects** with their live site, admin panel and repository links, stage, dates and team
- **Task boards** (To do, In progress, Review, Done) for every project
- **Contact with Zenatiq**: an inbox for messages clients send from their own websites
- **Clients**, **Team** (Google sign-in), **Payments** (owners and admins only) and an **Activity** log that can't be edited

Data and sign-in run on Supabase (free plan). The website itself stays on Vercel.

---

## 1. Create the Supabase project (about 5 minutes)

1. Go to [supabase.com](https://supabase.com), sign up and click **New project**.
   - Name: `zenatiq-portal`
   - Region: **South Asia (Mumbai)**, the closest to Sri Lanka
   - Save the database password somewhere safe. The portal doesn't need it.
2. Open **SQL Editor → New query** and paste all of [`supabase/schema.sql`](supabase/schema.sql).
3. Scroll to section 9 at the bottom and change `change-me@gmail.com` to the **Google account you'll sign in with**. That account becomes the owner.
4. Click **Run**. You should see "Success. No rows returned".

The script can be run again later (for example after an update). It never deletes your data.

## 2. Turn on Google sign-in (about 10 minutes)

1. In Supabase, open **Authentication → Sign In / Providers → Google** and copy the **Callback URL**
   (it looks like `https://abcdefgh.supabase.co/auth/v1/callback`).
2. In the [Google Cloud Console](https://console.cloud.google.com):
   1. Create a project (for example "Zenatiq Portal").
   2. **APIs & Services → OAuth consent screen**: choose **External**, app name "Zenatiq Admin", your email as support email. Add `zenatiqsolutions.com` as an authorised domain. When it's saved, click **Publish app** so anyone you add to the team can sign in. (Email and profile access doesn't need Google's review.)
   3. **APIs & Services → Credentials → Create credentials → OAuth client ID → Web application**. Under **Authorised redirect URIs**, paste the Callback URL from step 1. Create it, then copy the **Client ID** and **Client secret**.
3. Back in Supabase, on the Google provider page: turn it on, paste the Client ID and secret, and save.
4. **Authentication → URL Configuration**:
   - Site URL: `https://www.zenatiqsolutions.com/admin`
   - Redirect URLs: add `https://www.zenatiqsolutions.com/admin` and `http://localhost:5000/admin`
5. Recommended: **Authentication → Sign In / Providers → Email**, turn the Email provider off, so Google is the only way in.

## 3. Connect the website

1. In Supabase, open **Project Settings → API** and copy the **Project URL** and the **anon public** key.
2. Paste them into [`public/connect/config.js`](public/connect/config.js):

   ```js
   window.ZENATIQ_CONFIG = {
     supabaseUrl: 'https://abcdefgh.supabase.co',
     supabaseAnonKey: 'eyJhbGciOi...',
   };
   ```

   Both values are meant to be public. The database's access rules protect your data.
   **Never put the `service_role` key here.**
3. Commit and push. Vercel deploys it automatically.
4. In Cloudflare, open zenatiqsolutions.com, go to **Caching → Configuration → Browser Cache TTL** and choose
   **Respect Existing Headers**. Cloudflare's default tells browsers to keep scripts and styles for 4 hours,
   so updates to the portal and the website can take that long to reach anyone who visited recently.
   Vercel's own settings already make browsers check for a newer copy each time.

## 4. Sign in and add your team

1. Open https://www.zenatiqsolutions.com/admin and choose **Continue with Google**.
2. Go to **Team → Add a team member** and enter each person's **Google email**, name and role.
   They can sign in straight away. **Remove access** locks someone out immediately.

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

New client messages show a red badge and a pop-up in the portal. Turn on **Desktop alerts** in the sidebar to get a notification even when the portal tab is in the background.

## Try it without Supabase

```bash
firebase serve --only hosting --port 5000
```

Then open http://localhost:5000/admin?demo. It runs with sample data stored only in your browser. Demo mode only works on localhost.

## Good to know

- **Free plan pause:** Supabase pauses a free project after a week with no activity. Daily use keeps it awake. Upgrade when you depend on it.
- **Backups:** the free plan doesn't include downloadable backups. Supabase's paid plans do.
- **Activity log:** it's written by the database itself, so it can't be edited or deleted from the portal.
- **Tests:** the access rules in `schema.sql` were tested with 42 checks (team-only access, money hidden from members, one client can't read another's messages, rate limits).
