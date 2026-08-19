const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.join(__dirname, '..');
const catalog = JSON.parse(fs.readFileSync(path.join(root, 'config/pricing-catalog.json'), 'utf8'));
const dashboardApi = require('../api/agent-event-dashboard');
const kitCheckout = require('../api/checkout/open-house-kit');
const recap = require('../lib/event-recap-email');
const serviceRoleEnv = ['SUPABASE', 'SERVICE', 'ROLE', 'KEY'].join('_');

function inlineScripts(html) {
  return [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)].map((match) => match[1]);
}

test('the product ladder keeps monthly software and one-time member hardware separate', () => {
  const membership = catalog.products.rel8tion_agent_monthly;
  const hardware = catalog.products.open_house_kit;
  const memberOffer = catalog.offers.open_house_kit_member_hardware;
  assert.equal(membership.amount_cents, 2900);
  assert.equal(membership.billing_interval, 'month');
  assert.ok(membership.entitlement_codes.includes('event_analytics'));
  assert.ok(membership.entitlement_codes.includes('event_reporting'));
  assert.equal(hardware.amount_cents, 19900);
  assert.equal(hardware.billing_interval, 'one_time');
  assert.equal(memberOffer.checkout_mode, 'payment');
  assert.deepEqual(memberOffer.line_items, ['open_house_kit']);
  assert.equal(memberOffer.eligibility, 'server_verified_active_agent_membership');
  assert.equal(memberOffer.public, false);
  assert.equal(kitCheckout.selectedOfferCode('member_hardware'), 'open_house_kit_member_hardware');
  assert.equal(kitCheckout.activeAgentMembership({
    role: 'real_estate_agent',
    status: 'active',
    entitlement_codes: ['agent_dashboard', 'digital_card']
  }), true);
});

test('member hardware Checkout is one-time and fails open only after server membership verification', async () => {
  const originalFetch = global.fetch;
  const originalEnv = {
    SUPABASE_URL: process.env.SUPABASE_URL,
    [serviceRoleEnv]: process.env[serviceRoleEnv],
    AGENT_NFC_SESSION_SECRET: process.env.AGENT_NFC_SESSION_SECRET,
    STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY
  };
  let checkoutBody = '';
  try {
    process.env.SUPABASE_URL = 'https://example.supabase.test';
    process.env[serviceRoleEnv] = 'service-test';
    process.env.AGENT_NFC_SESSION_SECRET = 'product-ladder-session-secret';
    process.env.STRIPE_SECRET_KEY = 'sk_test_placeholder';
    for (const modulePath of ['../lib/admin-auth', '../lib/agent-nfc-session', '../api/checkout/open-house-kit']) {
      delete require.cache[require.resolve(modulePath)];
    }
    const session = require('../lib/agent-nfc-session');
    const checkout = require('../api/checkout/open-house-kit');
    const token = session.makeSession('agent-one', 'member-key', 'event_pass_keychain');
    global.fetch = async (url, options = {}) => {
      const target = String(url);
      if (target.includes('/rest/v1/keys?')) {
        return new Response(JSON.stringify([{ uid: 'member-key', agent_slug: 'agent-one', device_role: 'event_pass_keychain' }]), { status: 200 });
      }
      if (target.includes('/rest/v1/pricing_entitlements?')) {
        return new Response(JSON.stringify([{
          role: 'real_estate_agent',
          status: 'active',
          entitlement_codes: ['agent_dashboard', 'digital_card']
        }]), { status: 200 });
      }
      if (target.includes('/v1/prices?')) {
        return new Response(JSON.stringify({ data: [{
          id: 'price_kit',
          active: true,
          lookup_key: 'open_house_kit',
          currency: 'usd',
          unit_amount: 19900
        }] }), { status: 200 });
      }
      if (target.endsWith('/v1/checkout/sessions')) {
        checkoutBody = String(options.body || '');
        return new Response(JSON.stringify({ id: 'cs_member_hardware', url: 'https://checkout.stripe.test/member-hardware' }), { status: 200 });
      }
      throw new Error(`Unexpected request: ${target}`);
    };

    const result = await new Promise((resolve) => {
      const res = {
        statusCode: 200,
        headers: {},
        setHeader(name, value) { this.headers[String(name).toLowerCase()] = value; },
        end(body) { resolve({ status: this.statusCode, payload: JSON.parse(body || '{}') }); }
      };
      checkout({
        method: 'POST',
        headers: {
          host: 'app.rel8tion.me',
          cookie: `${session.SESSION_COOKIE}=${encodeURIComponent(token)}`
        },
        body: {
          plan: 'member_hardware',
          agent_slug: 'agent-one',
          uid: 'member-key',
          email: 'agent@example.test'
        }
      }, res);
    });
    assert.equal(result.status, 200, JSON.stringify(result.payload));
    const params = new URLSearchParams(checkoutBody);
    assert.equal(params.get('mode'), 'payment');
    assert.equal(params.get('line_items[0][price]'), 'price_kit');
    assert.equal(params.has('line_items[1][price]'), false);
    assert.equal(params.has('subscription_data[metadata][plan_code]'), false);
    assert.equal(params.get('metadata[plan_code]'), 'open_house_kit_member_hardware');
    assert.equal(params.get('metadata[product]'), 'open_house_kit_member_hardware');
    assert.equal(params.get('metadata[website_included]'), 'false');
    assert.equal(params.get('metadata[digital_card_included]'), 'false');
  } finally {
    global.fetch = originalFetch;
    for (const modulePath of ['../api/checkout/open-house-kit', '../lib/agent-nfc-session', '../lib/admin-auth']) {
      delete require.cache[require.resolve(modulePath)];
    }
    Object.entries(originalEnv).forEach(([key, value]) => {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    });
  }
});

