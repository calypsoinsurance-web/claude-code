'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { start, QuoteUnavailableError } = require('./helpers');
const reports = require('../src/reports');

const KEY = 'abcdefghijklmnopqrstuv1234567890';
const body = (over = {}) => ({ idempotency_key: KEY, consent: true, visitor_id: null, customer: { name: 'Test Person', email: 'test.person@example.test', phone: '', state: 'NY' }, pets: [{ name: 'Rex', species: 'dog', breed: 'Mix', age: '3' }, { name: 'Tom', species: 'cat' }], ...over });
const open = (t) => { t.setSetting('public_form_enabled', 'true'); t.setSetting('public_disclosure_text', 'Test notice'); };
const count = (t, table) => t.db.prepare(`SELECT COUNT(*) n FROM ${table}`).get().n;
// Test-only adapter. It stands in for the (disabled) live Fetch adapter; the numbers are fixtures, not Fetch data.
const fakeAdapter = (impl) => { const a = { calls: 0, provider: 'fetch', status: () => ({ state: 'test' }), async createQuote(x) { a.calls += 1; return impl(x, a.calls); } }; return a; };

test('live quoting disabled: lead is saved, no quote is fabricated, retries do not duplicate', async () => {
  const t = await start(); open(t);
  const a = await t.call('POST', '/api/public/quote', body(), { noCookie: true });
  assert.equal(a.status, 200); assert.equal(a.body.status, 'quote_unavailable');
  assert.equal(a.body.quotes, undefined);
  const b = await t.call('POST', '/api/public/quote', body(), { noCookie: true });
  assert.equal(b.body.status, 'quote_unavailable');
  assert.equal(count(t, 'customers'), 1); assert.equal(count(t, 'pets'), 2); assert.equal(count(t, 'quotes'), 0);
  assert.equal(count(t, 'quote_requests'), 1); assert.equal(count(t, 'followups'), 1);
  await t.close();
});

test('form is refused until disclosure text exists and form is enabled', async () => {
  const t = await start();
  assert.equal((await t.call('POST', '/api/public/quote', body(), { noCookie: true })).status, 503);
  t.setSetting('public_form_enabled', 'true');
  assert.equal((await t.call('POST', '/api/public/quote', body(), { noCookie: true })).status, 503);
  await t.close();
});

test('success: multiple pets make multiple quotes but ONE unique quoted customer; duplicate submit adds nothing', async () => {
  const ad = fakeAdapter((x, n) => ({ providerQuoteId: `Q${n}`, premiumCents: 4500, paymentFrequency: 'monthly', coverage: { fixture: true } }));
  const t = await start({ adapter: ad }); open(t); t.setSetting('reporting_timezone', 'UTC'); t.setSetting('reporting_currency', 'USD');
  const r = await t.call('POST', '/api/public/quote', body(), { noCookie: true });
  assert.equal(r.body.status, 'completed'); assert.equal(r.body.quotes.length, 2);
  const again = await t.call('POST', '/api/public/quote', body(), { noCookie: true });
  assert.equal(again.body.status, 'completed'); assert.equal(ad.calls, 2);
  assert.equal(count(t, 'quotes'), 2); assert.equal(count(t, 'customers'), 1);
  const today = new Date().toISOString().slice(0, 10);
  await t.login();
  const s = await t.call('GET', `/api/summary?from=${today}&to=${today}`);
  assert.equal(s.body.calendar.quoteEvents, 2); assert.equal(s.body.calendar.quotedCustomers, 1);
  // same key with different details is rejected
  const clash = await t.call('POST', '/api/public/quote', body({ pets: [{ name: 'Other', species: 'dog' }] }), { noCookie: true });
  assert.equal(clash.status, 409);
  await t.close();
});

test('a repeat quote by the same customer (new submission) still counts one customer', async () => {
  let n = 0; const ad = fakeAdapter(() => ({ providerQuoteId: `R${++n}`, premiumCents: 5000, paymentFrequency: 'monthly' }));
  const t = await start({ adapter: ad }); open(t); t.setSetting('reporting_timezone', 'UTC');
  await t.call('POST', '/api/public/quote', body(), { noCookie: true });
  await t.call('POST', '/api/public/quote', body({ idempotency_key: 'zzzzzzzzzzzzzzzzzzzzzzzz9999' }), { noCookie: true });
  assert.equal(count(t, 'customers'), 1); assert.equal(count(t, 'quotes'), 4);
  const today = new Date().toISOString().slice(0, 10);
  assert.equal(reports.summary(t.db, { from: today, to: today }).calendar.quotedCustomers, 1);
  await t.close();
});

test('provider failure keeps the saved customer; retry with same key succeeds without duplicates', async () => {
  let fail = true; const ad = fakeAdapter((x, n) => { if (fail) throw new Error('boom'); return { providerQuoteId: `P${n}`, premiumCents: 3000, paymentFrequency: 'monthly' }; });
  const t = await start({ adapter: ad }); open(t);
  const a = await t.call('POST', '/api/public/quote', body(), { noCookie: true });
  assert.equal(a.body.status, 'quote_failed'); assert.equal(count(t, 'customers'), 1); assert.equal(count(t, 'quotes'), 0);
  fail = false;
  const b = await t.call('POST', '/api/public/quote', body(), { noCookie: true });
  assert.equal(b.body.status, 'completed'); assert.equal(count(t, 'quotes'), 2); assert.equal(count(t, 'customers'), 1); assert.equal(count(t, 'quote_requests'), 1);
  await t.close();
});

