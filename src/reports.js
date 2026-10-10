'use strict';
const { allSettings } = require('./db');
const calc = require('./calc');

// Decisions the owner must make before the related numbers are shown. Nothing here is silently defaulted.
const DECISIONS = [
  { key: 'reporting_timezone', label: 'Reporting time zone', help: 'Used to turn quote timestamps into calendar days (IANA name, e.g. America/New_York).', needFor: 'Quote dates by day' },
  { key: 'reporting_currency', label: 'Reporting currency', help: 'Only advertising rows in this currency are totalled. No currency conversion is performed.', needFor: 'Spend and cost metrics' },
  { key: 'attribution_lookback_days', label: 'Attribution lookback window (days)', help: 'How long before a quote a tracked visit can still be credited.', needFor: 'Paid cost-per-outcome metrics' },
  { key: 'direct_rule', label: 'Do direct visits replace an earlier tracked source?', help: 'direct_replaces: a later direct visit becomes the source. direct_does_not_replace: the last NON-direct source is kept.', needFor: 'Paid cost-per-outcome metrics', options: ['direct_replaces', 'direct_does_not_replace'] },
  { key: 'acquisition_event', label: 'What starts an acquisition group?', help: 'Only "first_quote" is implemented: the customer\'s first generated quote.', needFor: 'Acquisition view', options: ['first_quote'] },
  { key: 'returning_customers', label: 'Returning customers in acquisition reporting', help: 'Only "first_only" is implemented: a customer belongs to one group, the first.', needFor: 'Acquisition view', options: ['first_only'] },
  { key: 'acquisition_observation_end', label: 'Acquisition observation end date (as of)', help: 'Outcomes after this date are not counted. YYYY-MM-DD.', needFor: 'Acquisition view' },
  { key: 'cancellation_treatment', label: 'Cancellation treatment in net/active sales', help: 'Until decided, issued policies are shown as GROSS, with cancelled and not-cancelled counts shown beside them.', needFor: 'Net/active sales labelling', options: ['gross_only_for_now', 'net_of_cancellations', 'active_only'] },
];

function localDate(iso, tz) {
  const d = new Date(iso);
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}

function loadContext(db) {
  const s = allSettings(db);
  const tz = s.reporting_timezone || null;
  if (tz) { try { localDate(new Date().toISOString(), tz); } catch { throw Object.assign(new Error(`Invalid reporting time zone "${tz}"`), { status: 400 }); } }
  const rules = {
    lookbackDays: s.attribution_lookback_days != null && s.attribution_lookback_days !== '' ? Number(s.attribution_lookback_days) : null,
    directRule: s.direct_rule || null,
  };
  return { s, tz, currency: s.reporting_currency || null, rules };
}

function quoteDate(q, tz) {
  if (q.quoted_date) return q.quoted_date;
  return tz ? localDate(q.quoted_at, tz) : null;
}

const inRange = (d, from, to) => d != null && d >= from && d <= to;

function buildQuoteEvents(db, ctx) {
  const rows = db.prepare("SELECT id, customer_id, pet_id, quoted_at, quoted_date, attribution_snapshot_json, status FROM quotes WHERE status != 'void'").all();
  return rows.map((q) => {
    const snap = JSON.parse(q.attribution_snapshot_json);
    return { id: q.id, customer_id: q.customer_id, date: quoteDate(q, ctx.tz), quoted_at: q.quoted_at, hasTouches: (snap.touches || []).length > 0, res: calc.resolveAttribution(snap, q.quoted_at, ctx.rules) };
  });
}