test('sponsored event-only history is distinguishable from permanent member history', () => {
  assert.equal(dashboardApi.isSponsoredEventOnly({
    setup_context: { event_access_mode: 'sponsored_event_only' }
  }), true);
  assert.equal(dashboardApi.isSponsoredEventOnly({
    setup_context: { event_access_mode: 'member_permanent' }
  }), false);
  assert.equal(dashboardApi.isSponsoredEventOnly({
    setup_context: { flow: 'event-pass-sponsored-reuse', limited_rel8tion_version: true }
  }), true);
  const sponsored = { id: 'sponsored', setup_context: { event_access_mode: 'sponsored_event_only' } };
  const permanent = { id: 'permanent', setup_context: { event_access_mode: 'member_permanent' } };
  assert.deepEqual(dashboardApi.visibleAgentEvents([sponsored, permanent], false).map((event) => event.id), ['permanent']);
  assert.deepEqual(dashboardApi.visibleAgentEvents([sponsored, permanent], true).map((event) => event.id), ['sponsored', 'permanent']);
});

test('sponsored closeout recap is an emailed event copy, not a permanent-dashboard promise', () => {
  const built = recap.buildSponsoredEventRecap({
    event: { id: 'event-one', setup_context: { address: '1 Test Street' } },
    agent: { name: 'Test Agent' },
    checkins: [{
      visitor_name: 'Buyer One',
      visitor_email: 'buyer@example.test',
      metadata: {
        nys_agency_disclosure: {
          agency_disclosure_reviewed: true,
          seller_representation_acknowledged: true,
          agency_disclosure_signed_at: '2026-08-19T12:00:00Z'
        },
        rel8tion_courtesy_notice: {
          rel8tion_courtesy_acknowledged: true,
          rel8tion_courtesy_signed_at: '2026-08-19T12:00:00Z'
        },
        ny_discrimination_disclosure: {
          acknowledged: true,
          reviewed: true,
          esign_consent: true,
          e_signature_value: 'Buyer One'
        }
      }
    }]
  });
  assert.equal(built.checkin_count, 1);
  assert.equal(built.disclosure_count, 1);
  assert.match(built.html, /This email is your event copy/);
  assert.match(built.html, /not retained in your permanent agent dashboard/);
  assert.match(built.html, /preserves required compliance and audit evidence internally/);
});

