# Operating-cost estimate (budget target: $50/month or less, excluding ad spend)

Prices are from **web-search snippets on 2026-10-10**, because provider pricing pages could not be opened directly from the
build environment. Search results sometimes disagreed. **Confirm on each provider's pricing page before buying.** This is an
estimate, not a quote. Nothing has been purchased or deployed.

## Recurring (monthly)

| Item | Option | Estimate | Notes / source |
|---|---|---|---|
| App hosting | Render "Starter" web service | ~$7 | Snippet: Starter $7/mo, 512 MB RAM. Free instances cannot attach a disk, so they cannot hold the database. |
| Database storage | SQLite file on a Render persistent disk, 1 GB | ~$0.25 | Snippet: disks $0.25/GB/month. Customer-scale data is tiny. |
| Alternative host | Hetzner Cloud CX23 VPS | ~€5.99 incl. IPv4 | Snippet (Aug–Sep 2026): €5.49 + €0.50 IPv4; prices rose twice in 2026 and the cheap line was reported unavailable at times. You manage the server yourself (harder for beginners). |
| Alternative host | Fly.io shared-cpu-1x + volume | ~$2–4 + $0.15/GB | Snippets disagreed on the machine price ($1.94–$2.19 for 256 MB; Node likely needs more). |
| Reminder email | Resend free plan **or** your own mailbox SMTP | $0 (Resend free: 3,000/mo, 100/day per snippet) | Reminders are ≤1 digest/day. A custom sending domain is needed for good deliverability (domain cost below). SMTP through an existing mailbox was **not researched** for limits/terms. |
| Integration services | None required | $0 | CSV/XLSX import needs no third party. Ad-platform and Fetch API fees/terms were **not researched** (no API is connected). |
| File storage | Uploaded files are not stored | $0 | |
| Backups | Manual `npm run backup` copied to a drive you already own | $0 | Hosted-disk snapshot pricing/availability **not verified**. |
| **Total (Render route)** | | **≈ $7.25–$10/month** | Well under $50 with a wide margin. |

Usage limits / overage risks: Resend free plan pauses at 100 emails/day (no surprise bill per snippet); Render bills disk
by size, so growth is the only variable cost; a larger instance if memory runs out (not expected at this scale).

## Non-recurring or separate (not in the monthly figure)
- **Claude Code usage and development time**: not estimated; billed under your Claude plan, outside this app's running cost.
- **Domain name**: not researched (typically a yearly fee); optional for a first deployment (hosts provide a free subdomain),
  but needed for a branded quote page and a verified email sending domain.
- **Meta / TikTok / Google / LinkedIn / Fetch API access**: any fees, approvals or review costs are **not researched**.
- Optional one-off: a developer to implement the Fetch adapter once documentation exists.
