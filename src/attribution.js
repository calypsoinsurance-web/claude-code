'use strict';
// Visit classification rules. These are explicit, listed on the Settings page, and deliberately conservative:
// anything that cannot be classified from the data present is "unknown". Nothing is inferred from timing.
//
// NOTE: click-identifier parameter names below follow common platform conventions. They were NOT verified
// against official documentation in the build session (documentation sites were unreachable). Verify before relying on them.
const CLICK_ID_PLATFORM = { fbclid: 'meta', gclid: 'google', wbraid: 'google', gbraid: 'google', ttclid: 'tiktok' };
const CLICK_ID_KEYS = Object.keys(CLICK_ID_PLATFORM).concat(['li_fat_id', 'msclkid']);
const UTM_SOURCE_PLATFORM = {
  facebook: 'meta', fb: 'meta', instagram: 'meta', ig: 'meta', meta: 'meta',
  tiktok: 'tiktok', google: 'google', linkedin: 'linkedin',
};
const PAID_MEDIUMS = new Set(['cpc', 'ppc', 'paid', 'paid_social', 'paidsocial', 'paid-social', 'display', 'cpm']);
const ORGANIC_MEDIUMS = new Set(['organic', 'social', 'organic_social']);
const SEARCH_ENGINE_HOSTS = ['google.', 'bing.', 'duckduckgo.', 'yahoo.', 'ecosia.', 'brave.'];

function hostOf(url) {
  try { return new URL(url).hostname.toLowerCase(); } catch { return null; }
}

function classifyVisit(v, ownHosts = []) {
  const medium = (v.utm_medium || '').toLowerCase();
  const source = (v.utm_source || '').toLowerCase();
  const clickIds = v.click_ids || {};
  const clickKey = Object.keys(clickIds).find((k) => CLICK_ID_PLATFORM[k]);
  const platformFromSource = UTM_SOURCE_PLATFORM[source] || null;

  if (clickKey || PAID_MEDIUMS.has(medium)) {
    return { source_type: 'paid', platform: (clickKey && CLICK_ID_PLATFORM[clickKey]) || platformFromSource };
  }
  if (ORGANIC_MEDIUMS.has(medium)) return { source_type: 'organic', platform: platformFromSource };
  const refHost = v.referrer ? hostOf(v.referrer) : null;
  if (!source && !medium && refHost && !ownHosts.includes(refHost)) {
    if (SEARCH_ENGINE_HOSTS.some((h) => refHost.includes(h))) return { source_type: 'organic', platform: null };
    return { source_type: 'referral', platform: null };
  }
  if (source || medium) return { source_type: 'unknown', platform: platformFromSource }; // tagged but unclassifiable
  if (!v.referrer) return { source_type: 'direct', platform: null };
  return { source_type: 'unknown', platform: null }; // own-site referrer with no tags
}

const clean = (s, n = 300) => (typeof s === 'string' ? s.trim().slice(0, n) : null) || null;

// Accept only known fields, bounded length.
function sanitizeVisitInput(b) {
  const clickIds = {};
  for (const k of CLICK_ID_KEYS) {
    const val = clean(b && b.click_ids && b.click_ids[k], 500);
    if (val) clickIds[k] = val;
  }
  return {
    visitor_id: clean(b.visitor_id, 64),
    landing_url: clean(b.landing_url, 500),
    referrer: clean(b.referrer, 500),
    utm_source: clean(b.utm_source), utm_medium: clean(b.utm_medium), utm_campaign: clean(b.utm_campaign),
    utm_content: clean(b.utm_content), utm_term: clean(b.utm_term), utm_id: clean(b.utm_id),
    click_ids: clickIds,
  };
}

module.exports = { classifyVisit, sanitizeVisitInput, CLICK_ID_KEYS, CLICK_ID_PLATFORM, UTM_SOURCE_PLATFORM, PAID_MEDIUMS };
