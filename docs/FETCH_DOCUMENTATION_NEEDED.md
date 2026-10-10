# Fetch: documentation and access still needed

**Status: the Quote API adapter is DISABLED. The Fetch quote widget page (`/q/`) is built but not yet run against the real widget.** No Fetch API documentation, credentials, or written confirmation of access was
available. The only public statement found (a web-search snippet of fetchpet.com/partners) is that Fetch has a
"Partner Quote & Purchase API" with unique UTM codes for tracking, reached through a "Contact us" form. Nothing
technical (endpoints, fields, auth, responses) was found, and the Fetch site could not be opened directly from the build
environment. Nothing below has been assumed or implemented.

Ask Fetch (partners page → Contact us) for **written** answers, then send the documents to whoever continues this build:

| # | Question | Why it matters |
|---|---|---|
| 1 | Does my partner/API agreement permit a customer-facing flow where *my* page collects details and shows a real Fetch quote, with redirect to Fetch only for payment? | If not, the quoting page must be a handoff (redirect/link) instead. |
| 2 | Technical docs: base URL, authentication method, sandbox vs production, rate limits. | Needed to write and test the adapter (`src/integrations/fetch.js`). |
| 3 | Required customer and pet fields (and accepted values for species, breed, age, state). | Form fields and validation. |
| 4 | How quotes are created and updated; the quote identifier; whether a quote can be re-priced. | Quote history, safe retries, linking policies to quotes. |
| 5 | The actual pricing response (premium, payment frequency, coverage options, expiry). | The page must show only real responses. |
| 6 | The supported payment handoff (URL format, token, return/redirect behaviour). | Redirect to Fetch for payment. |
| 7 | How issuance is confirmed: webhook, polling, or report only; policy status values; cancellation data. | A redirect is **never** treated as a sale. |
| 8 | Reporting endpoints and webhooks (separate from quoting), including whether quote ID appears on policy rows. | Automatic reconciliation of policies to quotes. |
| 9 | Permitted storage of customer/quote data, retention, and any restrictions on tracking/UTM use. | Compliance. |
| 10 | Required customer disclosures / consent wording and where it must appear. | Goes into Settings → Public quote page. |
| 11 | A sanitized sample of the Fetch / First Connect customer, quote and policy exports (CSV/Excel), and of a commission statement. | Confirms column names, identifiers, date meanings, premium frequency, sign conventions before import mappings are finalized. |

When docs arrive: implement `createQuote` in `src/integrations/fetch.js`, test with your credentials, add a test for each failure
mode against recorded sandbox responses, and only then set `FETCH_LIVE_ENABLED=true`.

## Added 2026-10-10: questions about the widget you were given
You supplied the embed snippet (partner `FC16191`) and the Container Setup PDF. They show the widget runs in a Fetch-hosted iframe and fires `ready`, `init` and `complete` events, but they do **not** say:

| # | Question | Why it matters |
|---|---|---|
| W1 | What does the `complete` event's payload contain (quote ID, premium, customer/pet details)? Does `complete` mean a quote was generated, the user finished, or the window closed? | Until known, widget events are stored raw and never counted as quotes. |
| W2 | May the widget be embedded on my own domain (`christinemikhailov.com` subdomain)? Is there a domain allow-list I must register? | Page may not load there otherwise. |
| W3 | Is `metaData` a closed set of keys, or may I add my own (e.g. a campaign/ad ID)? May I change `utm_campaign` per ad without breaking First Connect tracking? | Lets paid quotes in First Connect reports carry my campaign/ad IDs, so quotes can be attributed. Not done: values are kept exactly as supplied. |
| W4 | Do First Connect quote/policy reports include `metaData` UTM values and a quote ID that policy rows reference? Sanitized sample report please. | Needed to attribute widget quotes and link policies to their originating quote. |
| W5 | How does payment/purchase happen after step 2 (inside the widget, redirect)? How is issuance reported? | A completed widget is never treated as a sale. |
| W6 | Who owns required disclosures/consent shown to customers around the widget, and may I store widget data (permitted storage)? | Compliance; capture of raw events is off by default. |
| W7 | Is the widget script version-pinned (`1.0.0` in the URL) and are there CSP/domain requirements (script, frame, connect hosts)? | I allowed `https://salesfunnelquotesdk.fetchpet.com` for script/frame and `https://*.fetchpet.com` for connect as a guess; real needs unverified. |

## Owner's answers to W1–W5 (2026-10-10) — REPORTED BY YOU, NOT YET CONFIRMED IN WRITING BY FETCH
| # | Your answer | How the app treats it |
|---|---|---|
| W1 | The `complete` event carries the premium, customer and pet details, and means a quote was generated. | **Exact field names are unknown**, so nothing is parsed yet. Next step: record one real `complete` event and build a tested mapping from it. |
| W2 | Embedding on your own domain is allowed. | Page is built for it; confirm in writing if Fetch requires a registered domain. |
| W3 | You can add your own `metaData` keys. | Not applied yet. Proposal: add one new key carrying our anonymous visitor ID (see decision pending). Existing identifiers stay unchanged. |
| W4 | Reports do NOT include the widget's UTM values or a quote ID linking policies to quotes. | Policy→quote links cannot be verified from reports, so policy attribution stays **Unknown** unless another verified identifier is found. |
| W5 | After step 2 the purchase happens on a tracked fetchpet.com link; you see it in your Fetch dashboard. | A widget completion is never counted as a sale. We need to learn what identifiers the dashboard/exports show per sale. |
