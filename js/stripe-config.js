/**
 * RegAnchor Stripe client config — single switch for test vs live.
 *
 * TEST MODE checklist:
 * 1. Set mode: 'test' below
 * 2. Paste your Test publishable key from
 *    https://dashboard.stripe.com/test/apikeys
 * 3. In Supabase → Edge Functions secrets, set STRIPE_SECRET_KEY to sk_test_…
 *    (and point subscription webhook to a test-mode endpoint secret)
 * 4. Edge functions auto-detect sk_test and build catalog prices in test
 *    (no need to re-copy live price IDs).
 *
 * Flip mode: 'live' and restore sk_live before production.
 */
(function (global) {
  var LIVE_PK = 'pk_live_51SVuGRRfSQTwpCt9hCFdOOyVJBOLgV1Gss5CxMOry1T3kKW3cE7IF8OhQzvXjBd9IjOCp941p4uc9R8RPolEvRVV00fiMjUyXQ';

  // Paste test publishable key from Dashboard → Developers → API keys → Test mode
  var TEST_PK = ''; // e.g. pk_test_51SVuGR...

  var cfg = {
    mode: 'test', // 'test' | 'live'

    keys: {
      test: TEST_PK,
      live: LIVE_PK
    },

    // Live catalog (used when mode === 'live')
    livePrices: {
      diagnostic: 'price_1T6iCTRfSQTwpCt9sEdFA1Qy',
      essentials: {
        monthly: 'price_1TD37VRfSQTwpCt9fmlCcuQh',
        annual: 'price_1TD37VRfSQTwpCt914LUfLrf'
      },
      professional: {
        monthly: 'price_1TD392RfSQTwpCt9yaJicEiY',
        annual: 'price_1TD3AbRfSQTwpCt969zGi3bD'
      }
    },

    publishableKey: function () {
      var k = this.keys[this.mode] || '';
      if (!k) {
        console.error('[RA Stripe] Missing ' + this.mode + ' publishable key in js/stripe-config.js');
      }
      return k;
    },

    /** @returns {boolean} */
    isTest: function () {
      return this.mode === 'test';
    },

    /** Price id for live; in test mode returns plan-slug token the edge function resolves. */
    priceId: function (product, period) {
      if (this.mode === 'test') {
        if (product === 'diagnostic') return 'test:diagnostic';
        return 'test:' + product + ':' + (period || 'monthly');
      }
      if (product === 'diagnostic') return this.livePrices.diagnostic;
      var p = this.livePrices[product];
      return p ? p[period || 'monthly'] : null;
    }
  };

  global.RA_STRIPE = cfg;
})(typeof window !== 'undefined' ? window : globalThis);
