'use strict';
// Pure calculation functions. No database access, so every rule here is unit tested.
// Convention: an unavailable result is { value: null, reason } and is shown as "N/A" — never as 0.

const NA = (reason) => ({ value: null, reason });
const ok = (value, extra) => ({ value, ...(extra || {}) });

const LEVEL_RANK = { account: 0, campaign: 1, adset: 2, ad: 3 };

function ctr(linkClicks, impressions) {
  if (linkClicks == null) return NA('Link-click data unavailable');
  if (impressions == null) return NA('Impressions unavailable');
  if (impressions === 0) return NA('Zero impressions');
  return ok((linkClicks / impressions) * 100);
}
function cpc(spend, linkClicks) {
  if (spend == null) return NA('Spend unavailable');
  if (linkClicks == null) return NA('Link-click data unavailable');
  if (linkClicks === 0) return NA('Zero link clicks');
  return ok(spend / linkClicks);
}
function costPer(spend, count, label) {
  if (spend == null) return NA('Matching paid spend unavailable');
  if (count == null) return NA(`${label} unavailable`);
  if (count === 0) return NA(`Zero ${label}`);
  return ok(spend / count);
}

function expectedCommissionCents(distinctIssuedPolicies, perPolicyCents = 15000) {
  return distinctIssuedPolicies * perPolicyCents;
}

// ---- Advertising spend without double counting ---------------------------------------------------
// Imports may contain account totals, campaign rows and ad rows for the same day. Adding them would
// count the same money several times. For each (platform, account, date) we keep only the FINEST level
// present, and within that level only ONE breakdown signature (the most recently imported/synced).
function selectNonOverlapping(rows) {
  const groups = new Map();
  for (const r of rows) {
    const k = `${r.platform}|${r.account_id}|${r.report_date}|${r.currency}`;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(r);
  }
  const kept = [];
  for (const g of groups.values()) {
    const best = Math.max(...g.map((r) => LEVEL_RANK[r.level]));
    const atLevel = g.filter((r) => LEVEL_RANK[r.level] === best);
    const sigs = new Map();
    for (const r of atLevel) {
      const prev = sigs.get(r.breakdown_signature) || '';
      if (r.synced_at > prev) sigs.set(r.breakdown_signature, r.synced_at);
    }
    const chosen = [...sigs.entries()].sort((a, b) => (a[1] < b[1] ? 1 : -1))[0][0];
    for (const r of atLevel) if (r.breakdown_signature === chosen) kept.push(r);
  }
  return kept;
}

// Totals over already-selected, non-overlapping rows. Only rows in `currency` are summed.
function adTotals(rows, currency) {
  const used = rows.filter((r) => r.currency === currency);
  const otherCurrencies = [...new Set(rows.filter((r) => r.currency !== currency).map((r) => r.currency))];
  const spendMicros = used.reduce((s, r) => s + r.spend_micros, 0);
  const withImp = used.filter((r) => r.impressions != null);
  const withLinks = used.filter((r) => r.link_clicks != null && r.impressions != null);
  const defs = [...new Set(withLinks.map((r) => `${r.link_click_metric || '?'} :: ${r.link_click_definition || '?'}`))];
  const out = {
    currency,
    spend: spendMicros / 1e6,
    impressions: withImp.length ? withImp.reduce((s, r) => s + r.impressions, 0) : null,
    otherCurrencies,
    rowCount: used.length,
    clickDefinitions: defs,
  };
  const allClicks = used.filter((r) => r.all_clicks != null);
  out.allClicks = allClicks.length ? allClicks.reduce((s, r) => s + r.all_clicks, 0) : null; // never mixed with link clicks
  if (!withLinks.length) {
    out.linkClicks = null;
    out.ctr = NA('No link-click data in the selected rows');
    out.cpc = NA('No link-click data in the selected rows');
  } else if (defs.length > 1) {
    out.linkClicks = null;
    out.ctr = NA('Selected rows use different click definitions, which are not combined');
    out.cpc = NA('Selected rows use different click definitions, which are not combined');
  } else {
    // Rates use only rows that have BOTH numerator and denominator, so mismatched coverage cannot skew them.
    const linkClicks = withLinks.reduce((s, r) => s + r.link_clicks, 0);
    const imps = withLinks.reduce((s, r) => s + r.impressions, 0);
    const spend = withLinks.reduce((s, r) => s + r.spend_micros, 0) / 1e6;
    out.linkClicks = linkClicks;
    out.ctr = ctr(linkClicks, imps);
    out.cpc = cpc(spend, linkClicks);
    const excluded = used.length - withLinks.length;
    if (excluded) out.rateNote = `CTR/CPC exclude ${excluded} row(s) without link-click data.`;
  }
  return out;
}

