const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.join(__dirname, '..');
const router = fs.readFileSync(path.join(root, 'apps/rel8tion-app/k.html'), 'utf8');
const home = fs.readFileSync(path.join(root, 'apps/rel8tion-app/agent-home.html'), 'utf8');
const activation = fs.readFileSync(path.join(root, 'apps/rel8tion-app/sign-demo-activate.html'), 'utf8');
const claimFlow = fs.readFileSync(path.join(root, 'apps/rel8tion-app/src/modules/claimStyled/flow.js'), 'utf8');
const membership = require('../api/agent-membership');
const checkoutPlan = require('../api/checkout/plan');
const stripeWebhook = require('../api/checkout/stripe-webhook');
const eventPassRegistration = require('../lib/event-pass-registration');

test('inactive Event Pass NFC opens the membership home while a live pass opens its event dashboard', () => {
  const start = router.indexOf('if (isEventPassKeychain(record))');
  const end = router.indexOf("if (await maybeOpenLoanOfficerDashboard(record))", start);
  assert.notEqual(start, -1);
  assert.notEqual(end, -1);
  const block = router.slice(start, end);
  assert.match(block, /findActiveEventByActivationUid/);
  assert.match(block, /goToAgentDashboard/);
  assert.match(block, /goToAgentHome\(\{ agentSlug: record\.agent_slug, eventPassCode: eventPassSign\.public_code \}\)/);
  assert.doesNotMatch(block, /findRecentEventBySignId|Opening setup for the next open house/);
});

test('Event Pass owner home is membership-gated and starts reuse from the same NFC/QR pair', () => {
  assert.match(home, /event_pass_keychain/);
  assert.match(home, /loadAgentMembership/);
  assert.match(home, /renderMembershipGate/);
  assert.match(home, /source: 'event_pass_rel8tionchip'/);
  assert.match(home, /Start Open House/);
  assert.match(home, /source: 'event_pass'/);
  assert.match(home, /Event Pass remains event hardware/);
  assert.match(home, /\$199 Open House Kit/);
  assert.doesNotMatch(home, /Your Event Pass is now a Rel8tionChip/);
  assert.doesNotMatch(home, /No Open House Kit or separate Rel8tionChip purchase is required/);
  assert.match(home, /if \(keyRole !== 'event_pass_keychain'\) await ensureVerifiedPhoneSession\(\)/);
});

test('active REL8TION Agent entitlement requires dashboard and digital-card codes', () => {
  assert.equal(membership.isAgentMembership({
    status: 'active',
    role: 'real_estate_agent',
    entitlement_codes: ['agent_dashboard', 'digital_card']
  }), true);
  assert.equal(membership.isAgentMembership({
    status: 'active',
    role: 'real_estate_agent',
    entitlement_codes: ['digital_card']
  }), false);
  assert.equal(membership.isAgentMembership({
    status: 'canceled',
    role: 'real_estate_agent',
    entitlement_codes: ['agent_dashboard', 'digital_card']
  }), false);
  assert.equal(eventPassRegistration.isActiveAgentMembership({
    status: 'active',
    role: 'real_estate_agent',
    entitlement_codes: ['agent_dashboard', 'digital_card']
  }), true);
});