function summary(db, f) {
  const ctx = loadContext(db);
  const from = f.from; const to = f.to;
  const blockers = [];
  if (!ctx.currency) blockers.push('reporting_currency');
  if (!ctx.tz) blockers.push('reporting_timezone');
  const attributionPending = ctx.rules.lookbackDays == null || !ctx.rules.directRule;
  if (attributionPending) blockers.push('attribution_lookback_days / direct_rule');

  // --- advertising (non-overlapping, then filters) ---
  const allAd = db.prepare('SELECT * FROM ad_records').all();
  const nonOverlap = calc.selectNonOverlapping(allAd);
  let adRows = nonOverlap.filter((r) => inRange(r.report_date, from, to));
  const notes = [];
  if (f.platform) adRows = adRows.filter((r) => r.platform === f.platform);
  if (f.campaign) {
    const before = adRows.length;
    adRows = adRows.filter((r) => r.campaign_id === f.campaign);
    if (before && !adRows.length) notes.push('No advertising rows carry that campaign ID at the finest imported level.');
  }
  if (f.ad) adRows = adRows.filter((r) => r.ad_id === f.ad);
  const spendKnown = !!ctx.currency;
  const ads = spendKnown ? calc.adTotals(adRows, ctx.currency) : null;

  // --- quotes ---
  const quoteEvents = buildQuoteEvents(db, ctx).filter((e) => inRange(e.date, from, to));
  const quotedCustomers = calc.uniqueCustomers(quoteEvents);

  // --- policies ---
  const pol = db.prepare('SELECT p.*, q.attribution_snapshot_json AS qsnap, q.quoted_at AS qat FROM policies p LEFT JOIN quotes q ON q.id = p.quote_id WHERE p.is_issued = 1 AND p.issue_date IS NOT NULL').all()
    .filter((p) => inRange(p.issue_date, from, to));
  const policyEvents = pol.map((p) => ({
    id: p.id, customer_id: p.customer_id, quote_id: p.quote_id, cancelled: !!(p.cancellation_date || /cancel/i.test(p.status || '')), expected: p.expected_commission_cents,
    res: p.quote_id ? calc.resolveAttribution(JSON.parse(p.qsnap), p.qat, ctx.rules) : { status: attributionPending ? 'pending' : 'resolved', source_type: 'unknown', platform: null, basis: 'originating quote not identified by a verified identifier' },
  }));
  const buyingCustomers = calc.uniqueCustomers(policyEvents);

  // --- commission ---
  const txns = db.prepare('SELECT * FROM commission_transactions WHERE txn_date >= ? AND txn_date <= ?').all(from, to);
  const commission = {
    ...calc.commissionSummary(txns),
    expectedOriginalCents: policyEvents.reduce((s, p) => s + p.expected, 0),
    unmatchedCount: txns.filter((t) => t.match_status === 'unmatched').length,
    unmatchedNetCents: txns.filter((t) => t.match_status === 'unmatched').reduce((s, t) => s + t.amount_cents, 0),
    currencies: [...new Set(txns.map((t) => t.currency))],
  };
  const matchedTxns = db.prepare("SELECT t.* FROM commission_transactions t WHERE t.policy_id IS NOT NULL").all();
  const issuedAll = db.prepare('SELECT id, expected_commission_cents FROM policies WHERE is_issued = 1').all();
  const outstanding = calc.outstandingByPolicy(issuedAll, matchedTxns);
  commission.outstanding = {
    basis: 'Issued policies (all dates) that have at least one MATCHED statement line: expected minus matched net. Policies with no matched line and all unmatched lines are excluded.',
    policiesIncluded: outstanding.length,
    cents: outstanding.reduce((s, o) => s + o.outstanding_cents, 0),
  };
  commission.otherCurrencyWarning = commission.currencies.length > 1 ? 'Transactions in more than one currency are present; amounts are not converted.' : null;

  // --- attribution views ---
  const res = { attributionPending };
  const matchesFilter = (r) => (!f.campaign || r.campaign_ref === f.campaign) && (!f.ad || r.ad_ref === f.ad);
  const bySource = {};
  const paidQuoteEvents = [];
  for (const e of quoteEvents) {
    const t = e.res.status === 'pending' ? 'pending' : e.res.source_type;
    (bySource[t] ||= new Set()).add(e.customer_id);
    if (e.res.status === 'resolved' && e.res.source_type === 'paid' && matchesFilter(e.res) && (!f.platform || e.res.platform === f.platform)) paidQuoteEvents.push(e);
  }
  const paidPolicyEvents = policyEvents.filter((p) => p.res.status === 'resolved' && p.res.source_type === 'paid' && matchesFilter(p.res) && (!f.platform || p.res.platform === f.platform));
  const quotedPaid = calc.uniqueCustomers(paidQuoteEvents);
  const buyingPaid = calc.uniqueCustomers(paidPolicyEvents);
  const policiesPaid = paidPolicyEvents.length;

  const platformGroups = calc.uniqueByGroup(quoteEvents.filter((e) => e.res.status === 'resolved' && e.res.source_type === 'paid'), (e) => e.res.platform || 'unspecified');
  const buyerGroups = calc.uniqueByGroup(policyEvents.filter((p) => p.res.status === 'resolved' && p.res.source_type === 'paid'), (p) => p.res.platform || 'unspecified');

  const reason = attributionPending ? 'Attribution rules not approved yet (Settings → Decisions)' : null;
  const paidSpend = ads ? ads.spend : null;
  const costs = {
    basis: 'Calendar basis: spend dated within the period ÷ paid-attributed outcomes dated within the same period (quotes by quote date, policies by issue date). They may belong to different acquisition groups.',
    costPerQuotedCustomer: reason ? calc.NA(reason) : (spendKnown ? calc.costPer(paidSpend, quotedPaid, 'paid-attributed quoted customers') : calc.NA('Reporting currency not set')),
    costPerIssuedPolicy: reason ? calc.NA(reason) : (spendKnown ? calc.costPer(paidSpend, policiesPaid, 'paid-attributed issued policies') : calc.NA('Reporting currency not set')),
    costPerBuyingCustomer: reason ? calc.NA(reason) : (spendKnown ? calc.costPer(paidSpend, buyingPaid, 'paid-attributed buying customers') : calc.NA('Reporting currency not set')),
    paidAttributed: reason ? null : { quotedCustomers: quotedPaid, issuedPolicies: policiesPaid, buyingCustomers: buyingPaid },
  };

  const unattributed = {
    quotedCustomersBySource: Object.fromEntries(Object.entries(bySource).map(([k, v]) => [k, v.size])),
    issuedPoliciesWithUnknownOriginatingQuote: policyEvents.filter((p) => !p.quote_id).length,
    note: 'Only "paid" outcomes enter paid denominators. Organic, referral, direct and unknown outcomes are shown here and never allocated to spend.',
  };
  const coverage = {
    quotesWithTrackingData: quoteEvents.filter((e) => e.hasTouches).length,
    quotesTotal: quoteEvents.length,
    note: 'A quote without linked tracked visits has unknown attribution. Tracking only covers visitors who reached the quote page through a tagged, tracked path.',
  };

  // --- per platform / campaign / channel tables ---
  const platforms = [...new Set(nonOverlap.filter((r) => inRange(r.report_date, from, to)).map((r) => r.platform))];
  const byPlatform = platforms.map((p) => {
    const rows = nonOverlap.filter((r) => r.platform === p && inRange(r.report_date, from, to));
    const t = spendKnown ? calc.adTotals(rows, ctx.currency) : null;
    const q = platformGroups.groups[p] ?? 0;
    const b = buyerGroups.groups[p] ?? 0;
    const pol = policyEvents.filter((x) => x.res.status === 'resolved' && x.res.source_type === 'paid' && x.res.platform === p).length;
    return {
      platform: p, totals: t,
      quotedCustomers: reason ? null : q, buyingCustomers: reason ? null : b, issuedPolicies: reason ? null : pol,
      costPerQuotedCustomer: reason ? calc.NA(reason) : (t ? calc.costPer(t.spend, q, 'attributed quoted customers') : calc.NA('Currency not set')),
      costPerIssuedPolicy: reason ? calc.NA(reason) : (t ? calc.costPer(t.spend, pol, 'attributed issued policies') : calc.NA('Currency not set')),
      costPerBuyingCustomer: reason ? calc.NA(reason) : (t ? calc.costPer(t.spend, b, 'attributed buying customers') : calc.NA('Currency not set')),
    };
  });
  const overlap = reason ? null : {
    quotedCustomers: { unique: platformGroups.uniqueTotal, sumOfPlatforms: platformGroups.sumOfGroups, overlap: platformGroups.overlap },
    buyingCustomers: { unique: buyerGroups.uniqueTotal, sumOfPlatforms: buyerGroups.sumOfGroups, overlap: buyerGroups.overlap },
    note: 'A customer whose quotes were attributed to different platforms appears under each platform. Platform rows may therefore add to more than the unique total. No allocation rule has been approved.',
  };

  const campaignMap = new Map();
  for (const r of adRows.filter((x) => x.campaign_id)) {
    const k = `${r.platform}|${r.campaign_id}`;
    if (!campaignMap.has(k)) campaignMap.set(k, { platform: r.platform, campaign_id: r.campaign_id, campaign_name: r.campaign_name, rows: [] });
    campaignMap.get(k).rows.push(r);
  }
  const byCampaign = [...campaignMap.values()].map((c) => {
    const t = spendKnown ? calc.adTotals(c.rows, ctx.currency) : null;
    const qEv = reason ? [] : quoteEvents.filter((e) => e.res.status === 'resolved' && e.res.source_type === 'paid' && e.res.platform === c.platform && e.res.campaign_ref === c.campaign_id);
    const pEv = reason ? [] : policyEvents.filter((p) => p.res.status === 'resolved' && p.res.source_type === 'paid' && p.res.platform === c.platform && p.res.campaign_ref === c.campaign_id);
    const q = calc.uniqueCustomers(qEv); const b = calc.uniqueCustomers(pEv);
    return {
      platform: c.platform, campaign_id: c.campaign_id, campaign_name: c.campaign_name, totals: t,
      quotedCustomers: reason ? null : q, issuedPolicies: reason ? null : pEv.length, buyingCustomers: reason ? null : b,
      costPerQuotedCustomer: reason ? calc.NA(reason) : (t ? calc.costPer(t.spend, q, 'attributed quoted customers') : calc.NA('Currency not set')),
      costPerIssuedPolicy: reason ? calc.NA(reason) : (t ? calc.costPer(t.spend, pEv.length, 'attributed issued policies') : calc.NA('Currency not set')),
      costPerBuyingCustomer: reason ? calc.NA(reason) : (t ? calc.costPer(t.spend, b, 'attributed buying customers') : calc.NA('Currency not set')),
    };
  });
  const knownCampaignIds = new Set(adRows.map((r) => `${r.platform}|${r.campaign_id}`));
  const unmatchedCampaignRefs = reason ? null : paidQuoteEvents.filter((e) => !e.res.campaign_ref || !knownCampaignIds.has(`${e.res.platform}|${e.res.campaign_ref}`)).length;

  const channelRows = adRows.filter((r) => r.channel);
  const byChannel = spendKnown ? [...new Set(channelRows.map((r) => `${r.platform}|${r.channel}|${r.network}|${r.placement}`))].map((k) => {
    const [platform, channel, network, placement] = k.split('|');
    return { platform, channel, network, placement, totals: calc.adTotals(channelRows.filter((r) => `${r.platform}|${r.channel}|${r.network}|${r.placement}` === k), ctx.currency) };
  }) : [];

  // --- freshness ---
  const fresh = db.prepare("SELECT platform, MAX(synced_at) AS last_imported, MAX(report_date) AS latest_report_date, provenance FROM ad_records GROUP BY platform, provenance").all();
  const lastCommissionImport = db.prepare("SELECT MAX(committed_at) AS t FROM imports WHERE kind='commissions' AND status='committed'").get().t;

  const cancelledCount = policyEvents.filter((p) => p.cancelled).length;
  return {
    filters: f, currency: ctx.currency, timezone: ctx.tz, blockers, notes,
    calendar: {
      advertising: ads,
      quotedCustomers, quoteEvents: quoteEvents.length,
      issuedPolicies: policyEvents.length, buyingCustomers,
      issuedPoliciesCancelledSoFar: cancelledCount, issuedPoliciesNotCancelled: policyEvents.length - cancelledCount,
      cancellationNote: 'Issued policies are shown GROSS. Cancelled and not-cancelled counts are shown beside them; the net/active treatment is a pending decision.',
      commission,
    },
    costs, byPlatform, overlap, byCampaign, unmatchedCampaignRefs, byChannel, unattributed, coverage,
    freshness: { advertising: fresh, lastCommissionImport },
    res,
  };
}

