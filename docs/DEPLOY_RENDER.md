# Deploying to Render on a private subdomain (checklist — nothing here has been done)

Facts below come from Render's docs as shown in web-search results on 2026-10-10 (docs.render.com pages could not be opened directly). Re-check anything that costs money.

## What Render's docs say (per search results)
- Custom domain: add it under the service's **Custom Domains**, create a **CNAME** at your DNS provider pointing the subdomain at `<service>.onrender.com`, then click **Verify**. Remove any AAAA records for that name. TLS certificates are free and automatic; HTTP redirects to HTTPS.
- Custom domains are included per plan (Hobby workspace: 2); extra ones were listed at $0.25/month each.
- A persistent disk attaches to **one** instance only. You cannot scale out, and a redeploy stops the old instance before starting the new one (a few seconds of downtime). Disks can be resized up, not down.
- Render snapshots the disk every 24 hours and keeps each at least 7 days; restores are all-or-nothing. For databases Render advises logical backups instead of relying on snapshots, which is why this app has its own "Download full database backup".
- Web services only support custom domains.

## Suggested address
`crm.christinemikhailov.com` (your choice — tell me if you want a different name). Your main website at `www` is not touched: you add **one** new DNS record for `crm` only.

## Steps (you do these; I cannot access your accounts)
1. Create a Render account (https://render.com) and connect your GitHub account, allowing the `calypsoinsurance-web/claude-code` repository.
2. In Render: **New → Blueprint**, pick the repository and branch. It reads `render.yaml`. Review the plan/price shown before confirming.
3. When asked for values marked secret, enter:
   - `ADMIN_EMAIL` = calypsoinsurance@gmail.com
   - `ADMIN_PASSWORD_HASH` = a starting hash. Either use the one-time passphrase/hash pair given to you in chat, or make your own with `npm run hash-password -- "your long passphrase"` (never send your real passphrase to anyone). **Sign in once, then use Settings → Password to set your own password immediately.** A password changed in the app overrides this value.
   - `PUBLIC_BASE_URL` = `https://crm.christinemikhailov.com` (once the domain works)
   - `PUBLIC_ALLOWED_ORIGINS` = your website origin, e.g. `https://www.christinemikhailov.com`
   - SMTP values: leave empty for now (reminders stay off).
4. First deploy: check the deploy log shows Node 22.13 or newer and `CRM running`. If it says `node:sqlite` is missing, Node is too old — set `NODE_VERSION` higher.
5. Add the custom domain, create the CNAME, verify, wait for the certificate.
6. Open `https://crm.christinemikhailov.com/app/`, sign in, look at **Settings → Decisions** (your approved decisions load on first start).
7. Press **Settings → Download full database backup** and keep the file safely. Then restore-test it (see below) before relying on it.

## Restore test (do once, locally)
Stop any local app, copy the downloaded file to `data/crm.sqlite` (delete `crm.sqlite-wal`/`-shm` beside it), run `npm start`, sign in, confirm your records are there.

## Keep these OFF until the open questions are answered
Tracking (`TRACKING_ENABLED`), reminders (needs SMTP), the widget page and raw event capture (Settings).

## Not included yet
Automatic backup to Google Cloud Storage; email (SMTP) provider setup.
