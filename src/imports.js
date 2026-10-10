'use strict';
const crypto = require('node:crypto');
const { tx, now } = require('./db');
const crm = require('./crm');
const { parseUpload, parseDate, parseMoney, parseIntStrict } = require('./importParse');
const { classifyVisit } = require('./attribution');

const sha = crm.sha;
const norm = crm.norm;

// ---------------------------------------------------------------------------------------------------
// Field catalogue. These are OUR field names; the real report columns are mapped to them by the user.
// No provider report format has been verified, so nothing is auto-trusted: suggestions are only hints.
// ---------------------------------------------------------------------------------------------------
const CUSTOMER_FIELDS = {
  provider_customer_id: 'Provider customer ID', customer_name: 'Customer name', customer_email: 'Customer email',
  customer_phone: 'Customer phone', customer_state: 'Customer state',
};
const PET_FIELDS = {
  provider_pet_id: 'Provider pet ID', pet_name: 'Pet name', species: 'Dog or cat', breed: 'Breed', pet_age: 'Pet age (as recorded)',
};
const FIELDS = {
  ads: {
    report_date: 'Reporting date*', spend: 'Spend*', account_id: 'Account ID', currency: 'Currency',
    campaign_id: 'Campaign ID', campaign_name: 'Campaign name', adset_id: 'Ad group / ad set ID', adset_name: 'Ad group / ad set name',
    ad_id: 'Ad ID', ad_name: 'Ad name', channel: 'Channel / publisher platform', network: 'Network', placement: 'Placement',
    impressions: 'Impressions', link_clicks: 'Link (destination) clicks', all_clicks: 'All clicks',
  },
  quotes: {
    ...CUSTOMER_FIELDS, ...PET_FIELDS, provider_quote_id: 'Provider quote ID', quote_date: 'Quote date*', premium: 'Premium',
    payment_frequency: 'Payment frequency', quote_status: 'Quote status', utm_source: 'UTM source', utm_medium: 'UTM medium',
    utm_campaign: 'UTM campaign', utm_content: 'UTM content',
  },
  policies: {
    ...CUSTOMER_FIELDS, ...PET_FIELDS, policy_number: 'Policy number*', carrier: 'Carrier', policy_status: 'Policy status',
    issue_date: 'Issue date', effective_date: 'Effective date', cancellation_date: 'Cancellation date', premium: 'Premium',
    payment_frequency: 'Payment frequency', provider_quote_id: 'Originating provider quote ID',
  },
  commissions: {
    txn_date: 'Transaction / payment date*', amount: 'Amount*', policy_number: 'Policy number', carrier: 'Carrier',
    txn_type: 'Transaction type', statement_ref: 'Statement reference',
  },
};
const REQUIRED = {
  ads: ['report_date', 'spend'], quotes: ['quote_date'], policies: ['policy_number'], commissions: ['txn_date', 'amount'],
};
const SYNONYMS = {
  report_date: ['date', 'day', 'reporting starts', 'report date', 'reporting date'], spend: ['spend', 'amount spent', 'cost', 'total spent'],
  impressions: ['impressions', 'impr.'], link_clicks: ['link clicks', 'inline link clicks'], all_clicks: ['clicks (all)', 'all clicks'],
  campaign_id: ['campaign id'], campaign_name: ['campaign name', 'campaign'], adset_id: ['ad set id', 'ad group id'], adset_name: ['ad set name', 'ad group name', 'ad group'],
  ad_id: ['ad id'], ad_name: ['ad name', 'ad'], account_id: ['account id', 'customer id'], currency: ['currency'],
  channel: ['platform', 'publisher platform'], network: ['network'], placement: ['placement', 'platform position'],
  customer_email: ['email', 'customer email', 'email address'], customer_name: ['name', 'customer name', 'full name'], customer_phone: ['phone', 'phone number'],
  customer_state: ['state'], provider_customer_id: ['customer id', 'customer number'], pet_name: ['pet name', 'pet'], species: ['species', 'pet type', 'type'],
  breed: ['breed'], pet_age: ['age', 'pet age'], provider_pet_id: ['pet id'], provider_quote_id: ['quote id', 'quote number'], quote_date: ['quote date', 'date quoted', 'created'],
  premium: ['premium', 'monthly premium', 'price'], payment_frequency: ['payment frequency', 'frequency', 'billing frequency'], quote_status: ['quote status', 'status'],
  policy_number: ['policy number', 'policy #', 'policy no', 'policy'], carrier: ['carrier', 'underwriter'], policy_status: ['policy status', 'status'],
  issue_date: ['issue date', 'issued', 'purchase date'], effective_date: ['effective date', 'start date'], cancellation_date: ['cancellation date', 'cancelled date'],
  txn_date: ['payment date', 'transaction date', 'date paid', 'date'], amount: ['amount', 'commission', 'commission amount'], txn_type: ['type', 'transaction type'], statement_ref: ['statement', 'statement id', 'statement reference'],
  utm_source: ['utm source', 'utm_source'], utm_medium: ['utm medium', 'utm_medium'], utm_campaign: ['utm campaign', 'utm_campaign'], utm_content: ['utm content', 'utm_content'],
};

