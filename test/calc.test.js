'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const c = require('../src/calc');

test('spec fixture: $300, 10k impressions, 200 link clicks, 20 quoted, 3 buyers, 4 policies', () => {
  assert.equal(c.ctr(200, 10000).value, 2);
  assert.equal(c.cpc(300, 200).value, 1.5);
  assert.equal(c.costPer(300, 20, 'quoted customers').value, 15);
  assert.equal(c.costPer(300, 4, 'issued policies').value, 75);
  assert.equal(c.costPer(300, 3, 'buying customers').value, 100);
  assert.equal(c.expectedCommissionCents(4), 60000);
});

test('zero denominators and missing data are N/A, never 0', () => {
  assert.equal(c.ctr(5, 0).value, null);
  assert.equal(c.cpc(10, 0).value, null);
  assert.equal(c.costPer(10, 0, 'x').value, null);
  assert.equal(c.ctr(null, 100).value, null);
  assert.equal(c.cpc(null, 5).value, null);
  assert.equal(c.costPer(null, 5, 'x').value, null);
  assert.equal(c.costPer(0, 5, 'x').value, 0); // zero SPEND with customers is a real zero
});

const row = (o) => ({ platform: 'meta', account_id: 'a1', level: 'ad', breakdown_signature: 'none', currency: 'USD', report_date: '2026-01-01', spend_micros: 100e6, impressions: 1000, link_clicks: 10, link_click_metric: 'inline_link_clicks', link_click_definition: 'D1', all_clicks: null, synced_at: '2026-01-02T00:00:00Z', ...o });

test('overlapping levels are not double counted (ad rows win over campaign rows)', () => {
  const rows = [row({ level: 'campaign', campaign_id: 'c1', spend_micros: 100e6 }), row({ level: 'ad', ad_id: 'x', spend_micros: 60e6 }), row({ level: 'ad', ad_id: 'y', spend_micros: 40e6 }), row({ level: 'account', spend_micros: 100e6 })];
  const sel = c.selectNonOverlapping(rows);
  assert.equal(sel.length, 2);
  assert.equal(c.adTotals(sel, 'USD').spend, 100);
});

test('only one breakdown signature per group (placement totals not added to platform totals)', () => {
  const rows = [row({ breakdown_signature: 'none', spend_micros: 100e6, synced_at: '2026-01-02T00:00:00Z' }),
    row({ breakdown_signature: 'publisher_platform', channel: 'facebook', spend_micros: 70e6, synced_at: '2026-01-03T00:00:00Z' }),
    row({ breakdown_signature: 'publisher_platform', channel: 'instagram', spend_micros: 30e6, synced_at: '2026-01-03T00:00:00Z' })];
  const sel = c.selectNonOverlapping(rows);
  assert.equal(c.adTotals(sel, 'USD').spend, 100);
  assert.equal(sel.length, 2);
});

test('incompatible click definitions are not combined', () => {
  const rows = [row({}), row({ platform: 'google', account_id: 'g', link_click_metric: 'clicks', link_click_definition: 'D2' })];
  const t = c.adTotals(c.selectNonOverlapping(rows), 'USD');
  assert.equal(t.ctr.value, null);
  assert.match(t.ctr.reason, /different click definitions/);
  assert.equal(t.spend, 200); // spend still totals
});

test('all-clicks are kept separate from link clicks', () => {
  const t = c.adTotals([row({ link_clicks: null, all_clicks: 50, all_click_metric: 'clicks', link_click_metric: null })], 'USD');
  assert.equal(t.ctr.value, null);
  assert.equal(t.allClicks, 50);
});

test('other currencies are excluded from totals and disclosed', () => {
  const t = c.adTotals([row({}), row({ account_id: 'z', currency: 'EUR' })], 'USD');
  assert.equal(t.spend, 100);
  assert.deepEqual(t.otherCurrencies, ['EUR']);
});