test('paid Event Pass activation hands the verified agent into profile completion and back to the live event', () => {
  const reusePage = fs.readFileSync(path.join(root, 'apps/rel8tion-app/event-pass-reuse.html'), 'utf8');
  const registration = fs.readFileSync(path.join(root, 'lib/event-pass-registration.js'), 'utf8');
  const claimFlow = fs.readFileSync(path.join(root, 'apps/rel8tion-app/src/modules/claimStyled/flow.js'), 'utf8');

  assert.match(reusePage, /Your starter profile is already connected to the verified agent/);
  assert.match(reusePage, /Complete My Profile/);
  assert.match(reusePage, /Preview My Digital Business Card/);
  assert.match(registration, /profile_setup_url: profileSetupUrl/);
  assert.match(registration, /return_path=\$\{encodeURIComponent\(dashboardUrl\)\}/);
  assert.match(claimFlow, /params\.get\('edit'\) === 'profile'/);
  assert.match(claimFlow, /\['\/agent-dashboard', '\/agent-home'\]/);
  assert.match(claimFlow, /url\.searchParams\.set\('profile_saved', '1'\)/);
});

test('ended Event Pass offers member hardware only after active membership is confirmed', () => {
  const dashboard = fs.readFileSync(path.join(root, 'apps/rel8tion-app/agent-dashboard.html'), 'utf8');
  assert.match(dashboard, /const member = state\.membershipActive === true/);
  assert.match(dashboard, /const primaryActions = member && !sponsored/);
  assert.match(dashboard, /Member-only Open House Kit pricing appears after membership is active/);
  assert.match(dashboard, /Activate REL8TION Agent · \$29\/Month/);
});

test('sponsored closeout keeps the event active until check-ins load and the recap is delivered', () => {
  const source = fs.readFileSync(path.join(root, 'api/agent-event-dashboard.js'), 'utf8');
  const closeStart = source.indexOf('async function closeEvent');
  const closeEnd = source.indexOf('\nmodule.exports = async function handler', closeStart);
  const closeSource = source.slice(closeStart, closeEnd);
  const checkinQuery = closeSource.indexOf('event_checkins?open_house_event_id=eq.');
  const recapSend = closeSource.indexOf('await sendSponsoredEventRecap');
  const recapPersist = closeSource.indexOf('event_recap_email: recapEmail');
  const eventEnd = closeSource.indexOf("body: JSON.stringify({ status: 'ended'");

  assert.ok(checkinQuery >= 0);
  assert.doesNotMatch(closeSource.slice(checkinQuery, recapSend), /\.catch\(\(\) => \[\]\)/);
  assert.ok(recapSend < recapPersist && recapPersist < eventEnd, 'recap must be delivered and recorded before ending the event');
  assert.match(closeSource, /existingRecap\.status === 'sent'/);
  assert.match(closeSource, /if \(recapEmail\.status !== 'sent'\)/);
  assert.match(closeSource, /open house is still active; (?:try ending it again|confirm the agent email and try ending it again)/);
});

test('changed product-ladder browser scripts parse', () => {
  for (const file of [
    'apps/rel8tion-app/event-pass-reuse.html',
    'apps/rel8tion-app/agent-dashboard.html',
    'apps/rel8tion-app/agent-home.html',
    'apps/rel8tion-app/get-open-house-kit.html',
    'apps/rel8tion-app/kit-confirm.html',
    'apps/rel8tion-app/kit-intake.html'
  ]) {
    const html = fs.readFileSync(path.join(root, file), 'utf8');
    const scripts = inlineScripts(html);
    assert.ok(scripts.length, `${file} should contain a browser script`);
    scripts.forEach((source) => {
      const parsed = source.replace(/^\s*import\s+[^;]+;\s*$/gm, '');
      assert.doesNotThrow(() => new Function(parsed), file);
    });
  }
});
