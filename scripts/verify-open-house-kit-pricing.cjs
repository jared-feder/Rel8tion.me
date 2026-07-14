const assert = require('node:assert/strict');

const handler = require('../api/checkout/open-house-kit');
const kit = require('../lib/open-house-kit');

const SUMMER_IDS = {
  kit: 'price_1TtDAM2LIj1DZULXov7KGURt',
  monthly: 'price_1TtDAW2LIj1DZULXxOIiYamd',
  annual: 'price_1TtDAg2LIj1DZULXNl7mnBpo'
};

const STANDARD_IDS = {
  kit: 'price_1TYtd12LIj1DZULXtTeeeYSm',
  monthly: 'price_1TYtd52LIj1DZULX8ipqLz9X',
  annual: 'price_1TYtd62LIj1DZULXy58hBZ0I'
};

const PRICES = {
  [SUMMER_IDS.kit]: { unit_amount: 19900, type: 'one_time' },
  [SUMMER_IDS.monthly]: { unit_amount: 2900, type: 'recurring', recurring: { interval: 'month', interval_count: 1 } },
  [SUMMER_IDS.annual]: { unit_amount: 29900, type: 'recurring', recurring: { interval: 'year', interval_count: 1 } },
  [STANDARD_IDS.kit]: { unit_amount: 24999, type: 'one_time' },
  [STANDARD_IDS.monthly]: { unit_amount: 4999, type: 'recurring', recurring: { interval: 'month', interval_count: 1 } },
  [STANDARD_IDS.annual]: { unit_amount: 39999, type: 'recurring', recurring: { interval: 'year', interval_count: 1 } }
};

function response(status, payload) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => payload
  };
}

function mockRes() {
  return {
    statusCode: 200,
    headers: {},
    body: '',
    setHeader(name, value) {
      this.headers[String(name).toLowerCase()] = value;
    },
    end(body = '') {
      this.body = String(body);
    }
  };
}

async function invoke(method, body = null) {
  const req = {
    method,
    body,
    headers: { host: 'irel8.me', 'x-forwarded-proto': 'https' }
  };
  const res = mockRes();
  await handler(req, res);
  return {
    status: res.statusCode,
    payload: res.body ? JSON.parse(res.body) : null
  };
}

async function run() {
  const originalFetch = global.fetch;
  const originalEnv = { ...process.env };
  const checkoutRequests = [];

  process.env.STRIPE_SECRET_KEY = 'sk_test_verification';
  delete process.env.STRIPE_SUMMER_OPEN_HOUSE_KIT_PRICE_ID;
  delete process.env.STRIPE_SUMMER_EVENT_PASS_MONTHLY_PRICE_ID;
  delete process.env.STRIPE_SUMMER_EVENT_PASS_ANNUAL_PRICE_ID;
  delete process.env.STRIPE_OPEN_HOUSE_KIT_PRICE_ID;
  delete process.env.OPEN_HOUSE_KIT_PRICE_ID;
  delete process.env.STRIPE_EVENT_PASS_MONTHLY_PRICE_ID;
  delete process.env.STRIPE_EVENT_PASS_ANNUAL_PRICE_ID;

  global.fetch = async (url, options = {}) => {
    const text = String(url);
    if (text.includes('/v1/prices/')) {
      const priceId = decodeURIComponent(text.match(/\/v1\/prices\/([^?]+)/)?.[1] || '');
      const price = PRICES[priceId];
      assert.ok(price, `Unexpected Stripe Price requested: ${priceId}`);
      return response(200, {
        id: priceId,
        currency: 'usd',
        product: {
          name: `Product for ${priceId}`,
          description: 'Verification product description',
          images: ['https://example.com/product.jpg'],
          marketing_features: [{ name: 'Verification feature' }]
        },
        ...price
      });
    }
    if (text.endsWith('/v1/checkout/sessions')) {
      const params = new URLSearchParams(options.body);
      checkoutRequests.push(params);
      return response(200, {
        id: `cs_test_${checkoutRequests.length}`,
        url: `https://checkout.stripe.com/c/pay/cs_test_${checkoutRequests.length}`
      });
    }
    throw new Error(`Unexpected fetch: ${text}`);
  };

  try {
    process.env.STRIPE_SUMMER_PROMOTION_END = '2099-09-22T23:59:59-04:00';

    const pricing = await invoke('GET');
    assert.equal(pricing.status, 200);
    assert.equal(pricing.payload.promotion.active, true);
    assert.equal(pricing.payload.kit.amount, 19900);
    assert.equal(pricing.payload.monthly.amount, 2900);
    assert.equal(pricing.payload.monthly.due_today, 19900);
    assert.equal(pricing.payload.monthly.trial_days, 31);
    assert.equal(pricing.payload.annual.amount, 29900);
    assert.equal(pricing.payload.annual.due_today, 49800);
    assert.equal(pricing.payload.annual.website_builder_included, true);

    const monthly = await invoke('POST', {
      plan: 'monthly',
      source: 'getrel8tion_open_house_kit',
      email: 'agent@example.com'
    });
    assert.equal(monthly.status, 200);
    const monthlyParams = checkoutRequests.at(-1);
    assert.equal(monthlyParams.get('line_items[0][price]'), SUMMER_IDS.kit);
    assert.equal(monthlyParams.get('line_items[1][price]'), SUMMER_IDS.monthly);
    assert.equal(monthlyParams.get('subscription_data[trial_period_days]'), '31');
    assert.equal(monthlyParams.get('metadata[website_builder_included]'), 'false');

    const annual = await invoke('POST', {
      plan: 'annual',
      source: 'getrel8tion_open_house_kit',
      email: 'agent@example.com'
    });
    assert.equal(annual.status, 200);
    const annualParams = checkoutRequests.at(-1);
    assert.equal(annualParams.get('line_items[0][price]'), SUMMER_IDS.kit);
    assert.equal(annualParams.get('line_items[1][price]'), SUMMER_IDS.annual);
    assert.equal(annualParams.has('subscription_data[trial_period_days]'), false);
    assert.equal(annualParams.get('metadata[website_builder_included]'), 'true');
    assert.equal(annualParams.get('subscription_data[metadata][website_builder_included]'), 'true');

    const publicOrder = kit.publicOrder({
      stripe_checkout_session_id: 'cs_test_entitlement',
      metadata: {
        promotion: 'summer_2026',
        future_platform_upgrades_included: 'true',
        website_builder_included: 'true'
      }
    });
    assert.equal(publicOrder.website_builder_included, true);
    assert.match(publicOrder.website_builder_url, /^https:\/\/my\.rel8tion\.me\//);
    assert.match(publicOrder.website_builder_url, /promo=R8WEB-/);

    process.env.STRIPE_SUMMER_PROMOTION_END = '2000-09-22T23:59:59-04:00';
    const standard = await invoke('GET');
    assert.equal(standard.status, 200);
    assert.equal(standard.payload.promotion.active, false);
    assert.equal(standard.payload.kit.amount, 24999);
    assert.equal(standard.payload.monthly.due_today, 29998);
    assert.equal(standard.payload.monthly.trial_days, 0);
    assert.equal(standard.payload.annual.due_today, 64998);
    assert.equal(standard.payload.annual.website_builder_included, false);

    console.log('Open House Kit Summer pricing verification passed.');
  } finally {
    global.fetch = originalFetch;
    for (const key of Object.keys(process.env)) {
      if (!(key in originalEnv)) delete process.env[key];
    }
    Object.assign(process.env, originalEnv);
  }
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