test('aggregate CTR is total clicks / total impressions, not an average of rates', () => {
  const t = c.adTotals([row({ ad_id: '1', impressions: 100, link_clicks: 50 }), row({ ad_id: '2', impressions: 9900, link_clicks: 50 })], 'USD');
  assert.equal(t.ctr.value, 1);
});

test('unique customers are not summed across days or pets', () => {
  const ev = [{ customer_id: 1 }, { customer_id: 1 }, { customer_id: 2 }];
  assert.equal(c.uniqueCustomers(ev), 2);
});

test('group uniques disclose overlap', () => {
  const ev = [{ customer_id: 1, g: 'meta' }, { customer_id: 1, g: 'google' }, { customer_id: 2, g: 'meta' }];
  const r = c.uniqueByGroup(ev, (e) => e.g);
  assert.equal(r.uniqueTotal, 2);
  assert.equal(r.sumOfGroups, 3);
  assert.equal(r.overlap, 1);
});

const snap = { touches: [
  { at: '2026-01-01T10:00:00Z', source_type: 'paid', platform: 'meta' },
  { at: '2026-01-03T10:00:00Z', source_type: 'paid', platform: 'google' },
  { at: '2026-01-04T10:00:00Z', source_type: 'direct' },
  { at: '2026-01-06T10:00:00Z', source_type: 'paid', platform: 'tiktok' }, // after the quote: must be ignored
] };
test('attribution: pending until lookback and direct rule are approved', () => {
  assert.equal(c.resolveAttribution(snap, '2026-01-05T00:00:00Z', {}).status, 'pending');
});
test('attribution: direct does not replace', () => {
  const r = c.resolveAttribution(snap, '2026-01-05T00:00:00Z', { lookbackDays: 30, directRule: 'direct_does_not_replace' });
  assert.equal(r.platform, 'google');
});
test('attribution: direct replaces', () => {
  const r = c.resolveAttribution(snap, '2026-01-05T00:00:00Z', { lookbackDays: 30, directRule: 'direct_replaces' });
  assert.equal(r.source_type, 'direct');
});
test('attribution: lookback excludes old touches, no touches => unknown, never inferred', () => {
  const r = c.resolveAttribution(snap, '2026-01-05T00:00:00Z', { lookbackDays: 0.5, directRule: 'direct_does_not_replace' });
  assert.equal(r.source_type, 'unknown');
  assert.equal(c.resolveAttribution({ touches: [] }, '2026-01-05T00:00:00Z', { lookbackDays: 30, directRule: 'direct_replaces' }).source_type, 'unknown');
});

test('commission: $600 receipts and $150 reversal = $450 net; expected stays $600', () => {
  const tx = [{ type: 'receipt', amount_cents: 15000 }, { type: 'receipt', amount_cents: 15000 }, { type: 'receipt', amount_cents: 15000 }, { type: 'receipt', amount_cents: 15000 }, { type: 'reversal', amount_cents: -15000 }];
  const s = c.commissionSummary(tx);
  assert.equal(s.grossReceiptsCents, 60000);
  assert.equal(s.reversalsCents, -15000);
  assert.equal(s.netReceivedCents, 45000);
  assert.equal(c.expectedCommissionCents(4), 60000);
});
test('commission: adjustments are separate and signed; unmatched money stays out of outstanding', () => {
  const pol = [{ id: 1, expected_commission_cents: 15000 }, { id: 2, expected_commission_cents: 15000 }];
  const tx = [{ type: 'receipt', amount_cents: 10000, policy_id: 1 }, { type: 'receipt', amount_cents: 99900, policy_id: null }, { type: 'adjustment', amount_cents: 500, policy_id: 1 }];
  const s = c.commissionSummary(tx);
  assert.equal(s.adjustmentsCents, 500);
  assert.equal(s.netReceivedCents, 110400);
  const o = c.outstandingByPolicy(pol, tx);
  assert.equal(o.length, 1);
  assert.equal(o[0].outstanding_cents, 4500);
});
