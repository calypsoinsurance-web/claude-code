'use strict';
// Honest capability registry. "documented" means a public source says the capability exists; it is NOT proof it works
// for this account. "tested" is only ever true after a real call with the owner's credentials succeeded.
// Documentation could not be read directly in the build environment (network blocked); the notes are from web-search
// snippets and must be confirmed against the official pages listed.
const INTEGRATIONS = [
  {
    key: 'fetch', name: 'Fetch (quotes, policies, reporting)',
    documented: 'Partial: Fetch partners page says a Partner Quote & Purchase API exists (access via contact form). No technical documentation found.',
    availableToAccount: 'Unknown — requires written confirmation from Fetch.',
    tested: false, implemented: false, fallback: 'CSV/XLSX import of quote, policy and commission reports',
    docs: ['https://www.fetchpet.com/partners'],
  },
  {
    key: 'meta', name: 'Meta Ads (Facebook + Instagram)',
    documented: 'Marketing API Insights with breakdowns incl. publisher_platform / platform_position (per search snippet of Meta breakdown docs). Link-click field names and definitions not verified here.',
    availableToAccount: 'Unknown — needs a Meta app, ads_read permission and app review/access level as Meta requires.',
    tested: false, implemented: false, fallback: 'CSV/XLSX advertising import',
    docs: ['https://developers.facebook.com/docs/marketing-api/insights/breakdowns'],
  },
  {
    key: 'tiktok', name: 'TikTok Ads',
    documented: 'Reporting endpoint exists per third-party examples only; official portal not readable here. Metric names/definitions unverified.',
    availableToAccount: 'Unknown — requires TikTok for Business developer app approval.',
    tested: false, implemented: false, fallback: 'CSV/XLSX advertising import',
    docs: ['https://business-api.tiktok.com/portal/docs'],
  },
  {
    key: 'google', name: 'Google Ads',
    documented: 'Google Ads API with developer-token access levels (test / basic / standard; per search snippets). Fields such as network segmentation unverified here.',
    availableToAccount: 'Unknown — requires developer token approval and OAuth.',
    tested: false, implemented: false, fallback: 'CSV/XLSX advertising import',
    docs: ['https://developers.google.com/google-ads/api/docs/access-levels'],
  },
  {
    key: 'linkedin', name: 'LinkedIn Ads',
    documented: 'Ads reporting (adAnalytics) with clicks and landingPageClicks fields per Microsoft Learn snippets. Program access requirements unverified here.',
    availableToAccount: 'Unknown — LinkedIn Marketing API access requires app approval.',
    tested: false, implemented: false, fallback: 'CSV/XLSX advertising import',
    docs: ['https://learn.microsoft.com/en-us/linkedin/marketing/integrations/ads-reporting/ads-reporting'],
  },
];

function integrationStatuses(db, fetchAdapter) {
  const rows = new Map(db.prepare('SELECT * FROM integration_status').all().map((r) => [r.key, r]));
  return INTEGRATIONS.map((i) => {
    const r = rows.get(i.key);
    const live = i.key === 'fetch' ? fetchAdapter.status() : { state: 'not_implemented', detail: 'No automatic sync implemented; documentation not verified and no tested credentials.' };
    return { ...i, live, lastSuccessAt: r ? r.last_success_at : null, lastError: r ? r.last_error : null, lastErrorAt: r ? r.last_error_at : null };
  });
}

module.exports = { INTEGRATIONS, integrationStatuses };
