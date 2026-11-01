# Zenatiq admin portal: setup

The portal lives at **https://www.zenatiqsolutions.com/admin**. It has:

- **Projects** with their live site, admin panel and repository links, stage, dates and team
- **Task boards** (To do, In progress, Review, Done) for every project
- **Contact with Zenatiq**: an inbox for messages clients send from their own websites
- **Clients**, **Team** (sign-in with email and password), **Payments** (owners and admins only) and an **Activity** log that can't be edited
- Each project's **Activity** tab also lists every commit in its GitHub repository
- **Renewals** for yearly packages: reminder emails to clients, a renewal page where they pay online or by bank transfer, and licences that make client systems read-only once a subscription runs out

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
| `GITHUB_TOKEN` | Recommended. Lets the Activity tabs read your GitHub repositories (see [GitHub commits](#github-commits-in-the-activity-tab)). |
| `CRON_SECRET` | Needed for automatic renewal reminders. Any long random text (see [Yearly subscriptions](#yearly-subscriptions-and-renewals)). |
| `MAIL_REPLY_TO` | Optional. An inbox you read, such as `hello@zenatiqsolutions.com`. Clients' replies to reminder emails go there. |
| `LICENSE_PRIVATE_KEY` | Needed for licences. Copy it from your `.env` (see [Licences](#licences-for-client-systems)). |
| `PAYHERE_MERCHANT_ID` | For online renewal payments (see [PayHere](#online-payments-with-payhere)). |
| `PAYHERE_MERCHANT_SECRET` | The PayHere Merchant Secret that goes with it. |
| `PAYHERE_SANDBOX` | `1` while you test with PayHere's sandbox. Delete it to take real payments. |
| `MONGODB_DB` | Optional. The database name. `zenatiq` if left out. |

Then go to **Deployments**, open the latest one and choose **⋯ → Redeploy**. New settings only reach new deployments. If you added `GOOGLE_CLIENT_ID` or `OWNER_EMAIL` earlier, delete them: the portal doesn't use them any more.

`MONGODB_URI` holds the database password and `RESEND_API_KEY` can send email as you, so keep both out of the code and out of chat. The same goes for `LICENSE_PRIVATE_KEY` and `PAYHERE_MERCHANT_SECRET`. If one leaks, replace it: in Atlas change the user's password (Database Access → Edit), and in Resend delete the key and make a new one. Then update the setting in Vercel and redeploy.

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

**Or let an AI assistant do it all.** At the top of the **Widget** tab, **Copy the prompt** and paste it into Claude Code (or another AI coding assistant) working in the client system's code. It adds the [licence check](#licences-for-client-systems), the renewal banner, and a **Contact Zenatiq** section, last in the system's menu, with the subscription details and the messages with Zenatiq, as in GMS Hardware's system. The project's key and details are filled in, so paste it only into tools you trust. Then set `ZENATIQ_KEY` on the system's host.

Each project has its own secret key. A key only reaches that project's conversations, and each project is limited to 30 client messages an hour. If a key ends up somewhere public, click **Make a new key** and paste the new code. The same key is the system's licence key, so update `ZENATIQ_KEY` too (see [Licences](#licences-for-client-systems)).

For a project with a yearly subscription, the widget also has a **Subscription** tab with the package, the "paid until" date and a **Renew now** button. When renewal is due within 30 days or overdue, the floating button shows a banner across the top of the page, which clients can hide for the day. To never show the banner, add `data-banner="off"` to the script tag.

New client messages show a red badge and a pop-up in the portal within about 12 seconds (about a minute when the tab is in the background). Turn on **Desktop alerts** in the sidebar to get a notification when the portal isn't the tab you're looking at.

## Yearly subscriptions and renewals

**Set one up** for a client who pays every year to keep using a system, such as a POS package:
- **A new project:** under **How does the client pay?**, choose **Yearly subscription**, then enter the package name and the yearly price. The first year starts on the project's start date, or today.
- **An existing project:** open its **Payments** tab and choose **Set up a yearly subscription**. There you can also set the "paid until" date (the last day that's paid for), the grace days, and a reminder email if the client's own email shouldn't get them.

Projects with a subscription have a **Yearly** label on the Projects page. On the website, the pricing page explains one-time purchases and yearly packages, and says each quote shows the first-year and yearly renewal prices. The terms clients agree to are at https://www.zenatiqsolutions.com/terms: no refund once a paid year has started, 14 grace days, then read-only, and their data kept for 90 days after that.

**Track them on the Renewals page** (owners and admins only). Every subscription has a status:

| Status | Meaning |
|---|---|
| **Active** | Paid for more than 30 days ahead. |
| **Ending soon** | 30 days or less to go. |
| **In grace period** | Ended, but still within its grace days (14 by default) to renew. |
| **Expired** | The grace days have run out. Systems with the [licence check](#licences-for-client-systems) are now read-only. |
| **Cancelled** | The client isn't renewing, so no more reminders go out. |

The dashboard shows how many are due in the next 30 days.

**Clients renew on their own renewal page.** Each subscription has a secret link to it. The reminder emails and the client's widget link there, and **Copy renewal link** on the project's Payments tab copies it, for example for WhatsApp. On the page, the client chooses 1, 2 or 3 years, then pays:
- **online**, through PayHere (see [Online payments](#online-payments-with-payhere)). The renewal is recorded by itself as soon as PayHere confirms the payment, and the client gets a receipt by email.
- **by bank transfer**, using the bank details you enter under **Renewal page** on the Renewals page. Clients send the slip on WhatsApp, and you record the renewal when the money arrives.

To see what a client sees, use **Preview a client's page** on the Renewals page.

**When a client pays any other way, choose Record renewal.**
- It records the payment, tagged as a renewal, and moves "paid until" on by the years paid for.
- Paid within the grace days, the new year carries on from the old date, so the client loses nothing. Paid later, it starts on the payment day.
- Renewal payments count towards "Received" on the Payments page, but not towards a project's build balance.

**Reminder emails to the client** go out automatically every morning at 8:00 Sri Lanka time:
- 30, 14, 7 and 1 days before the "paid until" date;
- the day after it ends;
- when the grace days run out.

Each reminder goes once. Nobody gets an email about a subscription that ran out long ago. To send one by hand, use **Email a reminder now** on the project's Payments tab.

To turn the automatic reminders on:
1. In Vercel, add `CRON_SECRET` with any long random text, then redeploy. Vercel's daily job (`crons` in `vercel.json`) sends it, so nobody else can trigger the reminders.
2. Optionally, add `MAIL_REPLY_TO`, an inbox you read, so clients can reply to reminders. They always include your WhatsApp number.

The Renewals page shows when the reminders last went out. **Send today's reminders now** runs the same job straight away.

## Online payments with PayHere

Clients can pay renewals by card or mobile wallet through [PayHere](https://www.payhere.lk). Until it's set up, the renewal page offers bank transfer only.

1. **Test first.** Sign up at [sandbox.payhere.lk](https://sandbox.payhere.lk). Under **Settings → Domains & Credentials**, add `zenatiqsolutions.com`, then copy the **Merchant ID** and the **Merchant Secret** for it.
2. In Vercel, add `PAYHERE_MERCHANT_ID`, `PAYHERE_MERCHANT_SECRET` and `PAYHERE_SANDBOX` (set to `1`), then redeploy. The Renewals page now says online payments are on, in test mode.
3. Make a test project with a yearly subscription, so no real client gets an email. On its Payments tab, choose **Copy renewal link** and open the link. Pay with one of PayHere's test cards, with your own email for the receipt. Check that "paid until" moves on and the receipt arrives; no real money is taken. Then delete the test project, which removes its payments too.
4. **Go live.** Sign up at [payhere.lk](https://www.payhere.lk) with your business details. PayHere looks at your website before approving you: it wants to see prices, terms with a refund rule, a privacy policy and contact details, which the site now has. Once you're approved, add `zenatiqsolutions.com` under **Settings → Domains & Credentials** and wait for that to be approved too.
5. In Vercel, replace `PAYHERE_MERCHANT_ID` and `PAYHERE_MERCHANT_SECRET` with the live ones, delete `PAYHERE_SANDBOX`, and redeploy.

How it works: the renewal page sends the client to PayHere's checkout with the order signed by your Merchant Secret, so nobody can change the amount. PayHere then tells the site about the payment at `/api/payhere/notify`. The site checks PayHere's signature and the amount, then records the renewal once, even if PayHere sends the same notice twice. If PayHere later reverses a payment, the order is marked and the server log says so, but the renewal stays until you decide. PayHere can only reach the live site, so on your computer a test payment is never confirmed.

## Licences for client systems

The licence check stops a system from being used for free once its subscription runs out. Each system asks this site, once a day, whether its subscription is paid. The answer is signed with Zenatiq's private key, so nobody can fake or edit it.

**What the client sees:**
- **Ending soon, and during the grace days:** a banner asking them to renew, with a link to their renewal page.
- **After the grace days:** the system becomes **read-only**. Staff can still sign in, look things up and export their data, but they can't add or change anything. After they renew, it switches back on by itself, the next time someone tries to make a change.
- **Without internet:** the system keeps working from the last licence it saved, and still goes read-only on time. After 7 days without a check, the banner asks them to connect. Turning the computer's clock back doesn't help.
- **One-time purchases** have no subscription, so they never go read-only.

**Turn licences on.** The key pair already exists: `LICENSE_PRIVATE_KEY` is in your `.env`, and its public key is built into the module. Copy `LICENSE_PRIVATE_KEY` from `.env` into Vercel, then redeploy. The Renewals page then says licences are on.

Anyone with `LICENSE_PRIVATE_KEY` could make a licence for any system, so guard it like a password. If it leaks:
1. Delete it from `.env` and run `npm run license-key` to make a new pair.
2. Put the new public key it prints into `ZENATIQ_PUBLIC_KEY` in `frontend/license/zenatiq-license.mjs`.
3. Update Vercel and the module in every client system.

**Add the check to a system.** The quickest way is the prompt at the top of the project's **Widget** tab (see [Connect a client's website](#5-connect-a-clients-website-contact-with-zenatiq)). By hand: it needs a Node.js 18 server, such as an Express API. Everything below is also on the project's **Widget** tab, under **Licence check**, with the project's own key filled in and a **Copy** button for each part.

On Vercel, or any host that pauses the server between requests, leave out `file` and the `await license.start()` line. The guard then checks with the first request, and again when a check is due. A check started while Vercel loads the server can be frozen until it times out, which GMS Hardware ran into.
1. Copy `frontend/license/zenatiq-license.mjs` into the system's server code. It's also at https://www.zenatiqsolutions.com/license/zenatiq-license.mjs.
2. On the system's server, set `ZENATIQ_KEY` to the project's key, which the **Licence check** section shows.
3. In the server:

   ```js
   import { createLicense } from './zenatiq-license.mjs';

   const license = createLicense({ key: process.env.ZENATIQ_KEY, file: '.zenatiq-license.json' });
   await license.start();                                                     // checks now, then once a day
   app.use(license.readOnlyGuard({ allow: ['/api/login', '/api/logout'] }));  // refuses changes while read-only
   app.get('/api/license', (req, res) => res.json(license.state()));           // for the admin panel's banner
   ```

4. In the admin panel, show `message` from `/api/license` as a banner whenever it isn't empty, with a **Renew** link to `renewUrl`. A refused change comes back as `402`, with `error.code` set to `read_only`: show its `error.message`.

Systems that don't run Node.js can make the same check in any language. `POST https://www.zenatiqsolutions.com/api/license` with `{ "key": "..." }` returns the licence, signed with Ed25519, and `/api/license/key` gives the public key to check it with.

## GitHub commits in the Activity tab

Open a project, then **Activity → GitHub commits**. You'll see every commit in the project's repository, newest first and grouped by day. Each one shows its message, author, time and a link to it on GitHub. Pick another branch at the top right, and use **Show older commits** to go back to the very first commit.

To set it up, give the project its repository address: **Edit → Code repository**, for example `https://github.com/Aathifmhd/ZenatiqSolutions`.

Then make a read-only GitHub token, so the portal can read private repositories. Without one, GitHub only allows 60 requests an hour, and on Vercel that limit is shared with other websites.

1. On GitHub, open **Settings → Developer settings → Personal access tokens → Fine-grained tokens → Generate new token**.
2. Name it "Zenatiq portal" and choose an expiry date. Set yourself a reminder to renew it before then.
3. **Resource owner**: your account, or the organization that owns the repositories.
4. **Repository access**: **All repositories**, or only the ones the portal should show.
5. **Permissions → Repository permissions → Contents: Read-only**. GitHub adds **Metadata: Read-only** by itself.
6. Generate the token and copy it. It starts with `github_pat_`.
7. Add it in Vercel as `GITHUB_TOKEN`, and in your `.env` for `npm run dev`. Then redeploy.

One fine-grained token only covers one owner. If your repositories belong to several accounts or organizations, make a classic token with the `repo` scope instead. It can read them all, but it can also change them, so keep it extra safe.

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
  - `routes/renew.js` runs the renewal page, and `routes/payhere.js` takes PayHere's payment notices.
  - `routes/license.js` gives client systems their licences, which `license.js` signs.
  - `routes/cron.js` is the daily reminder job.
  - Every rule about who may do what is in `backend/core/ops.js`.
  - `member.js` is `npm run member`.

  On Vercel the whole API runs as one function, `api/index.js`.
- **Passwords:** they're stored only as salted scrypt hashes, in their own collection, never with the team list. After 10 wrong passwords for one email, that email waits 15 minutes before it can try again.
- **Sessions:** a session lasts 30 days in a secure cookie. The database keeps only a fingerprint (hash) of each one. Changing your password signs out your other devices.
- **Free Atlas plan:** 512 MB of storage, which is years of messages and tasks for a team your size. It has no automatic backups. To keep a copy, export the collections with [MongoDB Compass](https://www.mongodb.com/products/tools/compass), or move to a paid tier with backups.
- **Activity log:** only the server writes it, and the portal has no way to edit or delete it.
- **Vercel plan:** the whole API is a single function, well within the free Hobby plan. Hobby is meant for non-commercial use, though, so a business site should be on Pro.
