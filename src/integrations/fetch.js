'use strict';
// Fetch (pet insurance) adapter.
//
// STATUS: DISABLED. No Fetch API documentation, credentials or written confirmation of customer-facing quoting
// access was available when this was built. The only public statement found (fetchpet.com/partners, via web search
// snippet) is that Fetch offers a "Partner Quote & Purchase API" obtained by contacting Fetch. No endpoints, fields,
// authentication, pricing responses, payment handoff, webhooks or reporting APIs are documented in this build, so
// NONE are implemented. This file defines the interface the rest of the app calls and refuses to fabricate results.
//
// To enable: obtain the documentation listed in docs/FETCH_DOCUMENTATION_NEEDED.md, then implement `createQuote`
// below against the real API, test it with your own credentials, and only then set FETCH_LIVE_ENABLED=true.

class QuoteUnavailableError extends Error {
  constructor(message) { super(message); this.name = 'QuoteUnavailableError'; this.code = 'unavailable'; }
}
class QuoteProviderError extends Error {
  constructor(message) { super(message); this.name = 'QuoteProviderError'; this.code = 'provider_error'; }
}

function createFetchAdapter(cfg) {
  return {
    provider: 'fetch',
    status() {
      if (!cfg.fetchLiveEnabled) return { state: 'disabled', detail: 'Documentation and access not yet confirmed. Live quoting is off.' };
      return { state: 'not_implemented', detail: 'FETCH_LIVE_ENABLED is true but no API client has been implemented or tested.' };
    },
    // Must return { providerQuoteId, premiumCents, paymentFrequency, coverage, handoffUrl } from REAL provider responses only.
    async createQuote(/* { customer, pet } */) {
      throw new QuoteUnavailableError('Live Fetch quoting is not enabled.');
    },
  };
}

module.exports = { createFetchAdapter, QuoteUnavailableError, QuoteProviderError };
