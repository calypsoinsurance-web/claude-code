# Fetch: documentation and access still needed

**Status: live Fetch quoting is DISABLED.** No Fetch API documentation, credentials, or written confirmation of access was
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
