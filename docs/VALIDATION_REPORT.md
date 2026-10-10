# Validation report — Calypso Pet CRM (2026-10-10)

**Verdict: working prototype, not production-ready.** Live Fetch quoting, automatic ad-platform reporting, real-file import
mappings, email delivery, and deployment are unverified. Sign-in, persistence, calculations and imports work against
synthetic data in automated tests.

## 1. Requirements summary
**Confirmed (from your brief), built:** private single-user CRM; customers/pets/quotes/policies/commission transactions/follow-ups/advertising records with stable IDs and migrations; ad metrics (spend, impressions, link clicks, CTR, CPC); cost per unique quoted customer, per issued policy, per buying customer (shown separately); $150 expected commission per issued policy; commission statement import; attribution frozen per quote, policy attribution only via verified provider quote ID; calendar view and gated acquisition view; follow-ups with reminder emails to you only; CSV/XLSX imports with mapping/preview/validation/duplicates/review queues; dashboard filters and CSV export; desktop + mobile; interface limited to Dashboard, Customers, Advertising, Imports, Follow-ups, Settings.

**Requested but NOT delivered (blocked):** live Fetch quote/payment/issuance integration; automatic Meta/TikTok/Google/LinkedIn syncing; Fetch reporting/webhooks.

## 2. Decisions
**Approved by you on 2026-10-10** (stored in `config/decisions.json`; apply with `npm run apply-decisions`; applying them is tested):
- Reporting time zone America/New_York; currency USD.
- Attribution lookback 30 days; a direct visit does NOT replace an earlier non-direct source.
- Acquisition group starts at the customer's first generated quote; returning customers stay in their first group; as-of date 2026-09-30 (a fixed date you update).
- Cancellations: show issued policies gross with cancelled / not-cancelled counts beside them (net/active treatments not built).
- Reminder address calypsoinsurance@gmail.com (you confirmed it is yours); daily at 8:00 AM Eastern. Reminders stay OFF until SMTP email is configured and you switch them on. `ADMIN_EMAIL` must still be set on the server.
- Hosting direction: Render with the app as built, on a private subdomain of christinemikhailov.com (spelling confirmed). Vercel (needs a Postgres port; unverified file-system and cron limits) and Base44 (a rebuild on its builder) were considered and not chosen. **Not deployed; nothing purchased.** Render custom-domain terms/cost still to be verified.
- Backups: you asked for automatic backup to Google Cloud Storage. **Not built or researched yet**; you were not sure whether you have a Google Cloud project/billing. Manual `npm run backup` until then.

