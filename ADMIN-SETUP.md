# Zenatiq admin portal: setup

The portal lives at **https://www.zenatiqsolutions.com/admin**. It has:

- **Projects** with their live site, admin panel and repository links, stage, dates and team
- **Task boards** (To do, In progress, Review, Done) for every project
- **Contact with Zenatiq**: an inbox for messages clients send from their own websites
- **Clients**, **Team** (sign-in with email and password), **Payments** (owners and admins only) and an **Activity** log that can't be edited

Data is stored in **MongoDB Atlas** (free plan), and **Resend** sends the emails with each new person's username and temporary password. The website and portal (`frontend/`) and their API (`backend/`, one Express app) deploy together as a single Vercel project.

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

   If you chose your own password and it has any of `@ : / ? # [ ] %`, write those as `%40 %3A %2F %3F %23 %5B %5D %25`. Generated passwords don't have them.

The portal creates its collections and indexes on its own the first time it runs. There's nothing to import.

## 2. Set up email with Resend (about 10 minutes)

The portal emails each new person their username (their email address) and a temporary password. [Resend](https://resend.com) sends those emails. Its free plan covers 3,000 emails a month.

1. Sign up at [resend.com](https://resend.com).
2. **Domains → Add domain**, enter `zenatiqsolutions.com` and choose any region.
3. Resend shows a few DNS records. In Cloudflare, open zenatiqsolutions.com, then **DNS → Records**, and add each one exactly as shown.
4. Back in Resend, click **Verify DNS records** and wait until the domain shows **Verified**. That usually takes a few minutes.
5. **API Keys → Create API key**, with **Sending access** for `zenatiqsolutions.com` only. Copy the key. It starts with `re_`, and Resend shows it only once.

The emails come from `Zenatiq Solutions <portal@zenatiqsolutions.com>`. To send from another address on the same domain, set `MAIL_FROM` in step 3.

## 3. Add the settings in Vercel

In Vercel, open the project, then **Settings → Environment Variables**. Add these for **Production**:

| Name | Value |
|---|---|
| `MONGODB_URI` | The connection string from step 1 |
| `RESEND_API_KEY` | The API key from step 2 |
| `MAIL_FROM` | Optional. Who the emails come from. `Zenatiq Solutions <portal@zenatiqsolutions.com>` if left out. |
| `MONGODB_DB` | Optional. The database name. `zenatiq` if left out. |

Then go to **Deployments**, open the latest one and choose **⋯ → Redeploy**. New settings only reach new deployments. If you added `GOOGLE_CLIENT_ID` or `OWNER_EMAIL` earlier, delete them: the portal doesn't use them any more.

`MONGODB_URI` holds the database password and `RESEND_API_KEY` can send email as you, so keep both out of the code and out of chat. If one leaks, replace it: in Atlas change the user's password (Database Access → Edit), and in Resend delete the key and make a new one. Then update the setting in Vercel and redeploy.

## 4. Add the founders, then the team

The first owners are added from your computer, since nobody can sign in yet.

1. Put `MONGODB_URI` and `RESEND_API_KEY` in a file called `.env` in the project folder (see [Try it on your computer](#try-it-on-your-computer)).
2. Run this once for each founder, with their own email and name:

   ```bash
   npm run member -- add you@example.com "Your Name" owner "Founder"
   ```

   Each founder gets an email with their username and a temporary password.
3. Open https://www.zenatiqsolutions.com/admin and sign in with that email and the temporary password. Then choose your own password, at least 10 characters long. A temporary password stops working after 7 days.
4. Add everyone else on **Team → Add a team member**, with their email, name and role. They get the same email.

**Remove access** signs a person out everywhere at once.

**Forgotten password:** an owner or admin opens the person on the Team page and chooses **Send a new temporary password**. An owner's password can only be reset by another owner. You can also reset anyone's from your computer:

```bash
npm run member -- password you@example.com
```

| | Owner | Admin | Member |
|---|:-:|:-:|:-:|
| Projects, tasks, clients, client messages | ✓ | ✓ | ✓ |
| See quotes and payments | ✓ | ✓ | |
| Add, edit or remove team members, and send them new passwords | ✓ | ✓ | |
| Delete projects and clients | ✓ | ✓ | |
| Make someone an owner, or send an owner a new password | ✓ | | |

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

You need [Node.js](https://nodejs.org) 20.19 or newer. In the project folder, install the packages once:

```bash
npm install
```

Then start the website, portal and API together:

```bash
npm run dev
```

Open http://localhost:3000 for the website and http://localhost:3000/admin for the portal.

**Your settings** go in a file called `.env` in the project folder, one `NAME=value` per line, with the same names as in Vercel. You can also download them with `npx vercel link` and `npx vercel env pull .env.local`. Git ignores `.env` files, but they hold your passwords, so keep them to yourself.

**Without `MONGODB_URI`**, or with `npm run demo`, it runs a demo:
- **Sample data:** the data lives in memory and comes back fresh whenever the server restarts.
- **Sign-in:** the form is filled in with the sample owner. The sample admin and member use the same password, and the terminal shows it.
- **Emails:** without `RESEND_API_KEY`, emails are printed in the terminal instead of sent, temporary passwords included.
- **Test messages:** each project's **Widget** tab has a **Send a test client message** button.
- **Local only:** only your own computer can open it.

**If port 3000 is busy**, for example with another project's dev server, add `PORT=3001` to `.env`.

**To run the checks:** `npm test` checks every rule and API answer on sample data. With `TEST_MONGODB_URI` set to a connection string, it also runs the rules on MongoDB. It uses a database called `zenatiq_test` and empties it first.

## Good to know

- **How it fits together:** `frontend/` is everything the browser loads: the website, the portal's screens (`admin/`) and the widget (`connect/`). Vercel serves it as it is. `backend/` is the API, one Express app (`app.js`):
  - `routes/auth.js` handles sign-in and passwords.
  - `routes/portal.js` runs the portal's operations.
  - `routes/connect.js` serves the widget.
  - Every rule about who may do what is in `backend/core/ops.js`.
  - `member.js` is `npm run member`.

  On Vercel the whole API runs as one function, `api/index.js`.
- **Passwords:** they're stored only as salted scrypt hashes, in their own collection, never with the team list. After 10 wrong passwords for one email, that email waits 15 minutes before it can try again.
- **Sessions:** a session lasts 30 days in a secure cookie. The database keeps only a fingerprint (hash) of each one. Changing your password signs out your other devices.
- **Free Atlas plan:** 512 MB of storage, which is years of messages and tasks for a team your size. It has no automatic backups. To keep a copy, export the collections with [MongoDB Compass](https://www.mongodb.com/products/tools/compass), or move to a paid tier with backups.
- **Activity log:** only the server writes it, and the portal has no way to edit or delete it.
- **Vercel plan:** the whole API is a single function, well within the free Hobby plan. Hobby is meant for non-commercial use, though, so a business site should be on Pro.