test('provider answered but CRM save failed: answer kept, retry saves it WITHOUT asking provider again', async () => {
  const ad = fakeAdapter((x, n) => ({ providerQuoteId: `S${n}`, premiumCents: 3100, paymentFrequency: 'monthly' }));
  const t = await start({ adapter: ad }); open(t);
  t.db.exec("CREATE TRIGGER block_quotes BEFORE INSERT ON quotes BEGIN SELECT RAISE(ABORT, 'disk full'); END;");
  const a = await t.call('POST', '/api/public/quote', body(), { noCookie: true });
  assert.equal(a.body.status, 'quote_received_unsaved'); assert.equal(count(t, 'quotes'), 0); assert.equal(ad.calls, 2);
  t.db.exec('DROP TRIGGER block_quotes');
  const b = await t.call('POST', '/api/public/quote', body(), { noCookie: true });
  assert.equal(b.body.status, 'completed'); assert.equal(ad.calls, 2); assert.equal(count(t, 'quotes'), 2);
  await t.close();
});

test('an invalid provider answer (no real price) never becomes a quote', async () => {
  const ad = fakeAdapter(() => ({ providerQuoteId: 'X1', premiumCents: 0, paymentFrequency: '' }));
  const t = await start({ adapter: ad }); open(t);
  const a = await t.call('POST', '/api/public/quote', body(), { noCookie: true });
  assert.equal(a.body.status, 'quote_failed'); assert.equal(count(t, 'quotes'), 0);
  await t.close();
});

test('input validation and honeypot', async () => {
  const t = await start(); open(t);
  for (const bad of [body({ customer: { name: '', email: 'a@b.co' } }), body({ customer: { name: 'A', email: 'nope' } }), body({ pets: [] }), body({ pets: [{ name: 'x', species: 'bird' }] }), body({ consent: false }), body({ idempotency_key: 'short' })]) {
    assert.equal((await t.call('POST', '/api/public/quote', bad, { noCookie: true })).status, 400);
  }
  await t.call('POST', '/api/public/quote', { ...body(), website: 'http://spam' }, { noCookie: true });
  assert.equal(count(t, 'customers'), 0);
  await t.close();
});

test('attribution is frozen on the quote and later visits do not change it; direct never replaces unless approved', async () => {
  const ad = fakeAdapter((x, n) => ({ providerQuoteId: `T${n}`, premiumCents: 4000, paymentFrequency: 'monthly' }));
  const t = await start({ adapter: ad }); open(t); t.setSetting('reporting_timezone', 'UTC'); t.setSetting('reporting_currency', 'USD');
  const vid = 'v'.repeat(24);
  assert.equal((await t.call('POST', '/api/public/visit', { visitor_id: vid, landing_url: 'https://x.test/', utm_source: 'facebook', utm_medium: 'paid_social', utm_campaign: 'C1', utm_content: 'AD1' }, { noCookie: true })).status, 204);
  assert.equal((await t.call('POST', '/api/public/visit', { visitor_id: vid, landing_url: 'https://x.test/', referrer: '' }, { noCookie: true })).status, 204); // direct visit
  await t.call('POST', '/api/public/quote', body({ visitor_id: vid, pets: [{ name: 'Rex', species: 'dog' }] }), { noCookie: true });
  await t.call('POST', '/api/public/visit', { visitor_id: vid, utm_source: 'google', utm_medium: 'cpc' }, { noCookie: true }); // AFTER quote
  const q = t.db.prepare('SELECT attribution_snapshot_json FROM quotes').get();
  const snap = JSON.parse(q.attribution_snapshot_json);
  assert.equal(snap.touches.length, 2);
  assert.deepEqual(snap.touches.map((x) => x.source_type), ['paid', 'direct']);
  const c = t.db.prepare('SELECT first_source_type, first_source_platform FROM customers').get();
  assert.equal(c.first_source_type, 'paid'); assert.equal(c.first_source_platform, 'meta');
  const today = new Date().toISOString().slice(0, 10);
  // rules not approved -> pending, paid costs N/A
  let s = reports.summary(t.db, { from: today, to: today });
  assert.equal(s.costs.costPerQuotedCustomer.value, null);
  t.setSetting('attribution_lookback_days', '30');
  t.setSetting('direct_rule', 'direct_does_not_replace');
  s = reports.summary(t.db, { from: today, to: today });
  assert.equal(s.unattributed.quotedCustomersBySource.paid, 1);
  t.setSetting('direct_rule', 'direct_replaces');
  s = reports.summary(t.db, { from: today, to: today });
  assert.equal(s.unattributed.quotedCustomersBySource.direct, 1);
  await t.close();
});

test('tracking endpoint stores no personal data and rejects bad visitor ids', async () => {
  const t = await start();
  assert.equal((await t.call('POST', '/api/public/visit', { visitor_id: 'short' }, { noCookie: true })).status, 400);
  await t.call('POST', '/api/public/visit', { visitor_id: 'a'.repeat(24), email: 'leak@example.test', name: 'Leak' }, { noCookie: true });
  const row = t.db.prepare('SELECT * FROM visits').get();
  assert.ok(!JSON.stringify(row).includes('leak@example.test'));
  await t.close();
});