- Widget metaData: **no extra keys are sent to Fetch** (you declined the visitor-ID pass-through). Existing partner identifiers stay verbatim. Attribution for widget quotes will rely on our own tracker (visitor ID recorded in the visitor's browser and linked to the widget `complete` event on the same page) once the real event's field names are known.

**Still open:**
| Decision | Effect until decided |
|---|---|
| Customer with differently-attributed quotes in channel reporting | Interim disclosed rule: counted under each platform with overlap shown and unique total. No allocation. |
| Same for buying customers with differently-attributed policies | Same interim disclosure. |
| Customer disclosure/consent wording; tracking/privacy approach | Public form and tracking stay off (wording depends on Fetch's requirements). |
| Network/placement and other items awaiting Fetch / platform documentation | See `docs/FETCH_DOCUMENTATION_NEEDED.md`. |

## 3. Architecture (minimal)
One Node 22 process: Express + built-in SQLite (`node:sqlite`, flagged experimental by Node) on a single database file; static vanilla-JS UI; public router (`/api/public/*`, `/q/`, `/t.js`) separate from the private router (everything else under `/api`, behind session auth). Pure calculation module (`src/calc.js`) tested in isolation. Money: integer cents/micros. Quote snapshots are immutable JSON; attribution rules are applied when reporting (so approving/changing a rule re-evaluates reports without altering stored snapshots).

## 4. Capability findings
Legend: **Documented** = a public source says it exists (read only via web-search snippets — the official sites could not be opened from the build environment). **Available to your account** = unknown until the provider confirms. **Tested** = a real call succeeded with your credentials.

| Integration | Documented | Available to you | Tested | State in app |
|---|---|---|---|---|
| Fetch quote widget (iframe + `sdk.js`) | Yes, from First Connect's supplied snippet and setup PDF (events ready/init/complete); `complete` payload and reporting NOT documented | Supplied for partner FC16191; use on your own domain unconfirmed | No (real script could not be loaded here; wiring tested with a labelled stub only) | Page `/q/` built, off by default |
| Fetch partner Quote & Purchase API | Existence only (fetchpet.com/partners snippet); no technical docs found | Unknown | No | Adapter disabled; see `docs/FETCH_DOCUMENTATION_NEEDED.md` |
| Fetch reporting / webhooks / policy status | Not found | Unknown | No | Report import only |
| Meta Marketing API insights | Breakdowns incl. `publisher_platform`/`platform_position` (snippet); link-click field names/definitions not verified | Unknown | No | Not implemented; CSV import |
| TikTok Business API reporting | Third-party examples only; official docs unread | Unknown | No | Not implemented; CSV import |
| Google Ads API | Access levels test/basic/standard (snippet); field restrictions unverified | Unknown | No | Not implemented; CSV import |
| LinkedIn ad analytics | `clicks` and `landingPageClicks` metrics, pivots (Microsoft Learn snippet); program access unverified | Unknown | No | Not implemented; CSV import |

No platform integration is claimed to work. Click-ID parameter names used for classification (`fbclid`, `gclid/wbraid/gbraid`, `ttclid`) are conventional and **unverified**; LinkedIn is classified by UTM only.

## 5. Actually tested behavior (automated, `npm test`: 49 tests, all passing; synthetic fixtures only)
- Spec fixture: $300 / 10,000 impressions / 200 link clicks / 20 quoted / 3 buyers / 4 policies → CTR 2%, CPC $1.50, $15 per quoted customer, $75 per policy, $100 per buyer, expected commission $600 — both as pure functions and end-to-end through the database and reports.
- N/A (not 0) for zero denominators and missing data; aggregate rates from totals; incompatible click definitions not combined; all-clicks separate; other currencies excluded and disclosed; overlapping campaign/ad/placement rows not double-counted.
- Multiple pets and repeat quotes count one customer; a customer in two months counts once for the combined range; platform-level uniques disclose overlap.
- Attribution: snapshot frozen at submission; later visits ignored; pending until rules approved; direct-visit rule both ways; lookback; no touches → Unknown; organic and unknown excluded from paid denominators; policy uses its verified originating quote, not another quote; no quote ID → Unknown.
- Imports: preview saves nothing; re-import of ads/quotes/policies/commissions creates no duplicates; names never merge customers; conflicting/missing identifiers go to review and can be resolved; row-level errors; blank ≠ 0; explicit date formats; XLSX read; fake-extension and wrong-type files rejected.
- Commission: $600 receipts + $150 reversal → $450 net with expected still $600; adjustments not treated as receipts; sign-convention contradictions rejected; identical lines in one file kept; unmatched/lump-sum lines stay out of policy balances; exact policy-number matching only; outstanding balance labelled with its basis.
- Calendar vs acquisition: quote in January + policy in February handled separately; acquisition view gated until decisions are made.
- Quote flow: disabled-adapter lead saved with no fabricated quote; duplicate submissions and retries safe; provider failure keeps saved data; provider-answered-but-save-failed is recovered without re-asking the provider; an answer without a real price is rejected; validation and honeypot.
- Security: every private endpoint returns 401 unauthenticated; login failures; CSRF header/origin; public API exposes no CRM records; sign-in disabled when credentials are unset; security headers; CSV formula neutralisation; visit endpoint stores no personal fields.
- Reminders (with a fake mail transport): only to `ADMIN_EMAIL`; no duplicates, including concurrent runs; completed tasks skipped; failures leave the task visible with the error and can be retried once; stays off until confirmed/enabled.
- Manual browser run (Chromium via Playwright) on the demo database: sign-in, all six pages on desktop and 390 px mobile with no console errors and no horizontal overflow after fixes; an end-to-end commission import (preview → commit) through the UI; the public page (off by default → on → lead saved with no price shown; anonymous API call returned 401). Dashboard screenshot reviewed.

**Real commission statement inspected (July 2026, First Connect format, partner code in the header):** one sheet; statement details in rows 3-7; table header on row 11 (Carrier, Organization, Agent, Insured Name, Policy#, Eff. Date, LOB, TransType, Premium, Rate %, Commission); one data line; a "Total" row and a "Total Commission Payable" note. Observations: no payment-date column (Eff. Date is the policy effective date, not a payment date); the statement-level "Date Sent" and "Statement Month" are in the title block; amounts are positive and the only TransType seen is "New" (reversal/chargeback/renewal representations unverified); the single line is a **general-liability policy from a non-pet carrier**, not a pet policy; the policy number would match only an exact stored policy number. The importer was upgraded for this shape: header-row detection (or manual row), skipping of total/note rows with reconciliation to the stated total, a fixed date option, optional reversal/adjustment type values (unlisted types become visible row errors). Previewing the real file in a throwaway in-memory database reconciled ($2.70 stated = $2.70 imported) with one "policy not found" line. **Nothing from that file was committed or stored.** A statement containing pet-policy lines, reversals and renewals is still needed to verify the sign and type conventions.

**Product filter (decision: pet policies only):** commission imports can name a column and the values that mean pet lines; other lines are not imported but are counted, summed and listed in the preview, and are included in the stated-total reconciliation. A browser run of this screen found and fixed a UI/server mismatch (list options sent as text); list options are now accepted either way and tested. The values that identify pet lines in a real First Connect statement are **not yet known** (the only sample line was non-pet).

**Also tested:** downloaded backup is a valid SQLite file containing the data and needs sign-in plus the CSRF header; apply-decisions fills only empty settings and is idempotent. Render blueprint/guide written from search-snippet docs and **not executed**.

**Widget tests (added):** config keeps partner identifiers verbatim; widget page off by default and enabled only via the private settings; raw widget events ignored unless capture is on, validated, size-bounded and never create quotes; quote-page security policy allows only Fetch's host while CRM pages stay strict. Manual Chromium run with a **stand-in** for Fetch's script: container mounts, `init`/`invoke` called with the supplied config, container heights 520 px desktop / 680 px mobile per the PDF, events recorded. **The real widget has not been run.**

## 6. Documented but untested
Everything in section 4 beyond existence; real SMTP delivery (only a fake transport was used); the `backup` script ran once but a **restore was not rehearsed**; deployment steps; behavior with real Fetch / ad-platform / commission files; the tracker snippet embedded on an external site (cross-origin path covered only at API level); hosting prices (from search snippets).

## 7. Blocked or unsupported
The widget does not give this app quote data (pricing, IDs), so counting quotes still depends on importing First Connect reports; the `complete` event is not treated as a quote.
Live Fetch quoting, payment handoff, issuance confirmation, webhooks; automatic ad syncing for all four platforms; Facebook vs Instagram split from any source other than a report that contains a publisher-platform breakdown; acquisition options other than first-quote/first-group-only; allocation rules for multi-source customers; currency conversion; manual entry of quotes/policies (use import); a "payment handoff" button (no supported handoff documented, so none exists).

## 8. Known limitations and honest caveats
- Quote time for a quote saved on a *retry* is the save time, not the provider response time.
- Imports with only a date (no time) use that date as the calendar day and midnight UTC for lookback checks.
- Campaign/ad-level reporting needs ad URLs that carry platform IDs in `utm_campaign`/`utm_content`; otherwise paid outcomes appear in platform totals but not campaign rows (the count of such quotes is shown).
- A shared device/browser could link one person's visits to another's quote (visitor-ID based).
- `node:sqlite` is experimental in Node 22; single-instance only. `npm audit` reports 2 moderate findings via `exceljs → uuid`.
- Customer names/notes appear in reminder emails (to you only); remove if you prefer IDs only.
- Ad-spend dates are taken as reported in the report's own time zone (stored per row), not converted.
- Acquisition "buying" counts policies issued on/after the first-quote date up to the as-of date.

## 9. Estimated recurring cost
≈ $7–10/month (Render Starter + 1 GB disk + free email tier), under the $50 target; separate and unresearched items (domain, Claude usage, API fees) are listed in `docs/COSTS.md`. Estimate only; prices from search snippets.
