-- Calypso pet CRM initial schema. Money is stored as integer cents (commission, premium)
-- or integer micro-units (ad spend: 1_000_000 = 1.00 of the row's currency).
PRAGMA foreign_keys = ON;

CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE sessions (
  id_hash TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

CREATE TABLE imports (
  id INTEGER PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('ads','quotes','policies','commissions')),
  filename TEXT NOT NULL,
  file_sha256 TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('staged','committed','failed')),
  headers_json TEXT NOT NULL,
  mapping_json TEXT,
  options_json TEXT,
  rows_total INTEGER NOT NULL DEFAULT 0,
  rows_created INTEGER NOT NULL DEFAULT 0,
  rows_updated INTEGER NOT NULL DEFAULT 0,
  rows_unchanged INTEGER NOT NULL DEFAULT 0,
  rows_errored INTEGER NOT NULL DEFAULT 0,
  rows_review INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  committed_at TEXT
);

-- Parsed rows are staged server side between upload, preview and commit. The uploaded file itself is never stored.
CREATE TABLE import_rows (
  import_id INTEGER NOT NULL REFERENCES imports(id) ON DELETE CASCADE,
  row_number INTEGER NOT NULL,
  data_json TEXT NOT NULL,
  PRIMARY KEY (import_id, row_number)
);

CREATE TABLE import_errors (
  id INTEGER PRIMARY KEY,
  import_id INTEGER NOT NULL REFERENCES imports(id) ON DELETE CASCADE,
  row_number INTEGER NOT NULL,
  message TEXT NOT NULL
);

