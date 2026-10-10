# Import templates (SYNTHETIC)

These files contain made-up sample rows (`SAMPLE-…`, `@example.invalid`). They show *a* layout the importer can read.
**They are not the real Fetch / First Connect, ad-platform or commission-statement formats** — none of those formats has
been verified yet. Real files will have different column names; that is why every import has a column-mapping step.

When you have a real (sanitized) file, send it so the mapping hints can be confirmed. Never commit real customer data.

| Template | Import type | Notes |
|---|---|---|
| advertising.csv | Advertising report | Row = ad per day per publisher platform. Choose level "Individual ad". Enter the exact link-click metric name and definition from the platform. |
| quotes.csv | Quotes | Row = one quote for one pet. |
| policies.csv | Issued policies | Treat statuses `Active, Cancelled` as issued. Originating quote ID links a policy to its quote; blank = attribution Unknown. |
| commission-statement.csv | Commission statement | Choose "type column", amounts "already signed"; Commission = receipt, Chargeback = reversal. The last line has no policy number, so it stays unmatched (never allocated). |