function acquisition(db, f) {
  const ctx = loadContext(db);
  const s = ctx.s;
  const missing = [];
  for (const k of ['reporting_timezone', 'reporting_currency', 'attribution_lookback_days', 'direct_rule', 'acquisition_event', 'returning_customers', 'acquisition_observation_end']) if (!s[k]) missing.push(k);
  if (s.acquisition_event && s.acquisition_event !== 'first_quote') missing.push('acquisition_event (only first_quote is implemented)');
  if (s.returning_customers && s.returning_customers !== 'first_only') missing.push('returning_customers (only first_only is implemented)');
  if (missing.length) return { enabled: false, missing, message: 'The acquisition view stays off until these decisions are made (Settings → Decisions).' };
  const asOf = s.acquisition_observation_end;
  const events = buildQuoteEvents(db, ctx).filter((e) => e.date && e.date <= asOf).sort((a, b) => (a.date + a.quoted_at < b.date + b.quoted_at ? -1 : 1));
  const first = new Map();
  for (const e of events) if (!first.has(e.customer_id)) first.set(e.customer_id, e);
  const policies = db.prepare('SELECT customer_id, issue_date, id FROM policies WHERE is_issued = 1 AND issue_date IS NOT NULL AND issue_date <= ?').all(asOf);
  const policiesByCustomer = new Map();
  for (const p of policies) (policiesByCustomer.get(p.customer_id) || policiesByCustomer.set(p.customer_id, []).get(p.customer_id)).push(p);
  const nonOverlap = calc.selectNonOverlapping(db.prepare('SELECT * FROM ad_records').all());
  const months = new Map();
  for (const [cid, e] of first) {
    const m = e.date.slice(0, 7);
    if (m < f.from.slice(0, 7) || m > f.to.slice(0, 7)) continue;
    if (!months.has(m)) months.set(m, []);
    months.get(m).push({ cid, e });
  }
  const rows = [...months.keys()].sort().map((m) => {
    const grp = months.get(m);
    const monthEnd = new Date(Date.UTC(Number(m.slice(0, 4)), Number(m.slice(5, 7)), 0)).toISOString().slice(0, 10);
    const paid = grp.filter((g) => g.e.res.source_type === 'paid');
    const buyers = (list) => list.filter((g) => (policiesByCustomer.get(g.cid) || []).some((p) => p.issue_date >= g.e.date));
    const pol = (list) => list.reduce((n, g) => n + (policiesByCustomer.get(g.cid) || []).filter((p) => p.issue_date >= g.e.date).length, 0);
    const spend = calc.adTotals(nonOverlap.filter((r) => r.report_date.slice(0, 7) === m), ctx.currency).spend;
    const daysObserved = Math.round((Date.parse(asOf) - Date.parse(monthEnd)) / 86400000);
    const buyerList = buyers(grp);
    return {
      month: m, customers: grp.length, buyingCustomers: buyerList.length, issuedPolicies: pol(grp),
      bySource: Object.fromEntries(['paid', 'organic', 'referral', 'direct', 'unknown'].map((t) => [t, grp.filter((g) => g.e.res.source_type === t).length])),
      paidCustomers: paid.length, paidBuyingCustomers: buyers(paid).length, paidIssuedPolicies: pol(paid),
      aggregateAdSpendInMonth: spend,
      costPerPaidCustomer: calc.costPer(spend, paid.length, 'paid-attributed customers'),
      daysObservedAfterGroupEnd: daysObserved, incomplete: daysObserved < 0 ? 'Group month not finished at the as-of date' : null,
      trackingCoverage: `${grp.filter((g) => g.e.hasTouches).length} of ${grp.length}`,
    };
  });
  return {
    enabled: true, asOf, currency: ctx.currency,
    definition: `Group = customers whose FIRST generated quote (on or before ${asOf}) falls in the month. Returning customers stay in their first group. Source = attribution of that first quote. Buying = an issued policy on or after the first quote date and on or before ${asOf}.`,
    caveat: 'Aggregate ad spend includes anonymous visitors who may never become identifiable customers. It is not the exact acquisition cost of any named customer. Later policies for recent groups are still arriving.',
    rows,
  };
}

