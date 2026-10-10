# Calypso Pet CRM

A small, private, single-user CRM and advertising dashboard for pet insurance (built for Christine Mikhailov, Calypso Insurance).

> **Status: working prototype, NOT production-ready.** The app, database, imports, calculations, sign-in and reminders are
> built and automatically tested. **Live Fetch quoting and automatic ad-platform syncing are not connected** (documentation and
> credentials were not available). CSV/XLSX import is the working data path. See `docs/VALIDATION_REPORT.md` for exactly what was and was not tested.

## What it does
- **Dashboard** – ad spend, impressions, link clicks, CTR, CPC; unique quoted customers; issued policies and unique buying customers (kept separate); cost per quoted customer / issued policy / buying customer; commission (expected $150 per issued policy, receipts, reversals, adjustments, net); freshness, tracking coverage, unattributed outcomes; calendar activity and an acquisition view (off until you approve its rules); CSV export.
- **Customers** – customers, multiple pets, quote history, policies, attribution history, notes, follow-ups.
- **Advertising** – campaign / channel tables and imported records. Meta is shown combined unless the report has a Facebook/Instagram breakdown.
- **Imports** – CSV/XLSX for advertising, quotes, policies and commission statements: column mapping, preview, validation, row errors, duplicate-safe re-imports, history, review queues.
- **Follow-ups** – due/overdue lists, editable dates, completion, reminder emails to you only.
- **Settings** – the decisions only you can make, reminders, public page, integration status, exports.

Rules the app enforces: missing data shows **N/A** (never 0); source is never inferred from timing; unknown stays unknown; unique customers are recalculated for each range; spend is never double-counted across campaign/ad/placement rows; incompatible click definitions are never combined.

## Set it up on your computer (beginner steps)
1. Install **Node.js 22.13 or newer** (https://nodejs.org – choose the "LTS"/22+ download). Check with `node -v`.
2. Open a terminal in this folder and run `npm install`.
3. Copy the settings file: `cp .env.example .env` (Windows: `copy .env.example .env`).
4. Make your password hash: `npm run hash-password -- "a long passphrase of 12+ characters"`. Paste the printed `ADMIN_PASSWORD_HASH=…` line into `.env`, and set `ADMIN_EMAIL=` to your email.
5. Start it: `npm start`, then open http://localhost:3000/app/ and sign in.
6. Apply your approved decisions with `npm run apply-decisions` (values are in `config/decisions.json`; you can review/change them under **Settings → Decisions**). Until decisions exist, the related numbers show N/A on purpose.

### Try the demo (synthetic data, separate database)
```
npm run seed:demo     # creates data/demo.sqlite with obviously fake records
npm run demo          # runs the app on it; every page shows a purple DEMO DATA banner
```
Your real database is `data/crm.sqlite` and is never touched by the demo.

### Run the tests
`npm test` (50 automated tests: calculations, imports, attribution, security, quote retries, reminders).

## Getting your data in
1. **Imports → New import**, pick the type, choose your file, match columns, set the "what the file means" options, **Preview** (nothing saved), then **Commit**.
2. Sample layouts are in `templates/` (synthetic; **not** the real Fetch/ad-platform formats – real files need their own mapping).
3. Re-importing a file is safe. Uncertain customer matches (conflicting IDs, no email/ID) wait in **Imports → Review queue**. Customers are never merged by name.
4. Advertising files: enter the platform's *exact* link-click metric name and definition. Rows with different definitions are not combined into one CTR/CPC.

## Tracking and attribution
- Put the tracker on your website pages: `<script src="https://YOUR-CRM-HOST/t.js" async></script>` and list your site in `PUBLIC_ALLOWED_ORIGINS`. It is **off** until you set `TRACKING_ENABLED=true` (decide your privacy notice/consent approach first).
- Quote attribution is frozen on each quote. To match a paid quote to a campaign/ad in reports, your ad URLs must carry the platform **IDs** in `utm_campaign` (campaign ID) and `utm_content` (ad ID); matching is exact. Check each platform's URL-parameter/macro documentation for the right placeholders (not verified here).
- The public quote page is `/q/`. It stays off until you add the customer disclosure text and enable it (Settings). While live Fetch quoting is disabled it saves the lead, shows **no price**, and creates a follow-up for you.

## Deploying (only when you decide to; nothing has been deployed)
Requirements: a host that runs Node 22+ with a **persistent disk** for `DB_PATH`, HTTPS, and the `.env` values set as environment variables (never commit them). Suggested: Render Starter web service + 1 GB disk (≈ $7.25/month; see `docs/COSTS.md`).
Typical settings: build `npm install`, start `npm start`, `NODE_ENV=production`, `TRUST_PROXY=1`, `DB_PATH=/var/data/crm.sqlite` (disk mount), `PUBLIC_BASE_URL=https://your-address`. Run a single instance only (SQLite). The restore steps below were not rehearsed in this build, so after deploying: sign in, run a backup, and prove a restore works before relying on it.

## Backups, restore and export
- **Backup:** `npm run backup` writes a consistent copy to `data/backups/` (safe while running). Copy it **off the machine** (it holds customer data). Do this on a schedule you choose; suggested: weekly plus before every big import.
- **Restore:** stop the app, replace `data/crm.sqlite` (and delete any `crm.sqlite-wal` / `-shm` files next to it) with the backup file, start the app.
- **Export:** Settings → Export (CSV per table) and Dashboard → "Export this summary". CSV is a convenience copy, not a restorable backup.
- Schema changes ship as numbered files in `migrations/` and apply automatically on start (`npm run migrate` runs them without starting the app).

## Security notes
Single user, scrypt-hashed password, HttpOnly + SameSite=Strict session cookie (Secure in production), login rate limit, CSRF header + origin check on changes, CSP/security headers, validated inputs, uploads parsed in memory (extension + content checks, 10 MB / 50,000 rows by default, never stored or executed), CSV exports neutralise spreadsheet formulas, secrets only in environment variables. Public endpoints can only add visits/quote requests and return the caller's own quote result.
Known caveat: `exceljs` pulls in a `uuid` version flagged by `npm audit` (moderate, buffer-bounds issue in v3/v5/v6 when a buffer is supplied; whether this app's use can reach it was not verified). Re-check with `npm audit` before deploying.

## Layout
`src/` server (`calc.js` pure formulas, `reports.js`, `imports.js`, `quoteFlow.js`, `reminders.js`, `integrations/`), `src/public/crm` the app UI, `src/public/quote` the public page + tracker, `migrations/`, `scripts/`, `templates/`, `test/`, `docs/`.