test('first Event Pass event is free but later reuse fails closed without paid membership', async () => {
  const originalFetch = global.fetch;
  const originalUrl = process.env.SUPABASE_URL;
  const originalKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  let history = [];
  let entitlements = [];
  try {
    process.env.SUPABASE_URL = 'https://example.supabase.test';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-test';
    delete require.cache[require.resolve('../lib/admin-auth')];
    delete require.cache[require.resolve('../lib/event-pass-registration')];
    const freshRegistration = require('../lib/event-pass-registration');
    global.fetch = async (url) => {
      const target = String(url);
      const body = target.includes('/open_house_events?') ? history : target.includes('/pricing_entitlements?') ? entitlements : [];
      return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
    };

    await freshRegistration.requireReusableEventPassMembership('agent-one', 'sign-one');
    history = [{ id: 'ended-event' }];
    await assert.rejects(
      () => freshRegistration.requireReusableEventPassMembership('agent-one', 'sign-one'),
      (error) => error.status === 402
        && error.code === 'event_pass_membership_required'
        && /sponsorship or REL8TION Agent membership/i.test(error.message)
    );
    entitlements = [{ status: 'active', role: 'real_estate_agent', entitlement_codes: ['agent_dashboard', 'digital_card'] }];
    await freshRegistration.requireReusableEventPassMembership('agent-one', 'sign-one');
  } finally {
    global.fetch = originalFetch;
    delete require.cache[require.resolve('../lib/event-pass-registration')];
    delete require.cache[require.resolve('../lib/admin-auth')];
    if (originalUrl === undefined) delete process.env.SUPABASE_URL; else process.env.SUPABASE_URL = originalUrl;
    if (originalKey === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY; else process.env.SUPABASE_SERVICE_ROLE_KEY = originalKey;
  }
});

test('membership checkout identifiers and return paths are bounded', () => {
  assert.match(checkoutPlan.integrationIdentifier(), /^rel8tion_agent_[a-z]{8}$/);
  assert.equal(checkoutPlan.localReturnPath('/agent-home?agent=test'), '/agent-home?agent=test');
  assert.equal(checkoutPlan.localReturnPath('https://attacker.example'), '/pricing');
  assert.equal(checkoutPlan.localReturnPath('//attacker.example'), '/pricing');
});

test('Event Pass membership checkout binds Stripe metadata to the claimed NFC owner', async () => {
  const originalFetch = global.fetch;
  const originalEnv = {
    SUPABASE_URL: process.env.SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
    STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY
  };
  let checkoutBody = '';
  try {
    process.env.SUPABASE_URL = 'https://example.supabase.test';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-test';
    process.env.STRIPE_SECRET_KEY = 'sk_test_placeholder';
    delete require.cache[require.resolve('../lib/admin-auth')];
    delete require.cache[require.resolve('../api/checkout/plan')];
    const checkoutHandler = require('../api/checkout/plan');
    global.fetch = async (url, options = {}) => {
      const target = String(url);
      if (target.includes('/rest/v1/keys?')) {
        return new Response(JSON.stringify([{ uid: 'event-pass-uid' }]), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      if (target.includes('/v1/prices?')) {
        return new Response(JSON.stringify({ data: [{
          id: 'price_agent_monthly',
          lookup_key: 'rel8tion_agent_monthly',
          unit_amount: 2900,
          currency: 'usd',
          recurring: { interval: 'month', interval_count: 1 }
        }] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      if (target.endsWith('/v1/checkout/sessions')) {
        checkoutBody = String(options.body || '');
        assert.equal(options.headers['Stripe-Version'], '2026-06-24.dahlia');
        return new Response(JSON.stringify({ id: 'cs_test_123', url: 'https://checkout.stripe.test/session' }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      throw new Error(`Unexpected fetch: ${target}`);
    };

    const req = {
      method: 'POST',
      headers: { host: 'app.rel8tion.me', 'x-forwarded-proto': 'https' },
      body: {
        plan_code: 'rel8tion_agent_monthly',
        source: 'event_pass_rel8tionchip',
        agent_slug: 'agent-one',
        uid: 'event-pass-uid',
        email: 'agent@example.test',
        return_path: '/event-pass-reuse?uid=event-pass-uid&agent=agent-one&code=ep-one&open_house_id=house-one'
      }
    };
    const result = await new Promise((resolve) => {
      const res = {
        statusCode: 200,
        headers: {},
        setHeader(name, value) { this.headers[String(name).toLowerCase()] = value; },
        end(body) { resolve({ status: this.statusCode, payload: JSON.parse(body || '{}') }); }
      };
      checkoutHandler(req, res);
    });
    assert.equal(result.status, 200, JSON.stringify(result.payload));
    const params = new URLSearchParams(checkoutBody);
    assert.equal(params.get('metadata[agent_slug]'), 'agent-one');
    assert.equal(params.get('metadata[uid]'), 'event-pass-uid');
    assert.equal(params.get('metadata[return_path]'), '/event-pass-reuse?uid=event-pass-uid&agent=agent-one&code=ep-one&open_house_id=house-one');
    assert.match(params.get('cancel_url'), /\/event-pass-reuse\?/);
    assert.match(params.get('cancel_url'), /membership=canceled/);
    assert.match(params.get('success_url'), /\/api\/checkout\/agent-membership-return\?session_id=\{CHECKOUT_SESSION_ID\}/);
    assert.match(params.get('integration_identifier'), /^rel8tion_agent_[a-z]{8}$/);
    assert.equal(params.has('payment_method_types[0]'), false);
  } finally {
    global.fetch = originalFetch;
    delete require.cache[require.resolve('../api/checkout/plan')];
    delete require.cache[require.resolve('../lib/admin-auth')];
    Object.entries(originalEnv).forEach(([key, value]) => {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    });
  }
});

test('Stripe subscription lifecycle removes access when payment or subscription state changes', () => {
  assert.equal(stripeWebhook.lifecycleEntitlementStatus({ type: 'invoice.paid', data: { object: {} } }), 'active');
  assert.equal(stripeWebhook.lifecycleEntitlementStatus({ type: 'invoice.payment_failed', data: { object: {} } }), 'payment_failed');
  assert.equal(stripeWebhook.lifecycleEntitlementStatus({ type: 'customer.subscription.deleted', data: { object: { status: 'canceled' } } }), 'canceled');
  assert.equal(stripeWebhook.lifecycleSubscriptionId({
    type: 'invoice.paid',
    data: { object: { parent: { subscription_details: { subscription: 'sub_123' } } } }
  }), 'sub_123');
});

test('Event Pass role selection is explicit and unrelated listings still activate through the guarded server route', () => {
  assert.match(activation, /name="hostRelationship"/);
  assert.match(activation, /value="listing_agent"/);
  assert.match(activation, /value="same_brokerage_substitute"/);
  assert.match(activation, /fetch\('\/api\/event-pass\/action'/);
  assert.match(activation, /supporting_listing_agent:supporting/);
  const server = fs.readFileSync(path.join(root, 'lib/event-pass-registration.js'), 'utf8');
  assert.match(server, /requireReusableEventPassMembership\(key\.agent_slug, sign\.id\)/);
  assert.match(server, /pricing_entitlements\?subject_slug=eq\./);
  assert.match(server, /error\.status = 402/);
});

test('abandoned first-claim SMS flow is absent', () => {
  assert.doesNotMatch(claimFlow, /requestAgentClaimCode|showClaimVerification|Texting your verification code/);
});
