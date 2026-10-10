'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const ExcelJS = require('exceljs');
const { start, csvBuf } = require('./helpers');
const reports = require('../src/reports');

async function upload(t, kind, rows, name = 'f.csv') {
  const r = await t.call('POST', `/api/imports/upload?kind=${kind}`, undefined, { raw: csvBuf(rows), headers: { 'X-Filename': name, 'Content-Type': 'application/octet-stream' } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return r.body;
}
async function runImport(t, kind, rows, mapping, options, commit = true) {
  const st = await upload(t, kind, rows);
  const r = await t.call('POST', `/api/imports/${st.importId}/${commit ? 'commit' : 'preview'}`, { mapping, options });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return r.body;
}
const count = (t, table) => t.db.prepare(`SELECT COUNT(*) n FROM ${table}`).get().n;
const setup = async () => { const t = await start(); await t.login(); t.setSetting('reporting_timezone', 'UTC'); t.setSetting('reporting_currency', 'USD'); return t; };

const AD_MAP = { report_date: 'Date', spend: 'Spend', impressions: 'Impr', link_clicks: 'LinkClicks', campaign_id: 'CampId', campaign_name: 'Camp', ad_id: 'AdId' };
const AD_OPT = { platform: 'meta', level: 'ad', account_id: 'acct1', currency: 'USD', reporting_timezone: 'America/New_York', date_format: 'iso', link_click_metric: 'inline_link_clicks', link_click_definition: 'fixture definition' };

test('advertising import: preview saves nothing; commit saves; re-import creates no duplicates', async () => {
  const t = await setup();
  const rows = [['Date', 'Spend', 'Impr', 'LinkClicks', 'CampId', 'Camp', 'AdId'], ['2026-03-01', '100.50', '5000', '100', 'c1', 'Camp One', 'a1'], ['2026-03-01', '199.50', '5000', '100', 'c1', 'Camp One', 'a2']];
  const pv = await runImport(t, 'ads', rows, AD_MAP, AD_OPT, false);
  assert.equal(pv.preview, true); assert.equal(count(t, 'ad_records'), 0);
  const c1 = await runImport(t, 'ads', rows, AD_MAP, AD_OPT);
  assert.equal(c1.counts.created, 2); assert.equal(count(t, 'ad_records'), 2);
  const c2 = await runImport(t, 'ads', rows, AD_MAP, AD_OPT);
  assert.equal(c2.counts.created, 0); assert.equal(c2.counts.unchanged, 2); assert.equal(count(t, 'ad_records'), 2);
  const s = reports.summary(t.db, { from: '2026-03-01', to: '2026-03-31' });
  assert.equal(s.calendar.advertising.spend, 300); assert.equal(s.calendar.advertising.ctr.value, 2); assert.equal(s.calendar.advertising.cpc.value, 1.5);
  await t.close();
});

test('overlapping campaign-level and ad-level files do not double count spend', async () => {
  const t = await setup();
  await runImport(t, 'ads', [['Date', 'Spend', 'Impr', 'LinkClicks', 'CampId', 'Camp', 'AdId'], ['2026-03-01', '300', '10000', '200', 'c1', 'C', 'a1']], AD_MAP, AD_OPT);
  await runImport(t, 'ads', [['Date', 'Spend', 'Impr', 'LinkClicks', 'CampId', 'Camp'], ['2026-03-01', '300', '10000', '200', 'c1', 'C']], { ...AD_MAP, ad_id: undefined }, { ...AD_OPT, level: 'campaign' });
  assert.equal(count(t, 'ad_records'), 2);
  assert.equal(reports.summary(t.db, { from: '2026-03-01', to: '2026-03-31' }).calendar.advertising.spend, 300);
  await t.close();
});

test('missing click metadata and unreadable values produce clear problems/row errors; blanks are not zero', async () => {
  const t = await setup();
  const st = await upload(t, 'ads', [['Date', 'Spend', 'Impr', 'LinkClicks', 'CampId'], ['2026-03-01', '10', '', '', 'c1'], ['bad', '10', '1', '1', 'c1'], ['2026-03-02', 'abc', '1', '1', 'c1']]);
  const noMeta = await t.call('POST', `/api/imports/${st.importId}/preview`, { mapping: AD_MAP, options: { ...AD_OPT, link_click_metric: '' } });
  assert.equal(noMeta.body.ok, false); assert.ok(noMeta.body.problems.some((p) => /link-click metric/.test(p)));
  const r = await t.call('POST', `/api/imports/${st.importId}/commit`, { mapping: { ...AD_MAP, ad_id: undefined }, options: { ...AD_OPT, level: 'campaign' } });
  assert.equal(r.body.counts.created, 1); assert.equal(r.body.counts.error, 2);
  const row = t.db.prepare('SELECT impressions, link_clicks FROM ad_records').get();
  assert.equal(row.impressions, null); assert.equal(row.link_clicks, null);
  const s = reports.summary(t.db, { from: '2026-03-01', to: '2026-03-31' });
  assert.equal(s.calendar.advertising.ctr.value, null); assert.equal(s.calendar.advertising.impressions, null);
  await t.close();
});

const Q_MAP = { provider_customer_id: 'CustId', customer_name: 'Name', customer_email: 'Email', pet_name: 'Pet', species: 'Species', provider_quote_id: 'QuoteId', quote_date: 'QuoteDate', premium: 'Premium', payment_frequency: 'Freq' };
const Q_OPT = { date_format: 'iso' };
const QH = ['CustId', 'Name', 'Email', 'Pet', 'Species', 'QuoteId', 'QuoteDate', 'Premium', 'Freq'];

test('quote import: multiple pets and repeat quotes keep one customer; re-import adds nothing; counts follow range', async () => {
  const t = await setup();
  const rows = [QH,
    ['C1', 'Ann Lee', 'ann@example.test', 'Rex', 'dog', 'Q1', '2026-01-10', '40.00', 'monthly'],
    ['C1', 'Ann Lee', 'ann@example.test', 'Tom', 'cat', 'Q2', '2026-01-10', '30.00', 'monthly'],
    ['C1', 'Ann Lee', 'ann@example.test', 'Rex', 'dog', 'Q3', '2026-02-05', '42.00', 'monthly'],
    ['C2', 'Bob Ray', 'bob@example.test', 'Fido', 'dog', 'Q4', '2026-02-06', '50.00', 'monthly']];
  await runImport(t, 'quotes', rows, Q_MAP, Q_OPT);
  assert.equal(count(t, 'customers'), 2); assert.equal(count(t, 'pets'), 3); assert.equal(count(t, 'quotes'), 4);
  const again = await runImport(t, 'quotes', rows, Q_MAP, Q_OPT);
  assert.equal(again.counts.created, 0); assert.equal(count(t, 'quotes'), 4); assert.equal(count(t, 'customers'), 2);
  const jan = reports.summary(t.db, { from: '2026-01-01', to: '2026-01-31' }).calendar;
  const feb = reports.summary(t.db, { from: '2026-02-01', to: '2026-02-28' }).calendar;
  const both = reports.summary(t.db, { from: '2026-01-01', to: '2026-02-28' }).calendar;
  assert.equal(jan.quotedCustomers, 1); assert.equal(feb.quotedCustomers, 2);
  assert.equal(both.quotedCustomers, 2); // Ann appears in both months: 1 + 2 would be 3
  assert.equal(both.quoteEvents, 4);
  await t.close();
});

test('customers are never merged by name; conflicting or missing identifiers go to review', async () => {
  const t = await setup();
  await runImport(t, 'quotes', [QH, ['C1', 'Sam Smith', 'sam1@example.test', 'A', 'dog', 'Q1', '2026-01-10', '40', 'monthly']], Q_MAP, Q_OPT);
  const r = await runImport(t, 'quotes', [QH,
    ['C9', 'Sam Smith', 'sam2@example.test', 'B', 'cat', 'Q2', '2026-01-11', '40', 'monthly'], // same name, different identifiers -> separate customer
    ['C1', 'Sam Smith', 'other@example.test', 'A', 'dog', 'Q3', '2026-01-12', '40', 'monthly'], // provider id C1 with a different email -> conflict
    ['', 'No Ident', '', 'C', 'dog', 'Q4', '2026-01-12', '40', 'monthly']], Q_MAP, Q_OPT);
  assert.equal(count(t, 'customers'), 2); assert.equal(r.counts.created, 1); assert.equal(r.counts.review, 2);
  const rv = await t.call('GET', '/api/review');
  assert.equal(rv.body.items.length, 2);
  // resolve the conflict by linking to the existing customer
  const item = rv.body.items.find((i) => /different email/.test(i.reason));
  const first = t.db.prepare("SELECT id FROM customers WHERE provider_customer_id='C1'").get().id;
  const res = await t.call('POST', `/api/review/${item.id}/resolve`, { action: 'link', customer_id: first });
  assert.equal(res.status, 200); assert.equal(count(t, 'quotes'), 3);
  await t.close();
});

const P_MAP = { provider_customer_id: 'CustId', customer_name: 'Name', customer_email: 'Email', pet_name: 'Pet', species: 'Species', policy_number: 'Policy', policy_status: 'Status', issue_date: 'Issued', cancellation_date: 'Cancelled', provider_quote_id: 'QuoteId' };
const PH = ['CustId', 'Name', 'Email', 'Pet', 'Species', 'Policy', 'Status', 'Issued', 'Cancelled', 'QuoteId'];
const P_OPT = { date_format: 'iso', carrier: 'Fetch', issued_rule: 'status_values', issued_values: ['Active', 'Cancelled'] };

test('policies: payment-pending is not issued; policy uses its verified originating quote; unknown stays Unknown; re-import safe', async () => {
  const t = await setup();
  t.setSetting('attribution_lookback_days', '30'); t.setSetting('direct_rule', 'direct_does_not_replace');
  await runImport(t, 'quotes', [QH,
    ['C1', 'Ann', 'ann@example.test', 'Rex', 'dog', 'Q1', '2026-01-10', '40', 'monthly'],
    ['C1', 'Ann', 'ann@example.test', 'Rex', 'dog', 'Q2', '2026-01-20', '41', 'monthly'],
    ['C2', 'Bob', 'bob@example.test', 'Fido', 'dog', 'Q4', '2026-01-21', '50', 'monthly']], Q_MAP, Q_OPT);
  const rows = [PH,
    ['C1', 'Ann', 'ann@example.test', 'Rex', 'dog', 'POL1', 'Active', '2026-02-01', '', 'Q1'], // verified link to Q1 (not the latest quote)
    ['C2', 'Bob', 'bob@example.test', 'Fido', 'dog', 'POL2', 'Active', '2026-02-02', '', ''], // no quote id -> Unknown, even though Bob has Q4
    ['C2', 'Bob', 'bob@example.test', 'Fido', 'dog', 'POL3', 'PaymentPending', '', '', 'Q4']]; // not issued
  const r = await runImport(t, 'policies', rows, P_MAP, P_OPT);
  assert.equal(r.counts.created, 3);
  const q1 = t.db.prepare("SELECT id FROM quotes WHERE provider_quote_id='Q1'").get().id;
  assert.equal(t.db.prepare("SELECT quote_id FROM policies WHERE policy_number='POL1'").get().quote_id, q1);
  assert.equal(t.db.prepare("SELECT quote_id FROM policies WHERE policy_number='POL2'").get().quote_id, null);
  const again = await runImport(t, 'policies', rows, P_MAP, P_OPT);
  assert.equal(again.counts.created, 0); assert.equal(count(t, 'policies'), 3);
  const s = reports.summary(t.db, { from: '2026-02-01', to: '2026-02-28' });
  assert.equal(s.calendar.issuedPolicies, 2); assert.equal(s.calendar.buyingCustomers, 2);
  assert.equal(s.calendar.commission.expectedOriginalCents, 30000);
  assert.equal(s.unattributed.issuedPoliciesWithUnknownOriginatingQuote, 1);
  // a status change on re-import updates, and cancellation keeps the original expected commission
  const canc = [PH, ['C1', 'Ann', 'ann@example.test', 'Rex', 'dog', 'POL1', 'Cancelled', '2026-02-01', '2026-03-01', 'Q1']];
  const up = await runImport(t, 'policies', canc, P_MAP, P_OPT);
  assert.equal(up.counts.updated, 1);
  const s2 = reports.summary(t.db, { from: '2026-02-01', to: '2026-02-28' }).calendar;
  assert.equal(s2.issuedPolicies, 2); assert.equal(s2.issuedPoliciesCancelledSoFar, 1); assert.equal(s2.commission.expectedOriginalCents, 30000);
  await t.close();
});

test('quote in January, policy in February: calendar views separate; acquisition group follows the customer', async () => {
  const t = await setup();
  await runImport(t, 'quotes', [QH, ['C1', 'Ann', 'ann@example.test', 'Rex', 'dog', 'Q1', '2026-01-10', '40', 'monthly']], Q_MAP, Q_OPT);
  await runImport(t, 'policies', [PH, ['C1', 'Ann', 'ann@example.test', 'Rex', 'dog', 'POL1', 'Active', '2026-02-01', '', 'Q1']], P_MAP, P_OPT);
  const jan = reports.summary(t.db, { from: '2026-01-01', to: '2026-01-31' }).calendar;
  const feb = reports.summary(t.db, { from: '2026-02-01', to: '2026-02-28' }).calendar;
  assert.deepEqual([jan.quotedCustomers, jan.issuedPolicies, feb.quotedCustomers, feb.issuedPolicies], [1, 0, 0, 1]);
  const off = reports.acquisition(t.db, { from: '2026-01-01', to: '2026-03-31' });
  assert.equal(off.enabled, false);
  for (const [k, v] of [['attribution_lookback_days', '30'], ['direct_rule', 'direct_does_not_replace'], ['acquisition_event', 'first_quote'], ['returning_customers', 'first_only'], ['acquisition_observation_end', '2026-02-15']]) t.setSetting(k, v);
  const on = reports.acquisition(t.db, { from: '2026-01-01', to: '2026-03-31' });
  assert.equal(on.enabled, true); assert.equal(on.rows.length, 1);
  assert.equal(on.rows[0].month, '2026-01'); assert.equal(on.rows[0].customers, 1); assert.equal(on.rows[0].buyingCustomers, 1); assert.equal(on.rows[0].bySource.unknown, 1);
  await t.close();
});

const C_MAP = { txn_date: 'Date', amount: 'Amount', policy_number: 'Policy', statement_ref: 'Stmt' };
const C_OPT = { date_format: 'iso', currency: 'USD', sign_convention: 'signed' };

test('commission: $600 receipts and a $150 reversal give $450 net; expected stays $600; re-import adds nothing', async () => {
  const t = await setup();
  await runImport(t, 'policies', [PH, ...[1, 2, 3, 4].map((n) => ['C' + n, 'P' + n, `p${n}@example.test`, 'Pet', 'dog', 'POL' + n, 'Active', '2026-02-01', '', ''])], P_MAP, P_OPT);
  const rows = [['Date', 'Amount', 'Policy', 'Stmt'], ['2026-03-05', '150.00', 'POL1', 'S1'], ['2026-03-05', '150.00', 'POL2', 'S1'], ['2026-03-05', '150.00', 'POL3', 'S1'], ['2026-03-05', '150.00', 'POL4', 'S1'], ['2026-04-05', '-150.00', 'POL4', 'S2']];
  const r = await runImport(t, 'commissions', rows, C_MAP, C_OPT);
  assert.equal(r.counts.created, 5);
  const again = await runImport(t, 'commissions', rows, C_MAP, C_OPT);
  assert.equal(again.counts.created, 0); assert.equal(count(t, 'commission_transactions'), 5);
  const c = reports.summary(t.db, { from: '2026-01-01', to: '2026-12-31' }).calendar.commission;
  assert.equal(c.grossReceiptsCents, 60000); assert.equal(c.reversalsCents, -15000); assert.equal(c.netReceivedCents, 45000); assert.equal(c.expectedOriginalCents, 60000);
  await t.close();
});

test('commission: identical lines within one file are kept; partial and unmatched lump sums stay out of policy balances', async () => {
  const t = await setup();
  await runImport(t, 'policies', [PH, ['C1', 'A', 'a@example.test', 'Pet', 'dog', 'POL1', 'Active', '2026-02-01', '', '']], P_MAP, P_OPT);
  const rows = [['Date', 'Amount', 'Policy', 'Stmt'], ['2026-03-05', '75.00', 'POL1', 'S1'], ['2026-03-05', '75.00', 'POL1', 'S1'], ['2026-03-05', '999.00', '', 'S1'], ['2026-03-05', '20.00', 'NOPE', 'S1']];
  const r = await runImport(t, 'commissions', rows, C_MAP, C_OPT);
  assert.equal(r.counts.created, 4);
  const s = reports.summary(t.db, { from: '2026-01-01', to: '2026-12-31' }).calendar.commission;
  assert.equal(s.unmatchedCount, 2); assert.equal(s.unmatchedNetCents, 101900);
  assert.equal(s.outstanding.policiesIncluded, 1); assert.equal(s.outstanding.cents, 0); // 15000 expected - 2 x 7500 matched
  // later the policy NOPE arrives: exact-number match picks up the unmatched line, nothing else moves
  await runImport(t, 'policies', [PH, ['C2', 'B', 'b@example.test', 'Pet', 'dog', 'NOPE', 'Active', '2026-02-02', '', '']], P_MAP, P_OPT);
  assert.equal(t.db.prepare("SELECT match_status FROM commission_transactions WHERE statement_policy_ref='NOPE'").get().match_status, 'matched');
  assert.equal(t.db.prepare("SELECT COUNT(*) n FROM commission_transactions WHERE match_status='unmatched'").get().n, 1);
  await t.close();
});

test('commission sign conventions are validated and adjustments are not treated as receipts', async () => {
  const t = await setup();
  const rows = [['Date', 'Amount', 'Policy', 'Stmt', 'Type'], ['2026-03-05', '150', 'P1', 'S1', 'Commission'], ['2026-03-06', '150', 'P1', 'S1', 'Chargeback'], ['2026-03-07', '25', 'P1', 'S1', 'Bonus adj'], ['2026-03-08', '-5', 'P1', 'S1', 'Commission'], ['2026-03-09', '-12.50', 'P1', 'S1', 'Bonus adj']];
  const map = { ...C_MAP, txn_type: 'Type' };
  const opt = { date_format: 'iso', currency: 'USD', sign_convention: 'type_column', amount_sign: 'as_is', receipt_values: ['Commission'], reversal_values: ['Chargeback'], adjustment_values: ['Bonus adj'] };
  const r = await runImport(t, 'commissions', rows, map, opt);
  assert.equal(r.counts.created, 3); assert.equal(r.counts.error, 2); // 'Chargeback 150' and 'Commission -5' contradict their sign
  const abs = await runImport(t, 'commissions', [['Date', 'Amount', 'Policy', 'Stmt', 'Type'], ['2026-04-06', '150', 'P1', 'S9', 'Chargeback'], ['2026-04-07', '25', 'P1', 'S9', 'Bonus adj']], map, { ...opt, amount_sign: 'absolute' });
  assert.equal(abs.counts.created, 1); assert.equal(abs.counts.error, 1); // adjustment direction ambiguous when always positive
  const sum = reports.summary(t.db, { from: '2026-01-01', to: '2026-12-31' }).calendar.commission;
  assert.equal(sum.grossReceiptsCents, 15000); assert.equal(sum.adjustmentsCents, 1250); // +25.00 and -12.50, never counted as receipts
  assert.equal(sum.reversalsCents, -15000);
  await t.close();
});

test('bad uploads are rejected safely; XLSX works; exports neutralise spreadsheet formulas', async () => {
  const t = await setup();
  const fake = await t.call('POST', '/api/imports/upload?kind=ads', undefined, { raw: Buffer.from('PK\u0003\u0004zzzz'), headers: { 'X-Filename': 'x.csv', 'Content-Type': 'application/octet-stream' } });
  assert.equal(fake.status, 400);
  const exe = await t.call('POST', '/api/imports/upload?kind=ads', undefined, { raw: Buffer.from('a,b\n1,2'), headers: { 'X-Filename': 'x.exe', 'Content-Type': 'application/octet-stream' } });
  assert.equal(exe.status, 400);
  const wb = new ExcelJS.Workbook(); const ws = wb.addWorksheet('S');
  ws.addRow(['Date', 'Amount', 'Policy', 'Stmt']); ws.addRow([new Date(Date.UTC(2026, 2, 5)), 150, 'P1', 'S1']);
  const buf = Buffer.from(await wb.xlsx.writeBuffer());
  const up = await t.call('POST', '/api/imports/upload?kind=commissions', undefined, { raw: buf, headers: { 'X-Filename': 'm.xlsx', 'Content-Type': 'application/octet-stream' } });
  assert.equal(up.status, 200); assert.equal(up.body.rowCount, 1);
  const c = await t.call('POST', `/api/imports/${up.body.importId}/commit`, { mapping: C_MAP, options: C_OPT });
  assert.equal(c.body.counts.created, 1);
  assert.equal(t.db.prepare('SELECT txn_date FROM commission_transactions').get().txn_date, '2026-03-05');
  await t.call('POST', '/api/customers', { name: '=HYPERLINK("http://evil","x")', email: 'f@example.test' });
  const csv = await t.call('GET', '/api/export/customers.csv');
  assert.match(csv.body, /'=HYPERLINK/);
  await t.close();
});

test('paid metrics use only paid-attributed outcomes: organic and unknown never enter paid denominators; fixture ratios', async () => {
  const t = await setup();
  t.setSetting('attribution_lookback_days', '30'); t.setSetting('direct_rule', 'direct_does_not_replace');
  // $300 spend, 10,000 impressions, 200 link clicks on Meta
  await runImport(t, 'ads', [['Date', 'Spend', 'Impr', 'LinkClicks', 'CampId', 'Camp', 'AdId'], ['2026-03-10', '300', '10000', '200', 'c1', 'C', 'a1']], AD_MAP, AD_OPT);
  const { tx } = require('../src/db'); const crm = require('../src/crm');
  // 20 paid-attributed quoted customers, 3 buyers with 4 policies, plus 5 organic + 5 unknown quoted customers
  const mk = (i, snapshot) => {
    const cid = crm.createCustomer(t.db, { name: `Cust ${i}`, email: `c${i}@fixture.test` });
    const qid = Number(t.db.prepare("INSERT INTO quotes(customer_id,provider,provider_quote_id,dedupe_key,quoted_at,quoted_date,premium_cents,payment_frequency,status,attribution_snapshot_json,source,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)").run(cid, 'fetch', `F${i}`, `fetch|F${i}`, '2026-03-10T12:00:00.000Z', '2026-03-10', 4000, 'monthly', 'generated', JSON.stringify(snapshot), 'import', 'x', 'x').lastInsertRowid);
    return { cid, qid };
  };
  const paid = { touches: [{ at: '2026-03-09T00:00:00.000Z', source_type: 'paid', platform: 'meta', campaign_ref: 'c1', ad_ref: 'a1' }] };
  const organic = { touches: [{ at: '2026-03-09T00:00:00.000Z', source_type: 'organic', platform: null }] };
  const made = []; for (let i = 0; i < 20; i += 1) made.push(mk(i, paid));
  for (let i = 20; i < 25; i += 1) mk(i, organic);
  for (let i = 25; i < 30; i += 1) mk(i, { touches: [] });
  const pol = (m, n, num) => t.db.prepare("INSERT INTO policies(customer_id,quote_id,quote_link_basis,carrier,policy_number,is_issued,issue_date,status,expected_commission_cents,source,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)").run(m.cid, m.qid, 'provider_quote_id', 'Fetch', num, 1, '2026-03-12', 'Active', 15000, 'import', 'x', 'x');
  pol(made[0], 1, 'F-P1'); pol(made[0], 1, 'F-P2'); pol(made[1], 1, 'F-P3'); pol(made[2], 1, 'F-P4');
  const s = reports.summary(t.db, { from: '2026-03-01', to: '2026-03-31' });
  assert.equal(s.calendar.advertising.ctr.value, 2); assert.equal(s.calendar.advertising.cpc.value, 1.5);
  assert.equal(s.costs.costPerQuotedCustomer.value, 15);
  assert.equal(s.costs.costPerIssuedPolicy.value, 75);
  assert.equal(s.costs.costPerBuyingCustomer.value, 100);
  assert.equal(s.calendar.commission.expectedOriginalCents, 60000);
  assert.equal(s.calendar.quotedCustomers, 30); // all sources
  assert.equal(s.unattributed.quotedCustomersBySource.organic, 5); assert.equal(s.unattributed.quotedCustomersBySource.unknown, 5);
  // campaign / ad level rows
  const camp = s.byCampaign.find((c) => c.campaign_id === 'c1');
  assert.equal(camp.costPerQuotedCustomer.value, 15);
  const filtered = reports.summary(t.db, { from: '2026-03-01', to: '2026-03-31', platform: 'meta', campaign: 'c1', ad: 'a1' });
  assert.equal(filtered.costs.costPerBuyingCustomer.value, 100);
  const wrong = reports.summary(t.db, { from: '2026-03-01', to: '2026-03-31', platform: 'google' });
  assert.equal(wrong.costs.costPerQuotedCustomer.value, null); // no Google spend and no Google-attributed customers -> N/A, not 0
  await t.close();
});

test('statement with a title block, header on row 11, total and note rows: header auto-detected, totals skipped and reconciled, fixed date used', async () => {
  // SYNTHETIC layout fixture mimicking the shape of a real statement; all values are made up.
  const wb = new ExcelJS.Workbook(); const ws = wb.addWorksheet('Commissions Report');
  ws.addRow([]); ws.addRow([]);
  ws.addRow(['Phone: 000-000-0000', null, null, null, 'Commission Payable Statement: Sample Agency']);
  ws.addRow(['Fax: 000-000-0001', null, null, null, 'agent@example.invalid']);
  ws.addRow(['Email: support@example.invalid', null, null, null, 'Statement Month: July 2026']);
  ws.addRow([null, null, null, null, 'Date Sent: 09/15/2026']);
  ws.addRow([null, null, null, null, 'SAMPLE-CODE']);
  ws.addRow([]); ws.addRow([]); ws.addRow(['Commission Breakup']);
  ws.addRow(['Carrier', 'Organization', 'Agent', 'Insured Name', 'Policy#', 'Eff. Date', 'LOB', 'TransType', 'Premium', 'Rate %', 'Commission']);
  ws.addRow(['SampleCarrier', 'Sample Agency', 'agent@example.invalid', 'Sample Insured LLC', 'SAMPLE-POL-1', '10/17/2025', 'GL', 'New', 22.5, 12, 2.7]);
  ws.addRow(['SampleCarrier', 'Sample Agency', 'agent@example.invalid', 'Sample Insured 2', 'SAMPLE-POL-2', '11/01/2025', 'GL', 'New', 10, 10, 1.0]);
  ws.addRow(['', '', '', '', '', '', '', '', '', 'Total', 3.7]);
  ws.addRow([]); ws.addRow([]); ws.addRow(['Total Commission Payable: $3.70']);
  const buf = Buffer.from(await wb.xlsx.writeBuffer());
  const t = await setup();
  const up = await t.call('POST', '/api/imports/upload?kind=commissions', undefined, { raw: buf, headers: { 'X-Filename': 'stmt.xlsx', 'Content-Type': 'application/octet-stream' } });
  assert.equal(up.status, 200, JSON.stringify(up.body));
  assert.equal(up.body.headerRow, 11); assert.equal(up.body.rowCount, 2);
  assert.ok(up.body.preamble.some((p) => /Statement Month: July 2026/.test(p.text)));
  assert.equal(up.body.skipped.length, 2); assert.deepEqual(up.body.skipped.flatMap((s) => s.numbers).sort(), [370, 370]);
  const map = { amount: 'Commission', policy_number: 'Policy#', carrier: 'Carrier', txn_type: 'TransType' };
  const opt = { date_format: 'mdy', currency: 'USD', statement_ref: 'July 2026 statement', sign_convention: 'type_column', amount_sign: 'as_is', receipt_values: ['New'], reversal_values: ['Chargeback'] };
  const noDate = await t.call('POST', `/api/imports/${up.body.importId}/preview`, { mapping: map, options: opt });
  assert.equal(noDate.body.ok, false); assert.ok(noDate.body.problems.some((p) => /needs a date/.test(p)));
  const pv = await t.call('POST', `/api/imports/${up.body.importId}/preview`, { mapping: map, options: { ...opt, txn_date_fixed: '09/15/2026' } });
  assert.equal(pv.body.counts.created, 2); assert.equal(pv.body.commissionTotalsCents.receipt, 370);
  assert.deepEqual(pv.body.skippedRows.flatMap((s) => s.numbers), [370, 370]); // stated totals equal the imported sum
  const c = await t.call('POST', `/api/imports/${up.body.importId}/commit`, { mapping: map, options: { ...opt, txn_date_fixed: '09/15/2026' } });
  assert.equal(c.body.counts.created, 2); assert.equal(count(t, 'commission_transactions'), 2);
  assert.equal(t.db.prepare('SELECT txn_date FROM commission_transactions LIMIT 1').get().txn_date, '2026-09-15');
  // an unlisted type (e.g. a renewal) is an error row, not silently counted
  const wb2 = new ExcelJS.Workbook(); const w2 = wb2.addWorksheet('S'); w2.addRow(['Policy#', 'TransType', 'Commission']); w2.addRow(['X1', 'Renewal', 5]);
  const up2 = await t.call('POST', '/api/imports/upload?kind=commissions', undefined, { raw: Buffer.from(await wb2.xlsx.writeBuffer()), headers: { 'X-Filename': 's2.xlsx', 'Content-Type': 'application/octet-stream' } });
  const r2 = await t.call('POST', `/api/imports/${up2.body.importId}/preview`, { mapping: { policy_number: 'Policy#', amount: 'Commission', txn_type: 'TransType' }, options: { ...opt, txn_date_fixed: '09/15/2026' } });
  assert.equal(r2.body.counts.error, 1);
  await t.close();
});

test('commission product filter: only listed carrier values are imported; excluded lines are counted and summed, never silent', async () => {
  const t = await setup();
  const rows = [['Carrier', 'Policy#', 'TransType', 'Commission'], ['PetCarrier', 'PET-1', 'New', '150.00'], ['OtherCarrier', 'GL-1', 'New', '2.70'], ['PetCarrier', 'PET-2', 'New', '150.00'], ['', 'ODD-1', 'New', '5.00']];
  const st = await upload(t, 'commissions', rows);
  const map = { amount: 'Commission', policy_number: 'Policy#', carrier: 'Carrier', txn_type: 'TransType' };
  const opt = { date_format: 'iso', currency: 'USD', statement_ref: 'S1', txn_date_fixed: '2026-09-15', sign_convention: 'type_column', amount_sign: 'as_is', receipt_values: ['New'], filter_column: 'Carrier', filter_values: ['PetCarrier'] };
  const noVals = await t.call('POST', `/api/imports/${st.importId}/preview`, { mapping: map, options: { ...opt, filter_values: [] } });
  assert.equal(noVals.body.ok, false);
  const badCol = await t.call('POST', `/api/imports/${st.importId}/preview`, { mapping: map, options: { ...opt, filter_column: 'Nope' } });
  assert.equal(badCol.body.ok, false);
  const pv = await t.call('POST', `/api/imports/${st.importId}/preview`, { mapping: map, options: opt });
  assert.equal(pv.body.counts.created, 2); assert.equal(pv.body.counts.excluded, 2);
  assert.equal(pv.body.excluded.cents, 770); assert.equal(pv.body.excluded.values.OtherCarrier, 1); assert.equal(pv.body.excluded.values['(blank)'], 1);
  assert.equal(count(t, 'commission_transactions'), 0);
  await t.call('POST', `/api/imports/${st.importId}/commit`, { mapping: map, options: opt });
  assert.equal(count(t, 'commission_transactions'), 2);
  assert.equal(t.db.prepare("SELECT COUNT(*) n FROM commission_transactions WHERE statement_policy_ref='GL-1'").get().n, 0);
  assert.match(t.db.prepare('SELECT notes_json FROM imports WHERE id=?').get(st.importId).notes_json, /OtherCarrier/);
  await t.close();
});

test('list-type import options are accepted as comma-separated strings too', async () => {
  const t = await setup();
  const st = await upload(t, 'commissions', [['Carrier', 'Policy#', 'TransType', 'Commission'], ['PetCarrier', 'PET-1', 'New', '150.00'], ['Other', 'X-1', 'New', '1.00']]);
  const r = await t.call('POST', `/api/imports/${st.importId}/preview`, { mapping: { amount: 'Commission', policy_number: 'Policy#', carrier: 'Carrier', txn_type: 'TransType' }, options: { date_format: 'iso', currency: 'USD', statement_ref: 'S', txn_date_fixed: '2026-09-15', sign_convention: 'type_column', amount_sign: 'as_is', receipt_values: 'New, Renewal', filter_column: 'Carrier', filter_values: 'PetCarrier, Fetch' } });
  assert.equal(r.status, 200); assert.equal(r.body.counts.created, 1); assert.equal(r.body.counts.excluded, 1);
  await t.close();
});

test('customers store first name, last name, state and address: manual entry, edit, search, import, export, public lead form', async () => {
  const t = await setup();
  const bad = await t.call('POST', '/api/customers', { first_name: 'Ann', email: 'a1@example.test' });
  assert.equal(bad.status, 400); // both names required
  assert.equal((await t.call('POST', '/api/customers', { first_name: 'Ann', last_name: 'Lee', state: 'NYC' })).status, 400);
  const c = await t.call('POST', '/api/customers', { first_name: 'Ann', last_name: 'Lee', email: 'ann@example.test', state: 'ny', address_line1: '1 Sample Rd', address_line2: 'Apt 2', city: 'Sampletown', postal_code: '10001' });
  assert.equal(c.status, 201);
  let d = (await t.call('GET', `/api/customers/${c.body.id}`)).body.customer;
  assert.deepEqual([d.name, d.first_name, d.last_name, d.state, d.address_line1, d.address_line2, d.city, d.postal_code], ['Ann Lee', 'Ann', 'Lee', 'NY', '1 Sample Rd', 'Apt 2', 'Sampletown', '10001']);
  assert.equal((await t.call('PATCH', `/api/customers/${c.body.id}`, { last_name: 'Smith', city: 'Newtown' })).status, 200);
  d = (await t.call('GET', `/api/customers/${c.body.id}`)).body.customer;
  assert.deepEqual([d.name, d.last_name, d.city, d.address_line1], ['Ann Smith', 'Smith', 'Newtown', '1 Sample Rd']);
  assert.equal((await t.call('GET', '/api/customers?q=newtown')).body.total, 1);
  assert.equal((await t.call('GET', '/api/customers?q=1 sample')).body.total, 1);
  const csv = (await t.call('GET', '/api/export/customers.csv')).body;
  assert.match(csv, /first_name,last_name,email,phone,address_line1,address_line2,city,state,postal_code/); assert.match(csv, /Ann,Smith/);

  // import with separate first/last + address columns
  const H = ['CustId', 'First', 'Last', 'Email', 'Addr', 'City', 'State', 'Zip', 'Pet', 'Species', 'QuoteId', 'QuoteDate', 'Premium', 'Freq'];
  await runImport(t, 'quotes', [H, ['C7', 'Bo', 'Ray', 'bo@example.test', '9 Test Ave', 'Testburg', 'nj', '07001', 'Rex', 'dog', 'Q7', '2026-02-01', '40', 'monthly']],
    { provider_customer_id: 'CustId', customer_first_name: 'First', customer_last_name: 'Last', customer_email: 'Email', customer_address_line1: 'Addr', customer_city: 'City', customer_state: 'State', customer_postal_code: 'Zip', pet_name: 'Pet', species: 'Species', provider_quote_id: 'QuoteId', quote_date: 'QuoteDate', premium: 'Premium', payment_frequency: 'Freq' }, { date_format: 'iso' });
  const bo = t.db.prepare("SELECT * FROM customers WHERE email='bo@example.test'").get();
  assert.deepEqual([bo.name, bo.first_name, bo.last_name, bo.state, bo.address_line1, bo.city, bo.postal_code], ['Bo Ray', 'Bo', 'Ray', 'NJ', '9 Test Ave', 'Testburg', '07001']);
  // a later report with a full-name column only does NOT split names; it fills only blanks and never overwrites
  await runImport(t, 'quotes', [['CustId', 'Name', 'Email', 'Pet', 'Species', 'QuoteId', 'QuoteDate', 'Premium', 'Freq'], ['C7', 'Robert Ray', 'bo@example.test', 'Rex', 'dog', 'Q8', '2026-02-02', '41', 'monthly']],
    { provider_customer_id: 'CustId', customer_name: 'Name', customer_email: 'Email', pet_name: 'Pet', species: 'Species', provider_quote_id: 'QuoteId', quote_date: 'QuoteDate', premium: 'Premium', payment_frequency: 'Freq' }, { date_format: 'iso' });
  assert.equal(t.db.prepare("SELECT name FROM customers WHERE email='bo@example.test'").get().name, 'Bo Ray');
  assert.equal(t.db.prepare("SELECT COUNT(*) n FROM customers WHERE lower(email)='bo@example.test'").get().n, 1);
  // a full-name-only import leaves first/last empty (no guessing)
  await runImport(t, 'quotes', [['Name', 'Email', 'Pet', 'Species', 'QuoteId', 'QuoteDate', 'Premium', 'Freq'], ['Cy Dee', 'cy@example.test', 'Max', 'cat', 'Q9', '2026-02-03', '30', 'monthly']],
    { customer_name: 'Name', customer_email: 'Email', pet_name: 'Pet', species: 'Species', provider_quote_id: 'QuoteId', quote_date: 'QuoteDate', premium: 'Premium', payment_frequency: 'Freq' }, { date_format: 'iso' });
  const cy = t.db.prepare("SELECT * FROM customers WHERE email='cy@example.test'").get();
  assert.deepEqual([cy.name, cy.first_name, cy.last_name], ['Cy Dee', null, null]);
  await t.close();
});

test('public lead form accepts first/last name and address; rejects a missing last name or bad ZIP', async () => {
  const t = await start(); t.setSetting('public_form_enabled', 'true'); t.setSetting('public_disclosure_text', 'n');
  const body = (c, key = 'k'.repeat(30)) => ({ idempotency_key: key, consent: true, customer: { email: 'lead@example.test', ...c }, pets: [{ name: 'Rex', species: 'dog' }] });
  assert.equal((await t.call('POST', '/api/public/quote', body({ first_name: 'Lee' }), { noCookie: true })).status, 400);
  assert.equal((await t.call('POST', '/api/public/quote', body({ first_name: 'Lee', last_name: 'Ng', postal_code: '!!' }), { noCookie: true })).status, 400);
  const ok = await t.call('POST', '/api/public/quote', body({ first_name: 'Lee', last_name: 'Ng', address_line1: '5 Lead Ln', city: 'Leadville', state: 'ny', postal_code: '10002' }), { noCookie: true });
  assert.equal(ok.status, 200);
  const c = t.db.prepare('SELECT * FROM customers').get();
  assert.deepEqual([c.name, c.first_name, c.last_name, c.address_line1, c.city, c.state, c.postal_code], ['Lee Ng', 'Lee', 'Ng', '5 Lead Ln', 'Leadville', 'NY', '10002']);
  await t.close();
});
