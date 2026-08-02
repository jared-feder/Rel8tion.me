#!/usr/bin/env node

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { publicPricingCatalog, readPricingCatalog } = require('../lib/pricing-catalog');

const ROOT = path.resolve(__dirname, '..');

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), 'utf8');
}

function invoke(handler, { method = 'GET', headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const response = {
      statusCode: 200,
      headers: {},
      setHeader(name, value) { this.headers[String(name).toLowerCase()] = value; },
      end(value = '') {
        try {
          resolve({ status: this.statusCode, headers: this.headers, payload: value ? JSON.parse(value) : null });
        } catch (error) {
          reject(error);
        }
      }
    };
    Promise.resolve(handler({ method, headers, body }, response)).catch(reject);
  });
}

async function run() {
  const catalog = readPricingCatalog();
  const products = catalog.products;
  const offers = catalog.offers;

  assert.equal(products.rel8tion_agent_monthly.amount_cents, 2900);
  assert.equal(products.rel8tion_agent_annual.amount_cents, 30000);
  assert.equal(products.rel8tion_agent_annual.annual_savings_cents, 4800);
  assert.equal(products.open_house_kit.amount_cents, 19900);
  assert.equal(offers.open_house_system_monthly.due_today_cents, 19900);
  assert.equal(offers.open_house_system_monthly.trial_days, 31);
  assert.equal(offers.open_house_system_annual.due_today_cents, 49900);
  assert.equal(offers.open_house_system_annual.renewal_cents, 30000);
  assert.equal(products.digital_you_annual.amount_cents, 19900);
  assert.equal(products.custom_domain_annual.amount_cents, 4900);
  assert.equal(products.lo_outreach_seat_monthly.active, false);
  assert.equal(products.lo_outreach_seat_monthly.amount_cents, null);
  assert.equal(products.lo_outreach_seat_annual.active, false);
  assert.equal(products.lo_outreach_seat_annual.amount_cents, null);
  assert.equal(products.sponsored_event_pass_standard.amount_cents, 4900);
  assert.equal(products.sponsored_event_pass_seat_member.amount_cents, 3900);
  assert.equal(products.sponsored_event_pass_standard.eligibility, 'loan_officer_dashboard');
  assert.equal(products.sponsored_event_pass_seat_member.eligibility, 'server_verified_active_outreach_seat');
  assert.equal(catalog.informational_offers.event_pass.stripe_checkout, false);
  assert.equal(catalog.informational_offers.requested_coverage.stripe_checkout, false);

  const publicPayload = publicPricingCatalog(catalog);
  assert.equal(publicPayload.version, catalog.version);
  assert.equal(publicPayload.products.lo_outreach_seat_monthly, undefined);
  assert.equal(publicPayload.products.lo_outreach_seat_annual, undefined);
  assert.equal(publicPayload.products.sponsored_event_pass_standard, undefined);
  assert.equal(publicPayload.products.sponsored_event_pass_seat_member, undefined);
  assert.equal(publicPayload.informational_offers.requested_coverage, undefined);
  assert.equal(publicPayload.informational_offers.loan_officer_private_consultation.booking_path, '/book-a-call?type=loan_officer');
  assert.equal(publicPayload.informational_offers.real_estate_broker_team_discounts.booking_path, '/book-a-call?type=broker_team');

  const webhook = require('../api/checkout/stripe-webhook');
  const seatEntitlement = webhook.pricingEntitlementPayload(
    { id: 'evt_test', type: 'checkout.session.completed' },
    {
      id: 'cs_test_seat',
      payment_status: 'paid',
      metadata: {
        plan_code: 'lo_outreach_seat_annual',
        role: 'loan_officer',
        entitlement_codes: 'outreach_seat_pending_approval,lo_dashboard',
        outreach_included: 'true'
      }
    }
  );
  assert.equal(seatEntitlement.status, 'active');
  assert.equal(seatEntitlement.seat_status, 'pending_approval');
  assert.equal(seatEntitlement.outreach_included, false);

  const entitlementMigration = read('supabase/migrations/20260802100949_pricing_entitlements.sql');
  assert.match(entitlementMigration, /enable row level security/i);
  assert.match(entitlementMigration, /force row level security/i);
  assert.match(entitlementMigration, /revoke all on table public\.pricing_entitlements from anon, authenticated/i);

  const publicApi = require('../api/public/pricing');
  for (const origin of ['https://rel8tion.me', 'https://www.rel8tion.me', 'https://app.rel8tion.me', 'https://getrel8tion.com', 'https://www.getrel8tion.com', 'https://my.rel8tion.me']) {
    const apiResponse = await invoke(publicApi, { headers: { origin } });
    assert.equal(apiResponse.status, 200);
    assert.equal(apiResponse.headers['access-control-allow-origin'], origin);
    assert.equal(apiResponse.payload.offers.open_house_system_annual.renewal_cents, 30000);
  }

  const builderRelativePath = 'apps/v0-real-estate-agent-template/app/get-started/page.tsx';
  if (fs.existsSync(path.join(ROOT, builderRelativePath))) {
    const builderPage = read(builderRelativePath);
    assert.match(builderPage, /https:\/\/getrel8tion\.com\/kit-intake\?plan=annual&source=website-builder/);
    assert.doesNotMatch(builderPage, /setSelectedPlan\([^)]*bundle/i);
  }

  const publicFiles = [
    'pricing.html',
    'apps/rel8tion-app/get-open-house-kit.html',
    'apps/rel8tion-app/kit-intake.html',
    'apps/rel8tion-app/book-a-call.html',
    'wordpress/pricing-section.html'
  ];
  for (const builderFile of [builderRelativePath, 'apps/v0-real-estate-agent-template/lib/products.ts', 'apps/v0-real-estate-agent-template/app/actions/stripe.ts']) {
    if (fs.existsSync(path.join(ROOT, builderFile))) publicFiles.push(builderFile);
  }
  const stalePattern = /\$10\s*\/\s*month|\$100\s*\/\s*year|\$20\s*\/\s*month|\$199\s+setup|\$299\s+(?:annual|kit)|\$498|summer\s+(?:offer|special|bundle|promotion)|ends\s+september\s+22|save\s+\$487|price_[A-Za-z0-9_]+/i;
  for (const file of publicFiles) {
    const source = read(file);
    assert.doesNotMatch(source, stalePattern, `${file} contains prohibited stale pricing.`);
  }
  const pricingPage = read('pricing.html');
  assert.match(pricingPage, /book-a-call\?type=loan_officer/);
  assert.match(pricingPage, /book-a-call\?type=broker_team/);
  assert.match(pricingPage, /flow:\s*'payment_first'/);
  assert.match(pricingPage, /checkout\/open-house-kit/);
  assert.doesNotMatch(pricingPage, /id="system-checkout"[^>]+href="\/kit-intake/);
  assert.doesNotMatch(pricingPage, /id="seat-price"|id="pass-standard-price"|id="pass-seat-price"/);
  const wordpressPricing = read('wordpress/pricing-section.html');
  assert.match(wordpressPricing, /checkout=agent&source=wordpress/);
  assert.match(wordpressPricing, /checkout=system&source=wordpress/);
  assert.doesNotMatch(wordpressPricing, /getrel8tion\.com\/kit-intake\?plan=/);

  const checkout = require('../api/checkout/open-house-kit');
  const originalFetch = global.fetch;
  const originalKey = process.env.STRIPE_SECRET_KEY;
  const checkoutRequests = [];
  process.env.STRIPE_SECRET_KEY = 'sk_test_not_a_real_key';
  global.fetch = async (url, options = {}) => {
    const requestUrl = String(url);
    if (requestUrl.includes('/v1/prices?')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          data: [
            { id: 'price_kit_catalog', active: true, lookup_key: 'open_house_kit', currency: 'usd', unit_amount: 19900 },
            { id: 'price_agent_monthly_catalog', active: true, lookup_key: 'rel8tion_agent_monthly', currency: 'usd', unit_amount: 2900, recurring: { interval: 'month', interval_count: 1 } },
            { id: 'price_agent_annual_catalog', active: true, lookup_key: 'rel8tion_agent_annual', currency: 'usd', unit_amount: 30000, recurring: { interval: 'year', interval_count: 1 } }
          ]
        })
      };
    }
    if (requestUrl.endsWith('/v1/checkout/sessions')) {
      checkoutRequests.push(new URLSearchParams(String(options.body)));
      return { ok: true, status: 200, json: async () => ({ id: 'cs_test_catalog', url: 'https://checkout.stripe.test/session' }) };
    }
    throw new Error(`Unexpected fetch: ${requestUrl}`);
  };

  try {
    const monthly = await invoke(checkout, { method: 'POST', headers: { host: 'getrel8tion.com' }, body: { plan: 'monthly', brokerage: 'Example Realty', flow: 'payment_first' } });
    assert.equal(monthly.status, 200);
    const monthlyParams = checkoutRequests.at(-1);
    assert.equal(monthlyParams.get('line_items[0][price]'), 'price_kit_catalog');
    assert.equal(monthlyParams.get('line_items[1][price]'), 'price_agent_monthly_catalog');
    assert.equal(monthlyParams.get('subscription_data[trial_period_days]'), '31');
    assert.equal(monthlyParams.get('metadata[plan_code]'), 'open_house_system_monthly');
    assert.equal(monthlyParams.get('metadata[kit_included]'), 'true');
    assert.equal(monthlyParams.get('metadata[branded_rel8tionchips]'), 'true');
    assert.equal(monthlyParams.get('metadata[website_included]'), 'true');
    assert.equal(monthlyParams.get('metadata[digital_card_included]'), 'true');
    assert.equal(monthlyParams.get('metadata[content_tools_included]'), 'true');
    assert.equal(monthlyParams.get('metadata[trial_days]'), '31');
    assert.equal(monthlyParams.get('metadata[branding_status]'), 'pending');
    assert.equal(monthlyParams.get('metadata[brokerage_name]'), 'Example Realty');
    assert.equal(monthlyParams.get('metadata[flow]'), 'payment_first');
    assert.equal(monthlyParams.has('billing_address_collection'), false);
    assert.equal(monthlyParams.has('phone_number_collection[enabled]'), false);
    assert.equal(monthlyParams.has('shipping_address_collection[allowed_countries][0]'), false);

    const annual = await invoke(checkout, { method: 'POST', headers: { host: 'getrel8tion.com' }, body: { plan: 'annual' } });
    assert.equal(annual.status, 200);
    const annualParams = checkoutRequests.at(-1);
    assert.equal(annualParams.get('line_items[0][price]'), 'price_kit_catalog');
    assert.equal(annualParams.get('line_items[1][price]'), 'price_agent_annual_catalog');
    assert.equal(annualParams.has('subscription_data[trial_period_days]'), false);
    assert.equal(annualParams.get('metadata[plan_code]'), 'open_house_system_annual');
    assert.equal(annualParams.get('metadata[annual_renewal_cents]'), '30000');

    const agentCheckout = require('../api/checkout/plan');
    const agentAnnual = await invoke(agentCheckout, {
      method: 'POST',
      headers: { host: 'app.rel8tion.me' },
      body: { plan_code: 'rel8tion_agent_annual', source: 'pricing_test' }
    });
    assert.equal(agentAnnual.status, 200);
    const agentParams = checkoutRequests.at(-1);
    assert.equal(agentParams.get('line_items[0][price]'), 'price_agent_annual_catalog');
    assert.equal(agentParams.has('line_items[1][price]'), false);
    assert.equal(agentParams.has('billing_address_collection'), false);
    assert.equal(agentParams.has('phone_number_collection[enabled]'), false);
    assert.equal(agentParams.has('shipping_address_collection[allowed_countries][0]'), false);
    assert.equal(agentParams.get('metadata[website_included]'), 'true');
    assert.equal(agentParams.get('metadata[digital_card_included]'), 'true');
    assert.equal(agentParams.get('metadata[content_tools_included]'), 'true');
  } finally {
    global.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.STRIPE_SECRET_KEY;
    else process.env.STRIPE_SECRET_KEY = originalKey;
  }

  console.log('Canonical pricing verification passed.');
}

if (require.main === module) {
  run().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}

module.exports = { run };
