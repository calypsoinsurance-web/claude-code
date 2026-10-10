import { h, api, metric, table, field, banner, money, int, pct, daysAgo, todayStr } from '../lib.js';

export async function advertising(main) {
  const st = { from: daysAgo(29), to: todayStr(), platform: '' };
  const opts = await api('/filter-options');
  const out = h('div');
  const from = h('input', { type: 'date', value: st.from }); const to = h('input', { type: 'date', value: st.to });
  const platform = h('select', null, h('option', { value: '' }, 'All platforms'), opts.platforms.map((p) => h('option', { value: p }, p)));
  main.replaceChildren(h('h1', null, 'Advertising'),
    banner('', 'Spend shown here comes from ', h('strong', null, 'manually imported files'), ' unless a row says "Automatic sync". No platform is connected for automatic sync yet (see Settings → Integrations).'),
    h('form', { class: 'filters', onsubmit: (e) => { e.preventDefault(); Object.assign(st, { from: from.value, to: to.value, platform: platform.value }); load(); } }, field('From', from), field('To', to), field('Platform', platform), h('button', { type: 'submit' }, 'Apply'),
      h('a', { class: 'btn secondary', href: '#/imports' }, 'Import a report'), h('a', { class: 'btn secondary', href: '/api/export/advertising.csv' }, 'Export CSV')), out);
  async function load() {
    const p = new URLSearchParams({ from: st.from, to: st.to, ...(st.platform ? { platform: st.platform } : {}) });
    const [s, rec] = await Promise.all([api(`/summary?${p}`), api(`/ads/records?${p}`)]);
    const cur = s.currency;
    out.replaceChildren(
      s.blockers.includes('reporting_currency') ? banner('', 'Reporting currency is not set: totals are hidden. ', h('a', { href: '#/settings' }, 'Open Settings')) : null,
      h('h2', null, 'Campaigns'),
      table('Campaign performance', ['Platform', 'Campaign', { label: 'Spend', num: 1 }, { label: 'Impressions', num: 1 }, { label: 'Link clicks', num: 1 }, { label: 'Link CTR', num: 1 }, { label: 'CPC', num: 1 }, { label: 'Quoted customers', num: 1 }, { label: 'Issued policies', num: 1 }, { label: 'Cost / quoted', num: 1 }, { label: 'Cost / policy', num: 1 }],
        s.byCampaign.map((c) => [c.platform, c.campaign_name || c.campaign_id, c.totals ? money(c.totals.spend, cur) : 'N/A', c.totals ? int(c.totals.impressions) : 'N/A', c.totals ? int(c.totals.linkClicks) : 'N/A', c.totals ? metric(c.totals.ctr, pct) : 'N/A', c.totals ? metric(c.totals.cpc, (v) => money(v, cur)) : 'N/A',
          c.quotedCustomers == null ? 'N/A' : int(c.quotedCustomers), c.issuedPolicies == null ? 'N/A' : int(c.issuedPolicies), metric(c.costPerQuotedCustomer, (v) => money(v, cur)), metric(c.costPerIssuedPolicy, (v) => money(v, cur))]),
        { empty: 'No campaign-level rows in this period. Campaign tables need imported rows that include a campaign ID or name.' }),
      s.unmatchedCampaignRefs ? h('p', { class: 'muted' }, `${s.unmatchedCampaignRefs} paid-attributed quote(s) carry a campaign reference that matches no imported campaign ID, so they appear in platform totals but not in any campaign row.`) : null,
      h('h2', null, 'Channel / placement'),
      h('p', { class: 'muted' }, 'Facebook and Instagram appear separately only when the imported report contains a publisher-platform breakdown; otherwise Meta is shown combined. Google Ads network/placement is kept in its own columns.'),
      table('Spend by channel, network and placement', ['Platform', 'Channel', 'Network', 'Placement', { label: 'Spend', num: 1 }, { label: 'Impressions', num: 1 }, { label: 'Link clicks', num: 1 }],
        s.byChannel.map((c) => [c.platform, c.channel || '—', c.network || '—', c.placement || '—', money(c.totals.spend, cur), int(c.totals.impressions), int(c.totals.linkClicks)]), { empty: 'No breakdown rows imported (platforms are shown combined).' }),
      h('h2', null, 'Imported records'),
      table(`Records (${rec.total}; page ${rec.page})`, ['Date', 'Platform', 'Level', 'Campaign', 'Ad', 'Channel', { label: 'Spend', num: 1 }, { label: 'Impr.', num: 1 }, { label: 'Link clicks', num: 1 }, 'Click metric', 'Source'],
        rec.rows.map((r) => [r.report_date, r.platform, r.level, r.campaign_name || r.campaign_id || '—', r.ad_name || r.ad_id || '—', [r.channel, r.network, r.placement].filter(Boolean).join(' / ') || '—', money(r.spend_micros / 1e6, r.currency), int(r.impressions), int(r.link_clicks), r.link_click_metric || '—', r.provenance === 'api' ? 'Automatic sync' : 'File import']),
        { empty: 'No advertising records yet. Import a CSV/XLSX report from the Imports page.' }));
  }
  load();
}
