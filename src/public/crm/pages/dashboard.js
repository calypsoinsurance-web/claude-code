import { h, api, metric, stat, table, field, banner, money, cents, int, pct, daysAgo, todayStr, fmtTs } from '../lib.js';

const BLOCKER_TEXT = {
  reporting_currency: 'Reporting currency is not set, so spend cannot be totalled.',
  reporting_timezone: 'Reporting time zone is not set, so live quote timestamps cannot be assigned to calendar days.',
  'attribution_lookback_days / direct_rule': 'Attribution lookback window and direct-visit rule are not approved, so paid cost per quote/policy/buyer shows N/A.',
};

export async function dashboard(main) {
  const state = { from: daysAgo(29), to: todayStr(), platform: '', campaign: '', ad: '', tab: 'calendar' };
  const opts = await api('/filter-options');
  const body = h('div');
  const att = h('section', { class: 'card attention', 'aria-label': 'Needs your attention' });
  main.replaceChildren(h('h1', null, 'Dashboard'), att, filters(), body);
  loadAttention();

  async function loadAttention() {
    try {
      const [over, today, rev, set] = await Promise.all([api('/followups?filter=overdue'), api('/followups?filter=today'), api('/review'), api('/settings')]);
      const reviewN = rev.items.length + rev.unmatchedCommissions.length;
      const missing = set.decisions.filter((d) => !set.settings[d.key]).length;
      const row = (n, one, many, none, href, cta) => h('li', { class: n ? null : 'clear' }, h('span', { class: 'count' }, n ? String(n) : '✓'), h('span', null, n === 0 ? none : n === 1 ? one : many), n ? h('a', { class: 'btn secondary', href }, cta) : null);
      att.replaceChildren(h('h2', null, 'Needs your attention'),
        h('ul', null,
          row(over.rows.length, 'overdue follow-up', 'overdue follow-ups', 'No overdue follow-ups', '#/followups', 'Open follow-ups'),
          row(today.rows.length, 'follow-up due today', 'follow-ups due today', 'Nothing due today', '#/followups', 'Open follow-ups'),
          row(reviewN, 'imported item waiting for your decision (an uncertain customer match or an unmatched commission line)', 'imported items waiting for your decision (uncertain customer matches or unmatched commission lines)', 'No imported items waiting for review', '#/imports', 'Open imports'),
          row(missing, 'setup decision still open — some numbers show N/A until it is made', 'setup decisions still open — some numbers show N/A until they are made', 'All setup decisions are made', '#/settings', 'Open settings')));
    } catch (e) { att.replaceChildren(h('h2', null, 'Needs your attention'), h('p', { class: 'muted' }, `Could not load: ${e.message}`)); }
  }

  function filters() {
    const from = h('input', { type: 'date', value: state.from }); const to = h('input', { type: 'date', value: state.to });
    const platform = h('select', null, h('option', { value: '' }, 'All platforms'), opts.platforms.map((p) => h('option', { value: p }, p)));
    const campaign = h('select', null, h('option', { value: '' }, 'All campaigns'), opts.campaigns.map((c) => h('option', { value: c.campaign_id }, `${c.platform}: ${c.campaign_name || c.campaign_id}`)));
    const ad = h('select', null, h('option', { value: '' }, 'All ads'), opts.ads.map((c) => h('option', { value: c.ad_id }, `${c.platform}: ${c.ad_name || c.ad_id}`)));
    const preset = (label, n) => h('button', { type: 'button', class: 'secondary', onclick: () => { from.value = daysAgo(n); to.value = todayStr(); } }, label);
    return h('form', { class: 'filters', onsubmit: (e) => { e.preventDefault(); Object.assign(state, { from: from.value, to: to.value, platform: platform.value, campaign: campaign.value, ad: ad.value }); load(); } },
      field('From', from), field('To', to), field('Platform', platform), field('Campaign', campaign), field('Ad', ad),
      h('div', { class: 'actions' }, preset('7 days', 6), preset('30 days', 29), preset('90 days', 89), h('button', { type: 'submit' }, 'Apply')));
  }
  const qs = () => new URLSearchParams(Object.fromEntries(Object.entries({ from: state.from, to: state.to, platform: state.platform, campaign: state.campaign, ad: state.ad }).filter(([, v]) => v))).toString();

  async function load() {
    body.replaceChildren(h('p', { class: 'muted' }, 'Loading…'));
    try {
      const s = await api(`/summary?${qs()}`);
      const tabs = h('div', { class: 'tabs', role: 'tablist' }, [['calendar', 'Calendar activity'], ['acquisition', 'Acquisition']].map(([k, label]) =>
        h('button', { role: 'tab', 'aria-selected': String(state.tab === k), onclick: () => { state.tab = k; load(); } }, label)));
      const panel = h('div');
      body.replaceChildren(...s.blockers.map((b) => banner('', BLOCKER_TEXT[b] || b, ' ', h('a', { href: '#/settings' }, 'Open Settings'))), ...s.notes.map((n) => banner('', n)), tabs, panel,
        h('p', null, h('a', { class: 'btn secondary', href: `/api/export-summary.csv?${qs()}` }, 'Export this summary (CSV)')));
      if (state.tab === 'calendar') calendarPanel(panel, s); else await acquisitionPanel(panel);
    } catch (e) { body.replaceChildren(banner('error', e.message)); }
  }

  async function calendarPanel(panel, s) {
    const c = s.calendar; const a = c.advertising; const cur = s.currency;
    const adv = a ? [
      stat('Ad spend', money(a.spend, cur), a.otherCurrencies.length ? `Excludes other currencies: ${a.otherCurrencies.join(', ')}` : `${a.rowCount} non-overlapping rows`),
      stat('Impressions', int(a.impressions)),
      stat('Link clicks', int(a.linkClicks), a.clickDefinitions.join(' | ') || 'No link-click definition on record'),
      stat('Link CTR', metric(a.ctr, pct), a.rateNote),
      stat('CPC (link clicks)', metric(a.cpc, (v) => money(v, cur))),
    ] : [stat('Ad spend', h('span', { class: 'na' }, 'N/A'), 'Set reporting currency')];
    const co = c.commission;
    panel.replaceChildren(
      h('h2', null, 'Advertising'), h('div', { class: 'grid' }, adv),
      h('h2', null, 'Customers and policies in this period'),
      h('div', { class: 'grid' },
        stat('Unique quoted customers', int(c.quotedCustomers), `${int(c.quoteEvents)} quote events; multiple pets/repeat quotes count once`),
        stat('Issued policies (gross)', int(c.issuedPolicies), `${c.issuedPoliciesCancelledSoFar} cancelled so far · ${c.issuedPoliciesNotCancelled} not cancelled`),
        stat('Unique buying customers', int(c.buyingCustomers), 'Customers with ≥1 confirmed issued policy')),
      h('p', { class: 'muted' }, c.cancellationNote),
      h('h2', null, 'Paid cost metrics (calendar basis)'),
      h('p', { class: 'muted' }, s.costs.basis),
      h('div', { class: 'grid' },
        stat('Cost per quoted customer', metric(s.costs.costPerQuotedCustomer, (v) => money(v, cur)), s.costs.paidAttributed ? `${s.costs.paidAttributed.quotedCustomers} paid-attributed customers` : null),
        stat('Cost per issued policy', metric(s.costs.costPerIssuedPolicy, (v) => money(v, cur)), s.costs.paidAttributed ? `${s.costs.paidAttributed.issuedPolicies} paid-attributed policies` : null),
        stat('Cost per buying customer', metric(s.costs.costPerBuyingCustomer, (v) => money(v, cur)), s.costs.paidAttributed ? `${s.costs.paidAttributed.buyingCustomers} paid-attributed buyers` : null)),
      h('h2', null, 'Commission'),
      h('div', { class: 'grid' },
        stat('Original expected commission', cents(co.expectedOriginalCents), '$150 × distinct issued policies; unchanged by cancellations'),
        stat('Gross receipts', cents(co.grossReceiptsCents)), stat('Reversals', cents(co.reversalsCents)), stat('Other adjustments', cents(co.adjustmentsCents)),
        stat('Net received', cents(co.netReceivedCents), 'Signed sum by transaction date'),
        stat('Unmatched statement lines', int(co.unmatchedCount), `Net ${cents(co.unmatchedNetCents)} — kept separate, never allocated`)),
      h('p', { class: 'muted' }, `Outstanding balance — ${co.outstanding.basis} Policies included: ${co.outstanding.policiesIncluded}. Balance: ${cents(co.outstanding.cents)}.`),
      co.otherCurrencyWarning ? banner('', co.otherCurrencyWarning) : null,
      h('h2', null, 'By platform'),
      table('Paid outcomes by platform', ['Platform', { label: 'Spend', num: 1 }, { label: 'Link CTR', num: 1 }, { label: 'CPC', num: 1 }, { label: 'Quoted customers', num: 1 }, { label: 'Issued policies', num: 1 }, { label: 'Buying customers', num: 1 }, { label: 'Cost / quoted', num: 1 }, { label: 'Cost / policy', num: 1 }, { label: 'Cost / buyer', num: 1 }],
        s.byPlatform.map((p) => [p.platform, p.totals ? money(p.totals.spend, cur) : 'N/A', p.totals ? metric(p.totals.ctr, pct) : 'N/A', p.totals ? metric(p.totals.cpc, (v) => money(v, cur)) : 'N/A', p.quotedCustomers == null ? 'N/A' : int(p.quotedCustomers), p.issuedPolicies == null ? 'N/A' : int(p.issuedPolicies), p.buyingCustomers == null ? 'N/A' : int(p.buyingCustomers),
          metric(p.costPerQuotedCustomer, (v) => money(v, cur)), metric(p.costPerIssuedPolicy, (v) => money(v, cur)), metric(p.costPerBuyingCustomer, (v) => money(v, cur))]), { empty: 'No advertising data in this period. Import an advertising report on the Imports page.' }),
      s.overlap ? h('p', { class: 'muted' }, `Overlap: ${s.overlap.quotedCustomers.sumOfPlatforms} platform-level quoted customers vs ${s.overlap.quotedCustomers.unique} unique; ${s.overlap.buyingCustomers.sumOfPlatforms} vs ${s.overlap.buyingCustomers.unique} buyers. ${s.overlap.note}`) : null,
      h('h2', null, 'Not attributed to paid advertising'),
      h('p', { class: 'muted' }, s.unattributed.note),
      table('Unique quoted customers by attributed source type', ['Source type', { label: 'Customers', num: 1 }], Object.entries(s.unattributed.quotedCustomersBySource).map(([k, v]) => [k, int(v)]), { empty: 'No quotes in this period.' }),
      h('p', null, `Issued policies whose originating quote could not be identified (attribution Unknown): ${s.unattributed.issuedPoliciesWithUnknownOriginatingQuote}`),
      h('p', { class: 'muted' }, `Tracking coverage: ${s.coverage.quotesWithTrackingData} of ${s.coverage.quotesTotal} quotes have linked tracked visits. ${s.coverage.note}`),
      h('h2', null, 'Data freshness'),
      table('Last advertising import/sync per platform', ['Platform', 'Provenance', 'Latest report date', 'Last imported/synced'], s.freshness.advertising.map((f) => [f.platform, f.provenance === 'api' ? 'Automatic sync' : 'Manual file import', f.latest_report_date, fmtTs(f.last_imported)]), { empty: 'No advertising data has been imported yet.' }),
      h('p', { class: 'muted' }, `Last commission statement import: ${fmtTs(s.freshness.lastCommissionImport)}`),
      h('h2', null, 'Day-by-day activity'),
      h('div', { id: 'cal' }, 'Loading…'));
    const cal = await api(`/calendar?from=${state.from}&to=${state.to}`);
    panel.querySelector('#cal').replaceWith(h('div', null, h('p', { class: 'muted' }, 'Each day\'s unique customers are counted for that day only. Do not add days together; use the period totals above.'),
      table('Calendar activity', ['Date', { label: 'Ad spend', num: 1 }, { label: 'Quoted customers', num: 1 }, { label: 'Issued policies', num: 1 }, { label: 'Receipts', num: 1 }, { label: 'Reversals', num: 1 }],
        cal.days.map((d) => [d.date, d.spend == null ? 'N/A' : money(d.spend, s.currency), int(d.quotedCustomers), int(d.issuedPolicies), cents(d.receiptsCents), cents(d.reversalsCents)]), { empty: 'No activity in this period.' })));
  }

  async function acquisitionPanel(panel) {
    const a = await api(`/acquisition?from=${state.from}&to=${state.to}`);
    if (!a.enabled) { panel.replaceChildren(banner('', h('strong', null, 'Acquisition view is off. '), a.message, ' Missing: ', a.missing.join(', '), ' ', h('a', { href: '#/settings' }, 'Open Settings'))); return; }
    panel.replaceChildren(h('p', null, h('strong', null, `As of ${a.asOf}.`), ' ', a.definition), h('p', { class: 'muted' }, a.caveat),
      table('Acquisition groups (by month of first quote)', ['Month', { label: 'Customers', num: 1 }, { label: 'Paid', num: 1 }, { label: 'Organic', num: 1 }, { label: 'Referral', num: 1 }, { label: 'Direct', num: 1 }, { label: 'Unknown', num: 1 }, { label: 'Buying customers', num: 1 }, { label: 'Issued policies', num: 1 }, { label: 'Aggregate ad spend in month', num: 1 }, { label: 'Spend ÷ paid customers', num: 1 }, 'Days observed after month end', 'Tracking coverage', 'Status'],
        a.rows.map((r) => [r.month, int(r.customers), int(r.bySource.paid), int(r.bySource.organic), int(r.bySource.referral), int(r.bySource.direct), int(r.bySource.unknown), int(r.buyingCustomers), int(r.issuedPolicies), money(r.aggregateAdSpendInMonth, a.currency), metric(r.costPerPaidCustomer, (v) => money(v, a.currency)), String(r.daysObservedAfterGroupEnd), r.trackingCoverage, r.incomplete || 'Observed']),
        { empty: 'No customers fall into acquisition groups in this period.' }));
  }
  load();
}