CREATE TABLE customers (
  id INTEGER PRIMARY KEY,
  provider_customer_id TEXT,
  name TEXT NOT NULL,
  email TEXT,
  phone TEXT,
  state TEXT,
  first_source_type TEXT,
  first_source_platform TEXT,
  first_touch_json TEXT,
  notes TEXT NOT NULL DEFAULT '',
  identity_note TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX customers_provider_id ON customers(provider_customer_id) WHERE provider_customer_id IS NOT NULL;
CREATE UNIQUE INDEX customers_email ON customers(email) WHERE email IS NOT NULL;

CREATE TABLE pets (
  id INTEGER PRIMARY KEY,
  customer_id INTEGER NOT NULL REFERENCES customers(id),
  provider_pet_id TEXT,
  name TEXT NOT NULL,
  species TEXT CHECK (species IN ('dog','cat')),
  breed TEXT,
  age_as_recorded TEXT,
  age_recorded_on TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX pets_provider_id ON pets(provider_pet_id) WHERE provider_pet_id IS NOT NULL;
CREATE INDEX pets_customer ON pets(customer_id);

-- Anonymous visits. customer_id is only set when a supported identifier (the visitor id submitted with a quote form) links it.
CREATE TABLE visits (
  id INTEGER PRIMARY KEY,
  visitor_id TEXT NOT NULL,
  customer_id INTEGER REFERENCES customers(id),
  visited_at TEXT NOT NULL,
  landing_url TEXT,
  referrer TEXT,
  utm_source TEXT, utm_medium TEXT, utm_campaign TEXT, utm_content TEXT, utm_term TEXT, utm_id TEXT,
  click_ids_json TEXT,
  source_type TEXT NOT NULL CHECK (source_type IN ('paid','organic','referral','direct','unknown')),
  platform TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX visits_visitor ON visits(visitor_id, visited_at);

CREATE TABLE quote_requests (
  id INTEGER PRIMARY KEY,
  idempotency_key TEXT NOT NULL UNIQUE,
  access_token_hash TEXT NOT NULL,
  customer_id INTEGER REFERENCES customers(id),
  payload_hash TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('received','crm_saved','quote_failed','quote_unavailable','quote_received_unsaved','completed')),
  error_message TEXT,
  provider_response_json TEXT,
  attribution_snapshot_json TEXT NOT NULL DEFAULT '{"touches":[]}',
  attempts INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE quotes (
  id INTEGER PRIMARY KEY,
  customer_id INTEGER NOT NULL REFERENCES customers(id),
  pet_id INTEGER REFERENCES pets(id),
  quote_request_id INTEGER REFERENCES quote_requests(id),
  provider TEXT NOT NULL,
  provider_quote_id TEXT,
  dedupe_key TEXT NOT NULL,
  quoted_at TEXT NOT NULL,
  quoted_date TEXT, -- calendar date as given by an imported report when it carries no time of day
  premium_cents INTEGER,
  payment_frequency TEXT,
  coverage_json TEXT,
  status TEXT NOT NULL DEFAULT 'generated',
  attribution_snapshot_json TEXT NOT NULL DEFAULT '{"touches":[]}',
  source TEXT NOT NULL CHECK (source IN ('public_form','import','manual')),
  import_id INTEGER REFERENCES imports(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX quotes_dedupe ON quotes(dedupe_key);
CREATE UNIQUE INDEX quotes_provider ON quotes(provider, provider_quote_id) WHERE provider_quote_id IS NOT NULL;
CREATE INDEX quotes_customer ON quotes(customer_id, quoted_at);

CREATE TABLE policies (
  id INTEGER PRIMARY KEY,
  customer_id INTEGER NOT NULL REFERENCES customers(id),
  pet_id INTEGER REFERENCES pets(id),
  quote_id INTEGER REFERENCES quotes(id),
  claimed_provider_quote_id TEXT,
  quote_link_basis TEXT NOT NULL DEFAULT 'unknown' CHECK (quote_link_basis IN ('provider_quote_id','unknown')),
  carrier TEXT NOT NULL,
  policy_number TEXT NOT NULL,
  is_issued INTEGER NOT NULL DEFAULT 0,
  issue_date TEXT,
  effective_date TEXT,
  status TEXT,
  premium_cents INTEGER,
  payment_frequency TEXT,
  coverage_json TEXT,
  cancellation_date TEXT,
  expected_commission_cents INTEGER NOT NULL DEFAULT 15000,
  source TEXT NOT NULL CHECK (source IN ('import','manual')),
  import_id INTEGER REFERENCES imports(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (carrier, policy_number)
);
CREATE INDEX policies_customer ON policies(customer_id);

CREATE TABLE commission_transactions (
  id INTEGER PRIMARY KEY,
  policy_id INTEGER REFERENCES policies(id),
  type TEXT NOT NULL CHECK (type IN ('receipt','reversal','adjustment')),
  amount_cents INTEGER NOT NULL,
  currency TEXT NOT NULL,
  txn_date TEXT NOT NULL,
  statement_ref TEXT,
  statement_policy_ref TEXT,
  match_status TEXT NOT NULL CHECK (match_status IN ('matched','unmatched','manual')),
  dedupe_key TEXT NOT NULL UNIQUE,
  raw_json TEXT,
  import_id INTEGER REFERENCES imports(id),
  created_at TEXT NOT NULL,
  CHECK ((type = 'receipt' AND amount_cents > 0) OR (type = 'reversal' AND amount_cents < 0) OR type = 'adjustment')
);

CREATE TABLE review_items (
  id INTEGER PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('customer_match','policy_customer','commission_unmatched','policy_quote_unverified')),
  import_id INTEGER REFERENCES imports(id),
  row_number INTEGER,
  reason TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  dedupe_key TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','resolved')),
  resolution TEXT,
  created_at TEXT NOT NULL,
  resolved_at TEXT
);

CREATE TABLE followups (
  id INTEGER PRIMARY KEY,
  customer_id INTEGER NOT NULL REFERENCES customers(id),
  due_date TEXT NOT NULL,
  note TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','completed')),
  completed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX followups_due ON followups(status, due_date);

CREATE TABLE reminder_deliveries (
  id INTEGER PRIMARY KEY,
  followup_id INTEGER NOT NULL REFERENCES followups(id),
  due_date TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending','sending','sent','failed')),
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  claimed_at TEXT,
  sent_at TEXT,
  UNIQUE (followup_id, due_date)
);

CREATE TABLE ad_records (
  id INTEGER PRIMARY KEY,
  platform TEXT NOT NULL CHECK (platform IN ('meta','tiktok','google','linkedin','other')),
  account_id TEXT NOT NULL,
  level TEXT NOT NULL CHECK (level IN ('account','campaign','adset','ad')),
  breakdown_signature TEXT NOT NULL DEFAULT 'none',
  channel TEXT NOT NULL DEFAULT '',
  network TEXT NOT NULL DEFAULT '',
  placement TEXT NOT NULL DEFAULT '',
  campaign_id TEXT NOT NULL DEFAULT '',
  campaign_name TEXT,
  adset_id TEXT NOT NULL DEFAULT '',
  adset_name TEXT,
  ad_id TEXT NOT NULL DEFAULT '',
  ad_name TEXT,
  report_date TEXT NOT NULL,
  currency TEXT NOT NULL,
  spend_micros INTEGER NOT NULL,
  impressions INTEGER,
  link_clicks INTEGER,
  link_click_metric TEXT,
  link_click_definition TEXT,
  all_clicks INTEGER,
  all_click_metric TEXT,
  reporting_timezone TEXT NOT NULL,
  provenance TEXT NOT NULL CHECK (provenance IN ('api','import')),
  import_id INTEGER REFERENCES imports(id),
  synced_at TEXT NOT NULL,
  UNIQUE (platform, account_id, level, breakdown_signature, channel, network, placement, campaign_id, adset_id, ad_id, report_date, currency)
);
CREATE INDEX ad_records_date ON ad_records(report_date);

CREATE TABLE integration_status (
  key TEXT PRIMARY KEY,
  state TEXT NOT NULL,
  last_success_at TEXT,
  last_error TEXT,
  last_error_at TEXT,
  updated_at TEXT NOT NULL
);