// Day-by-day activity for the calendar view. Each day's unique customers are computed for THAT day only;
// the period total comes from summary() (never by adding these days up).
function calendarActivity(db, from, to) {
  const ctx = loadContext(db);
  const days = {};
  const day = (d) => (days[d] ||= { date: d, spend: null, quotedCustomers: 0, issuedPolicies: 0, receiptsCents: 0, reversalsCents: 0, adjustmentsCents: 0, _q: new Set() });
  if (ctx.currency) {
    for (const r of calc.selectNonOverlapping(db.prepare('SELECT * FROM ad_records WHERE report_date >= ? AND report_date <= ?').all(from, to)).filter((x) => x.currency === ctx.currency)) {
      const d = day(r.report_date); d.spend = (d.spend || 0) + r.spend_micros / 1e6;
    }
  }
  for (const e of buildQuoteEvents(db, ctx).filter((x) => inRange(x.date, from, to))) day(e.date)._q.add(e.customer_id);
  for (const p of db.prepare('SELECT issue_date FROM policies WHERE is_issued=1 AND issue_date >= ? AND issue_date <= ?').all(from, to)) day(p.issue_date).issuedPolicies += 1;
  for (const t of db.prepare('SELECT txn_date, type, amount_cents FROM commission_transactions WHERE txn_date >= ? AND txn_date <= ?').all(from, to)) {
    const d = day(t.txn_date);
    if (t.type === 'receipt') d.receiptsCents += t.amount_cents; else if (t.type === 'reversal') d.reversalsCents += t.amount_cents; else d.adjustmentsCents += t.amount_cents;
  }
  return Object.values(days).sort((a, b) => (a.date < b.date ? -1 : 1)).map((d) => { d.quotedCustomers = d._q.size; delete d._q; return d; });
}

module.exports = { summary, acquisition, calendarActivity, DECISIONS, localDate, loadContext };