// ---- Attribution -----------------------------------------------------------------------------------
// A quote stores a frozen snapshot of the visitor's touches that existed at quote time:
//   { touches: [{ at, source_type, platform, campaign_ref, ad_ref, ... }] }
// The snapshot is immutable. The approved rules (lookback window, direct-visit handling) are applied
// when reporting. If either rule is not yet approved, attribution is "pending" and paid cost metrics are N/A.
function resolveAttribution(snapshot, quotedAtIso, rules) {
  if (!rules || rules.lookbackDays == null || !rules.directRule) {
    return { status: 'pending', reason: 'Attribution lookback window and direct-visit rule are not approved yet' };
  }
  const touches = (snapshot && snapshot.touches) || [];
  const quotedAt = Date.parse(quotedAtIso);
  const earliest = quotedAt - rules.lookbackDays * 86400000;
  const inWindow = touches
    .filter((t) => Date.parse(t.at) <= quotedAt && Date.parse(t.at) >= earliest)
    .sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  if (!touches.length) return { status: 'resolved', source_type: 'unknown', platform: null, basis: 'no tracked visits linked to this quote' };
  if (!inWindow.length) return { status: 'resolved', source_type: 'unknown', platform: null, basis: 'tracked visits are outside the lookback window' };
  let pick;
  if (rules.directRule === 'direct_replaces') pick = inWindow[inWindow.length - 1];
  else pick = [...inWindow].reverse().find((t) => t.source_type !== 'direct') || inWindow[inWindow.length - 1];
  return {
    status: 'resolved',
    source_type: pick.source_type,
    platform: pick.platform || null,
    campaign_ref: pick.campaign_ref || null,
    ad_ref: pick.ad_ref || null,
    touch_at: pick.at,
    basis: 'last tracked source before quote',
  };
}

// ---- Counting ---------------------------------------------------------------------------------------
const distinct = (arr) => new Set(arr);

// Unique customers are recomputed from events for the exact range being displayed. Daily or per-channel
// counts are never added together.
function uniqueCustomers(events) {
  return distinct(events.map((e) => e.customer_id)).size;
}

// Per-group unique customers with explicit overlap disclosure.
function uniqueByGroup(events, groupOf) {
  const byGroup = new Map();
  for (const e of events) {
    const g = groupOf(e);
    if (g == null) continue;
    if (!byGroup.has(g)) byGroup.set(g, new Set());
    byGroup.get(g).add(e.customer_id);
  }
  const all = new Set();
  let sum = 0;
  const groups = {};
  for (const [g, s] of byGroup) {
    groups[g] = s.size;
    sum += s.size;
    s.forEach((c) => all.add(c));
  }
  return { groups, uniqueTotal: all.size, sumOfGroups: sum, overlap: sum - all.size };
}

// ---- Commission ------------------------------------------------------------------------------------
function commissionSummary(txns) {
  let receipts = 0, reversals = 0, adjustments = 0;
  for (const t of txns) {
    if (t.type === 'receipt') receipts += t.amount_cents;
    else if (t.type === 'reversal') reversals += t.amount_cents;
    else adjustments += t.amount_cents;
  }
  return {
    grossReceiptsCents: receipts,
    reversalsCents: reversals, // negative
    adjustmentsCents: adjustments, // signed
    netReceivedCents: receipts + reversals + adjustments,
  };
}

// Outstanding balance only for policies that have at least one MATCHED transaction. Unmatched money is excluded.
function outstandingByPolicy(policies, txns) {
  const matched = new Map();
  for (const t of txns) {
    if (t.policy_id == null) continue;
    matched.set(t.policy_id, (matched.get(t.policy_id) || 0) + t.amount_cents);
  }
  const rows = [];
  for (const p of policies) {
    if (!matched.has(p.id)) continue;
    rows.push({ policy_id: p.id, expected_cents: p.expected_commission_cents, net_matched_cents: matched.get(p.id), outstanding_cents: p.expected_commission_cents - matched.get(p.id) });
  }
  return rows;
}

module.exports = {
  NA, ctr, cpc, costPer, expectedCommissionCents, selectNonOverlapping, adTotals,
  resolveAttribution, uniqueCustomers, uniqueByGroup, commissionSummary, outstandingByPolicy,
};