function suggestMapping(kind, headers) {
  const used = new Set();
  const out = {};
  const lower = headers.map((h) => h.toLowerCase());
  for (const f of Object.keys(FIELDS[kind])) {
    for (const syn of SYNONYMS[f] || []) {
      const i = lower.indexOf(syn);
      if (i >= 0 && !used.has(i)) { out[f] = headers[i]; used.add(i); break; }
    }
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------
// Normalisation: raw row + mapping + options  ->  validated values (or an error string)
// ---------------------------------------------------------------------------------------------------
const PLATFORMS = ['meta', 'tiktok', 'google', 'linkedin', 'other'];
const LEVELS = ['account', 'campaign', 'adset', 'ad'];

function validateOptions(kind, mapping, o) {
  const errs = [];
  const m = (f) => !!mapping[f];
  for (const f of REQUIRED[kind]) if (!m(f)) errs.push(`Map a column for "${FIELDS[kind][f].replace('*', '')}".`);
  const dateFields = { ads: ['report_date'], quotes: ['quote_date'], policies: ['issue_date', 'effective_date', 'cancellation_date'], commissions: ['txn_date'] }[kind];
  if (dateFields.some(m) && !['iso', 'mdy', 'dmy'].includes(o.date_format)) errs.push('Choose how dates are written in this file (YYYY-MM-DD, MM/DD/YYYY or DD/MM/YYYY).');
  if (kind === 'ads') {
    if (!PLATFORMS.includes(o.platform)) errs.push('Choose the advertising platform.');
    if (!LEVELS.includes(o.level)) errs.push('Choose what each row represents (account, campaign, ad group/set, or ad).');
    if (!m('account_id') && !norm(o.account_id)) errs.push('Map an account ID column or type the account ID.');
    if (!m('currency') && !/^[A-Za-z]{3}$/.test(o.currency || '')) errs.push('Map a currency column or enter a 3-letter currency code.');
    if (!norm(o.reporting_timezone)) errs.push('Enter the time zone this report uses (e.g. America/New_York).');
    if (m('link_clicks') && (!norm(o.link_click_metric) || !norm(o.link_click_definition))) errs.push('Enter the exact name and definition of the link-click metric used in the report.');
    if (m('all_clicks') && !norm(o.all_click_metric)) errs.push('Enter the exact name of the all-clicks metric used in the report.');
    if (o.level === 'campaign' && !m('campaign_id') && !m('campaign_name')) errs.push('Campaign-level rows need a campaign ID or name column.');
    if (o.level === 'adset' && !m('adset_id') && !m('adset_name')) errs.push('Ad-set-level rows need an ad set ID or name column.');
    if (o.level === 'ad' && !m('ad_id') && !m('ad_name')) errs.push('Ad-level rows need an ad ID or name column.');
  }
  if (kind === 'policies') {
    if (!m('carrier') && !norm(o.carrier)) errs.push('Map a carrier column or type the carrier name.');
    if (!['all', 'status_values'].includes(o.issued_rule)) errs.push('Say which rows are confirmed issued policies.');
    if (o.issued_rule === 'status_values' && (!m('policy_status') || !(o.issued_values || []).length)) errs.push('Map the status column and list the status values that mean "issued" (include cancelled/lapsed if they were issued).');
  }
  if (kind === 'commissions') {
    if (!['signed', 'type_column'].includes(o.sign_convention)) errs.push('Choose how receipts and reversals are shown in this statement.');
    if (o.sign_convention === 'type_column') {
      if (!m('txn_type')) errs.push('Map the transaction type column.');
      if (!['as_is', 'absolute'].includes(o.amount_sign)) errs.push('Say whether amounts in the type-column format are already signed or always positive.');
      for (const t of ['receipt', 'reversal', 'adjustment']) if (!(o[`${t}_values`] || []).length) { if (t !== 'adjustment') errs.push(`List the type values that mean "${t}".`); }
    }
    if (!m('statement_ref') && !norm(o.statement_ref)) errs.push('Map a statement reference column or type one (e.g. "2026-03 statement").');
    if (!/^[A-Za-z]{3}$/.test(o.currency || '')) errs.push('Enter the statement currency (3-letter code).');
  }
  if (kind === 'quotes' || kind === 'policies') {
    if (!m('customer_email') && !m('provider_customer_id')) errs.push('Map at least an email or provider customer ID column; rows without one go to review.');
  }
  return errs;
}

function normalizeRow(kind, raw, mapping, o) {
  const g = (f) => (mapping[f] ? String(raw[mapping[f]] ?? '').trim() : '');
  const df = o.date_format;
  const dateVal = (f, required) => {
    if (!mapping[f]) return null;
    const v = parseDate(g(f), df);
    if (v === undefined) throw new Error(`${FIELDS[kind][f].replace('*', '')}: "${g(f)}" is not a valid date in the chosen format`);
    if (v === null && required) throw new Error(`${FIELDS[kind][f].replace('*', '')} is blank`);
    return v;
  };
  const moneyVal = (f, scale, required) => {
    if (!mapping[f]) return null;
    const v = parseMoney(g(f), scale);
    if (v === undefined) throw new Error(`${FIELDS[kind][f].replace('*', '')}: "${g(f)}" is not a valid amount`);
    if (v === null && required) throw new Error(`${FIELDS[kind][f].replace('*', '')} is blank`);
    return v;
  };
  const intVal = (f) => {
    if (!mapping[f]) return null;
    const v = parseIntStrict(g(f));
    if (v === undefined) throw new Error(`${FIELDS[kind][f]}: "${g(f)}" is not a whole number`);
    return v; // blank stays null (missing), never 0
  };
  const cust = () => ({ provider_customer_id: norm(g('provider_customer_id')), name: norm(g('customer_name')), email: crm.normEmail(g('customer_email')), phone: norm(g('customer_phone')), state: norm(g('customer_state')) });
  const pet = () => {
    const sp = g('species').toLowerCase();
    return { provider_pet_id: norm(g('provider_pet_id')), name: norm(g('pet_name')), species: sp === 'dog' || sp === 'cat' ? sp : null, species_raw: sp || null, breed: norm(g('breed')), age_as_recorded: norm(g('pet_age')) };
  };

  if (kind === 'ads') {
    const spend = moneyVal('spend', 1e6, true);
    if (spend < 0) throw new Error('Spend is negative');
    const currency = (mapping.currency ? g('currency') : o.currency).toUpperCase();
    if (!/^[A-Z]{3}$/.test(currency)) throw new Error('Currency must be a 3-letter code');
    const account = mapping.account_id ? g('account_id') : norm(o.account_id);
    if (!account) throw new Error('Account ID is blank');
    const sig = ['channel', 'network', 'placement'].filter((f) => mapping[f]).join('+') || 'none';
    const rec = {
      platform: o.platform, account_id: account, level: o.level, breakdown_signature: sig, channel: g('channel'), network: g('network'), placement: g('placement'),
      campaign_id: g('campaign_id'), campaign_name: norm(g('campaign_name')), adset_id: g('adset_id'), adset_name: norm(g('adset_name')), ad_id: g('ad_id'), ad_name: norm(g('ad_name')),
      report_date: dateVal('report_date', true), currency, spend_micros: spend,
      impressions: intVal('impressions'), link_clicks: intVal('link_clicks'), all_clicks: intVal('all_clicks'),
    };
    // Rows with only names (no IDs) use the name as the identity; marked so it is visible.
    if (!rec.campaign_id && rec.campaign_name) rec.campaign_id = `name:${rec.campaign_name}`;
    if (!rec.adset_id && rec.adset_name) rec.adset_id = `name:${rec.adset_name}`;
    if (!rec.ad_id && rec.ad_name) rec.ad_id = `name:${rec.ad_name}`;
    return rec;
  }
  if (kind === 'quotes') {
    const c = cust(); const p = pet();
    const touch = (g('utm_source') || g('utm_medium') || g('utm_campaign')) ? { utm_source: norm(g('utm_source')), utm_medium: norm(g('utm_medium')), utm_campaign: norm(g('utm_campaign')), utm_content: norm(g('utm_content')) } : null;
    return {
      customer: c, pet: p.name || p.provider_pet_id ? p : null, provider_quote_id: norm(g('provider_quote_id')), quote_date: dateVal('quote_date', true),
      premium_cents: moneyVal('premium', 100, false), payment_frequency: norm(g('payment_frequency')), quote_status: norm(g('quote_status')) || 'generated',
      coverage: Object.fromEntries((o.coverage_columns || []).filter((h) => h in raw).map((h) => [h, raw[h]])), touch,
    };
  }
  if (kind === 'policies') {
    const status = g('policy_status');
    const issuedByRule = o.issued_rule === 'all' || (o.issued_values || []).map((s) => s.toLowerCase()).includes(status.toLowerCase());
    const issue = dateVal('issue_date', false);
    if (issuedByRule && !issue) throw new Error('This row is an issued policy but has no issue date');
    return {
      customer: cust(), pet: pet().name || pet().provider_pet_id ? pet() : null, policy_number: g('policy_number'), carrier: mapping.carrier ? g('carrier') : norm(o.carrier),
      is_issued: issuedByRule ? 1 : 0, issue_date: issuedByRule ? issue : null, effective_date: dateVal('effective_date', false), status: norm(status),
      cancellation_date: dateVal('cancellation_date', false), premium_cents: moneyVal('premium', 100, false), payment_frequency: norm(g('payment_frequency')),
      claimed_provider_quote_id: norm(g('provider_quote_id')), coverage: Object.fromEntries((o.coverage_columns || []).filter((h) => h in raw).map((h) => [h, raw[h]])),
    };
  }
  if (kind === 'commissions') {
    let amount = moneyVal('amount', 100, true);
    if (amount === 0) throw new Error('Amount is zero');
    let type;
    if (o.sign_convention === 'signed') {
      type = amount > 0 ? 'receipt' : 'reversal';
    } else {
      const t = g('txn_type').toLowerCase();
      const inList = (k) => (o[`${k}_values`] || []).map((s) => s.toLowerCase()).includes(t);
      const hits = ['receipt', 'reversal', 'adjustment'].filter(inList);
      if (hits.length !== 1) throw new Error(`Transaction type "${g('txn_type')}" is not listed (or is listed twice) in your type mapping`);
      type = hits[0];
      if (o.amount_sign === 'absolute') {
        if (type === 'adjustment') throw new Error('Adjustment direction is ambiguous when amounts are always positive');
        amount = type === 'reversal' ? -Math.abs(amount) : Math.abs(amount);
      } else if (type === 'receipt' && amount < 0) throw new Error('Receipt has a negative amount — check the sign convention');
      else if (type === 'reversal' && amount > 0) throw new Error('Reversal has a positive amount — check the sign convention');
    }
    return {
      type, amount_cents: amount, currency: o.currency.toUpperCase(), txn_date: dateVal('txn_date', true), policy_number: norm(g('policy_number')),
      carrier: mapping.carrier ? norm(g('carrier')) : norm(o.carrier), statement_ref: mapping.statement_ref ? norm(g('statement_ref')) : norm(o.statement_ref), raw,
    };
  }
  throw new Error('Unknown import kind');
}

// ---------------------------------------------------------------------------------------------------
// Applying one normalised row. Same code for preview (rolled back) and commit.
// ---------------------------------------------------------------------------------------------------
function reviewItem(db, kind, importId, rowNumber, reason, payload) {
  const key = sha(`${kind}|${JSON.stringify(payload)}`);
  const r = db.prepare('INSERT OR IGNORE INTO review_items(kind,import_id,row_number,reason,payload_json,dedupe_key,created_at) VALUES (?,?,?,?,?,?,?)')
    .run(kind, importId, rowNumber, reason, JSON.stringify(payload), key, now());
  return { action: 'review', message: reason, isNew: r.changes > 0 };
}

// Returns { customerId } | { review: reason }
function resolveCustomer(db, c, forced) {
  if (forced && forced.customerId) { crm.fillCustomerBlanks(db, forced.customerId, c); return { customerId: forced.customerId }; }
  if (forced && forced.createNew) {
    const emailTaken = c.email && db.prepare('SELECT 1 FROM customers WHERE email = ?').get(c.email);
    const pidTaken = c.provider_customer_id && db.prepare('SELECT 1 FROM customers WHERE provider_customer_id = ?').get(c.provider_customer_id);
    const id = crm.createCustomer(db, { ...c, email: emailTaken ? null : c.email, provider_customer_id: pidTaken ? null : c.provider_customer_id });
    if (emailTaken || pidTaken) db.prepare('UPDATE customers SET identity_note=? WHERE id=?').run('Created as a separate person during review although an identifier matched another record.', id);
    return { customerId: id, created: true };
  }
  const m = crm.matchCustomer(db, c);
  if (m.status === 'match') { crm.fillCustomerBlanks(db, m.customer.id, c); return { customerId: m.customer.id }; }
  if (m.status === 'conflict') return { review: m.reason };
  if (m.status === 'no_identifier') return { review: 'No email or provider customer ID on this row, so the customer cannot be matched safely.' };
  return { customerId: crm.createCustomer(db, c), created: true };
}

function resolvePet(db, customerId, p) {
  if (!p) return { id: null };
  const r = crm.findOrCreatePet(db, customerId, p);
  return r;
}

function applyQuote(db, importId, v, rowNumber, forced) {
  const cr = resolveCustomer(db, v.customer, forced);
  if (cr.review) return reviewItem(db, 'customer_match', importId, rowNumber, cr.review, { kind: 'quotes', values: v });
  const pr = resolvePet(db, cr.customerId, v.pet);
  if (pr.conflict) return reviewItem(db, 'customer_match', importId, rowNumber, pr.conflict, { kind: 'quotes', values: v });
  const key = crm.quoteDedupeKey('fetch', v.provider_quote_id, [cr.customerId, pr.id, v.quote_date, v.premium_cents]);
  const existing = db.prepare('SELECT * FROM quotes WHERE dedupe_key = ?').get(key);
  if (existing) {
    if (existing.customer_id !== cr.customerId) return reviewItem(db, 'customer_match', importId, rowNumber, `Quote ID ${v.provider_quote_id} is already stored under a different customer.`, { kind: 'quotes', values: v });
    if (existing.status !== v.quote_status) { db.prepare('UPDATE quotes SET status=?, updated_at=? WHERE id=?').run(v.quote_status, now(), existing.id); return { action: 'updated' }; }
    return { action: 'unchanged' };
  }
  let snapshot = { touches: [], note: 'Imported without attribution data' };
  if (v.touch) {
    const cls = classifyVisit({ ...v.touch, click_ids: {}, referrer: null });
    snapshot = { touches: [{ at: `${v.quote_date}T00:00:00.000Z`, source_type: cls.source_type, platform: cls.platform, utm_source: v.touch.utm_source, utm_medium: v.touch.utm_medium, campaign_ref: v.touch.utm_campaign, ad_ref: v.touch.utm_content }], note: 'From UTM columns in the imported report' };
  }
  const t = now();
  db.prepare(`INSERT INTO quotes(customer_id,pet_id,provider,provider_quote_id,dedupe_key,quoted_at,quoted_date,premium_cents,payment_frequency,coverage_json,status,attribution_snapshot_json,source,import_id,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(cr.customerId, pr.id, 'fetch', v.provider_quote_id, key, `${v.quote_date}T00:00:00.000Z`, v.quote_date, v.premium_cents, v.payment_frequency, JSON.stringify(v.coverage || {}), v.quote_status, JSON.stringify(snapshot), 'import', importId, t, t);
  relinkPolicies(db);
  return { action: 'created' };
}

// Link a policy to its originating quote only through the provider quote ID the policy report itself named.
function relinkPolicies(db) {
  db.exec(`UPDATE policies SET quote_id = (SELECT q.id FROM quotes q WHERE q.provider='fetch' AND q.provider_quote_id = policies.claimed_provider_quote_id AND q.customer_id = policies.customer_id),
      quote_link_basis = 'provider_quote_id'
    WHERE quote_id IS NULL AND claimed_provider_quote_id IS NOT NULL
      AND EXISTS (SELECT 1 FROM quotes q WHERE q.provider='fetch' AND q.provider_quote_id = policies.claimed_provider_quote_id AND q.customer_id = policies.customer_id)`);
}

function applyPolicy(db, importId, v, rowNumber, forced) {
  const cr = resolveCustomer(db, v.customer, forced);
  if (cr.review) return reviewItem(db, 'policy_customer', importId, rowNumber, cr.review, { kind: 'policies', values: v });
  const pr = resolvePet(db, cr.customerId, v.pet);
  if (pr.conflict) return reviewItem(db, 'policy_customer', importId, rowNumber, pr.conflict, { kind: 'policies', values: v });
  const existing = db.prepare('SELECT * FROM policies WHERE carrier = ? AND policy_number = ?').get(v.carrier, v.policy_number);
  const t = now();
  if (existing) {
    if (existing.customer_id !== cr.customerId) return reviewItem(db, 'policy_customer', importId, rowNumber, `Policy ${v.policy_number} is already stored under a different customer.`, { kind: 'policies', values: v });
    const next = { is_issued: v.is_issued, issue_date: v.issue_date, effective_date: v.effective_date, status: v.status, cancellation_date: v.cancellation_date, premium_cents: v.premium_cents, payment_frequency: v.payment_frequency };
    // Never erase a stored value with a blank from a later report.
    const changed = Object.entries(next).filter(([k, val]) => val !== null && val !== existing[k]);
    if (!changed.length) return { action: 'unchanged' };
    db.prepare(`UPDATE policies SET ${changed.map(([k]) => `${k}=?`).join(',')}, updated_at=? WHERE id=?`).run(...changed.map(([, val]) => val), t, existing.id);
    return { action: 'updated' };
  }
  db.prepare(`INSERT INTO policies(customer_id,pet_id,claimed_provider_quote_id,carrier,policy_number,is_issued,issue_date,effective_date,status,premium_cents,payment_frequency,coverage_json,cancellation_date,expected_commission_cents,source,import_id,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(cr.customerId, pr.id, v.claimed_provider_quote_id, v.carrier, v.policy_number, v.is_issued, v.issue_date, v.effective_date, v.status, v.premium_cents, v.payment_frequency, JSON.stringify(v.coverage || {}), v.cancellation_date, 15000, 'import', importId, t, t);
  relinkPolicies(db);
  rematchCommissions(db);
  return { action: 'created' };
}

// Match unmatched statement lines to policies by EXACT policy number only (and only when exactly one policy has it).
function rematchCommissions(db) {
  const rows = db.prepare("SELECT id, statement_policy_ref FROM commission_transactions WHERE match_status='unmatched' AND statement_policy_ref IS NOT NULL").all();
  let n = 0;
  for (const r of rows) {
    const p = db.prepare('SELECT id FROM policies WHERE policy_number = ?').all(r.statement_policy_ref);
    if (p.length === 1) { db.prepare("UPDATE commission_transactions SET policy_id=?, match_status='matched' WHERE id=?").run(p[0].id, r.id); n += 1; }
  }
  return n;
}

function applyCommission(db, importId, v, rowNumber, occ) {
  const key = sha([v.statement_ref, v.policy_number, v.txn_date, v.amount_cents, v.type, occ].join('|'));
  if (db.prepare('SELECT 1 FROM commission_transactions WHERE dedupe_key = ?').get(key)) return { action: 'unchanged' };
  let policyId = null; let status = 'unmatched'; let note;
  if (v.policy_number) {
    const q = v.carrier ? db.prepare('SELECT id FROM policies WHERE policy_number=? AND carrier=?').all(v.policy_number, v.carrier) : db.prepare('SELECT id FROM policies WHERE policy_number=?').all(v.policy_number);
    if (q.length === 1) { policyId = q[0].id; status = 'matched'; } else note = q.length ? 'ambiguous policy number' : 'policy not found';
  } else note = 'no policy number on statement line';
  db.prepare(`INSERT INTO commission_transactions(policy_id,type,amount_cents,currency,txn_date,statement_ref,statement_policy_ref,match_status,dedupe_key,raw_json,import_id,created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).run(policyId, v.type, v.amount_cents, v.currency, v.txn_date, v.statement_ref, v.policy_number, status, key, JSON.stringify(v.raw), importId, now());
  return { action: 'created', message: note };
}

function applyAd(db, importId, v) {
  const cols = ['platform', 'account_id', 'level', 'breakdown_signature', 'channel', 'network', 'placement', 'campaign_id', 'adset_id', 'ad_id', 'report_date', 'currency'];
  const where = cols.map((c) => `${c} = ?`).join(' AND ');
  const existing = db.prepare(`SELECT * FROM ad_records WHERE ${where}`).get(...cols.map((c) => v[c]));
  const metricFields = ['spend_micros', 'impressions', 'link_clicks', 'all_clicks'];
  return { existing, metricFields, where, cols };
}

function applyAdRow(db, importId, v, o) {
  const { existing } = applyAd(db, importId, v);
  const extra = {
    campaign_name: v.campaign_name, adset_name: v.adset_name, ad_name: v.ad_name,
    link_click_metric: v.link_clicks != null ? o.link_click_metric : null, link_click_definition: v.link_clicks != null ? o.link_click_definition : null,
    all_click_metric: v.all_clicks != null ? o.all_click_metric : null, reporting_timezone: o.reporting_timezone.trim(),
  };
  if (existing) {
    const cmp = { spend_micros: v.spend_micros, impressions: v.impressions, link_clicks: v.link_clicks, all_clicks: v.all_clicks, reporting_timezone: extra.reporting_timezone };
    const diff = Object.entries(cmp).filter(([k, val]) => val !== existing[k]);
    if (!diff.length) return { action: 'unchanged' };
    db.prepare(`UPDATE ad_records SET spend_micros=?, impressions=?, link_clicks=?, all_clicks=?, campaign_name=?, adset_name=?, ad_name=?, link_click_metric=?, link_click_definition=?, all_click_metric=?, reporting_timezone=?, provenance='import', import_id=?, synced_at=? WHERE id=?`)
      .run(v.spend_micros, v.impressions, v.link_clicks, v.all_clicks, extra.campaign_name, extra.adset_name, extra.ad_name, extra.link_click_metric, extra.link_click_definition, extra.all_click_metric, extra.reporting_timezone, importId, now(), existing.id);
    return { action: 'updated' };
  }
  db.prepare(`INSERT INTO ad_records(platform,account_id,level,breakdown_signature,channel,network,placement,campaign_id,campaign_name,adset_id,adset_name,ad_id,ad_name,report_date,currency,spend_micros,impressions,link_clicks,link_click_metric,link_click_definition,all_clicks,all_click_metric,reporting_timezone,provenance,import_id,synced_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(v.platform, v.account_id, v.level, v.breakdown_signature, v.channel, v.network, v.placement, v.campaign_id, v.campaign_name, v.adset_id, v.adset_name, v.ad_id, v.ad_name,
    v.report_date, v.currency, v.spend_micros, v.impressions, v.link_clicks, extra.link_click_metric, extra.link_click_definition, v.all_clicks, extra.all_click_metric, extra.reporting_timezone, 'import', importId, now());
  return { action: 'created' };
}

// ---------------------------------------------------------------------------------------------------
// Orchestration
// ---------------------------------------------------------------------------------------------------
async function stage(db, kind, filename, buf) {
  if (!FIELDS[kind]) throw Object.assign(new Error('Unknown import type'), { status: 400 });
  const { headers, rows } = await parseUpload(buf, filename);
  const hash = crypto.createHash('sha256').update(buf).digest('hex');
  const dup = db.prepare("SELECT id, committed_at FROM imports WHERE file_sha256 = ? AND kind = ? AND status='committed' ORDER BY id DESC").get(hash, kind);
  const id = tx(db, () => {
    const r = db.prepare("INSERT INTO imports(kind,filename,file_sha256,status,headers_json,rows_total,created_at) VALUES (?,?,?,?,?,?,?)").run(kind, filename.slice(0, 200), hash, 'staged', JSON.stringify(headers), rows.length, now());
    const importId = Number(r.lastInsertRowid);
    const ins = db.prepare('INSERT INTO import_rows(import_id,row_number,data_json) VALUES (?,?,?)');
    rows.forEach((row, i) => ins.run(importId, i + 2, JSON.stringify(row))); // row 2 = first data row in the spreadsheet
    return importId;
  });
  return { importId: id, headers, sample: rows.slice(0, 5), rowCount: rows.length, fields: FIELDS[kind], required: REQUIRED[kind], suggested: suggestMapping(kind, headers), alreadyImportedAs: dup ? { importId: dup.id, at: dup.committed_at } : null };
}

function processAll(db, imp, mapping, options) {
  const rows = db.prepare('SELECT row_number, data_json FROM import_rows WHERE import_id = ? ORDER BY row_number').all(imp.id);
  const counts = { created: 0, updated: 0, unchanged: 0, review: 0, error: 0 };
  const errors = []; const samples = []; const notes = {};
  const seenOcc = new Map();
  const dist = { status: {}, frequency: {}, types: {} };
  let totals = { receipt: 0, reversal: 0, adjustment: 0 };
  for (const r of rows) {
    const raw = JSON.parse(r.data_json);
    let res;
    try {
      const v = normalizeRow(imp.kind, raw, mapping, options);
      if (imp.kind === 'quotes') { res = applyQuote(db, imp.id, v, r.row_number); if (v.payment_frequency) dist.frequency[v.payment_frequency] = (dist.frequency[v.payment_frequency] || 0) + 1; }
      else if (imp.kind === 'policies') { res = applyPolicy(db, imp.id, v, r.row_number); if (v.status) dist.status[v.status] = (dist.status[v.status] || 0) + 1; if (v.payment_frequency) dist.frequency[v.payment_frequency] = (dist.frequency[v.payment_frequency] || 0) + 1; }
      else if (imp.kind === 'commissions') {
        const content = [v.statement_ref, v.policy_number, v.txn_date, v.amount_cents, v.type].join('|');
        const occ = (seenOcc.get(content) || 0) + 1; seenOcc.set(content, occ);
        res = applyCommission(db, imp.id, v, r.row_number, occ);
        totals[v.type] += v.amount_cents; dist.types[v.type] = (dist.types[v.type] || 0) + 1;
      } else res = applyAdRow(db, imp.id, v, options);
    } catch (e) {
      res = { action: 'error', message: e.message };
    }
    counts[res.action] += 1;
    if (res.action === 'error') errors.push({ row: r.row_number, message: res.message });
    if (res.message && res.action !== 'error') notes[res.message] = (notes[res.message] || 0) + 1;
    if (samples.length < 15) samples.push({ row: r.row_number, action: res.action, message: res.message || null });
  }
  return { counts, errors, samples, notes, distinct: dist, commissionTotalsCents: imp.kind === 'commissions' ? totals : undefined, total: rows.length };
}

class RollbackPreview extends Error {}

function run(db, importId, mapping, options, commit) {
  const imp = db.prepare('SELECT * FROM imports WHERE id = ?').get(importId);
  if (!imp) throw Object.assign(new Error('Import not found'), { status: 404 });
  if (imp.status === 'committed') throw Object.assign(new Error('This import was already committed. Upload the file again to re-import it (nothing will be duplicated).'), { status: 409 });
  const optErrors = validateOptions(imp.kind, mapping, options || {});
  if (optErrors.length) return { ok: false, problems: optErrors };
  let result;
  try {
    result = tx(db, () => {
      const res = processAll(db, imp, mapping, options);
      if (!commit) throw Object.assign(new RollbackPreview('preview'), { res });
      db.prepare('DELETE FROM import_errors WHERE import_id = ?').run(imp.id);
      const ins = db.prepare('INSERT INTO import_errors(import_id,row_number,message) VALUES (?,?,?)');
      res.errors.forEach((e) => ins.run(imp.id, e.row, e.message));
      db.prepare("UPDATE imports SET status='committed', mapping_json=?, options_json=?, rows_created=?, rows_updated=?, rows_unchanged=?, rows_errored=?, rows_review=?, committed_at=? WHERE id=?")
        .run(JSON.stringify(mapping), JSON.stringify(options), res.counts.created, res.counts.updated, res.counts.unchanged, res.counts.error, res.counts.review, now(), imp.id);
      db.prepare('DELETE FROM import_rows WHERE import_id = ?').run(imp.id); // staged rows are no longer needed
      return res;
    });
  } catch (e) {
    if (e instanceof RollbackPreview) return { ok: true, preview: true, ...e.res };
    throw e;
  }
  return { ok: true, preview: false, ...result };
}

module.exports = { FIELDS, REQUIRED, stage, run, suggestMapping, validateOptions, normalizeRow, rematchCommissions, relinkPolicies, applyQuote, applyPolicy, resolveCustomer };
