const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.join(__dirname, '..');
const page = fs.readFileSync(path.join(root, 'apps/rel8tion-app/event-pass-reuse.html'), 'utf8');
const activation = fs.readFileSync(path.join(root, 'apps/rel8tion-app/sign-demo-activate.html'), 'utf8');
const registration = fs.readFileSync(path.join(root, 'lib/event-pass-registration.js'), 'utf8');
const catalog = JSON.parse(fs.readFileSync(path.join(root, 'config/pricing-catalog.json'), 'utf8'));
const eventPassAction = require('../api/event-pass/action');
const membershipReturn = require('../api/checkout/agent-membership-return');

function inlineScripts(html) {
  return [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)].map((match) => match[1]);
}

async function withFreshRegistration(run) {
  const originalFetch = global.fetch;
  const originalUrl = process.env.SUPABASE_URL;
  const serviceRoleEnv = ['SUPABASE', 'SERVICE', 'ROLE', 'KEY'].join('_');
  const originalKey = process.env[serviceRoleEnv];
  try {
    process.env.SUPABASE_URL = 'https://example.supabase.co';
    process.env[serviceRoleEnv] = 'test-value';
    delete require.cache[require.resolve('../lib/admin-auth')];
    delete require.cache[require.resolve('../lib/event-pass-registration')];
    return await run(require('../lib/event-pass-registration'));
  } finally {
    global.fetch = originalFetch;
    if (originalUrl === undefined) delete process.env.SUPABASE_URL; else process.env.SUPABASE_URL = originalUrl;
    if (originalKey === undefined) delete process.env[serviceRoleEnv]; else process.env[serviceRoleEnv] = originalKey;
    delete require.cache[require.resolve('../lib/admin-auth')];
    delete require.cache[require.resolve('../lib/event-pass-registration')];
  }
}

function jsonResponse(body) {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
}

test('membership-required activation preserves the selected Event Pass context', () => {
  const route = eventPassAction.membershipRoute({
    uid: 'physical-pass-uid',
    agent_slug: 'agent-one',
    public_code: 'ep-123',
    sign_id: 'sign-one',
    open_house_id: 'house-one',
    supporting_listing_agent: true
  });
  const parsed = new URL(route, 'https://app.rel8tion.me');
  assert.equal(parsed.pathname, '/event-pass-reuse');
  assert.equal(parsed.searchParams.get('uid'), 'physical-pass-uid');
  assert.equal(parsed.searchParams.get('agent'), 'agent-one');
  assert.equal(parsed.searchParams.get('code'), 'ep-123');
  assert.equal(parsed.searchParams.get('sign_id'), 'sign-one');
  assert.equal(parsed.searchParams.get('open_house_id'), 'house-one');
  assert.equal(parsed.searchParams.get('supporting_listing_agent'), 'true');
});

test('activation replaces the warning with the dedicated reuse page instead of repeating the NFC prompt', () => {
  assert.match(activation, /res\.status===402&&data\.membership_url/);
  assert.match(activation, /window\.location\.replace\(data\.membership_url\)/);
  assert.match(activation, /redirectError\.redirecting=true/);
  assert.doesNotMatch(page, /tap the nfc to continue membership setup/i);
});

test('reuse page puts the loan-officer-sponsored option first and clearly describes limited access', () => {
  const sponsorIndex = page.indexOf('Option 1 · Sponsored open house');
  const membershipIndex = page.indexOf('Option 2 · Full REL8TION');
  assert.ok(sponsorIndex >= 0 && membershipIndex > sponsorIndex);
  assert.match(page, /Your loan officer will sponsor this open house as well/);
  assert.match(page, /thank them and stay in contact/i);
  assert.match(page, /lasting REL8TIONship/);
  assert.match(page, /This is a limited version of REL8TION/);
  assert.match(page, /receive event check-in visibility/);
  assert.match(page, /Free, event-only version/);
  assert.match(page, /emails the event recap/);
  assert.match(page, /not remain in your permanent dashboard, disclosure library, analytics, or reports/);
  assert.match(page, /type="checkbox"/);
  assert.match(page, /officer\?\.photo_url/);
});

test('full membership uses the $29 catalog price and separates permanent software from one-time hardware', () => {
  const monthly = catalog.products.rel8tion_agent_monthly;
  assert.equal(monthly.amount_cents, 2900);
  assert.match(page, /Keep every event record and unlock the full agent system/);
  assert.match(page, /Your Event Pass remains event hardware/);
  assert.match(page, /Permanent check-in records/);
  assert.match(page, /Permanent signed disclosure records/);
  assert.match(page, /Event analytics and reporting/);
  assert.match(page, /automated and REL8TION-assisted follow-up/i);
  assert.match(page, /\$199 one time/);
  assert.doesNotMatch(page, /transforms this same Rel8tionChip/i);
  assert.match(page, /data\.plan\.label/);
});

test('sponsor authorization is re-resolved and recorded on the server before a pass goes live', () => {
  assert.match(registration, /sponsoredReuseRequested/);
  assert.match(registration, /body\.consent_accepted !== true/);
  assert.match(page, /consent_accepted: reuseMode === 'loan_officer_sponsored'/);
  assert.match(registration, /resolveReusableEventPassSponsor\(\{/);
  assert.match(registration, /The selected loan officer is not the server-assigned sponsor/);
  assert.match(registration, /recordSponsoredReuseConsent\(\{/);
  assert.match(registration, /upsertSponsoredReuseSession\(\{/);
  assert.match(registration, /event_access_mode: eventAccessMode/);
  assert.match(registration, /agent_dashboard_retention: sponsor \? 'event_only' : 'permanent'/);
  const consentIndex = registration.indexOf('const consent = await recordSponsoredReuseConsent');
  const sessionIndex = registration.indexOf('const session = await upsertSponsoredReuseSession');
  const signLiveIndex = registration.indexOf('const signRows = await supabaseRest', consentIndex);
  assert.ok(consentIndex >= 0 && sessionIndex > consentIndex && signLiveIndex > sessionIndex);
});

test('reused Event Pass keeps the current first event loan officer and otherwise defaults to Jared Feder', async () => {
  await withFreshRegistration(async (freshRegistration) => {
    const originalUid = '11111111-1111-4111-8111-111111111111';
    global.fetch = async (url) => {
      const target = String(url);
      if (target.includes('/open_house_events?')) {
        return jsonResponse([{ id: 'initial-event', setup_context: {}, created_at: '2026-08-01T12:00:00Z' }]);
      }
      if (target.includes('/event_loan_officer_sessions?')) {
        return jsonResponse([{ open_house_event_id: 'initial-event', verified_profile_uid: originalUid }]);
      }
      if (target.includes(`/verified_profiles?uid=eq.${originalUid}`)) {
        return jsonResponse([{ uid: originalUid, full_name: 'Original Loan Officer', is_active: true }]);
      }
      assert.fail(`Unexpected request: ${target}`);
    };

    const original = await freshRegistration.resolveReusableEventPassSponsor({ signId: 'sign-one' });
    assert.equal(original.source, 'initial_event_loan_officer');
    assert.equal(original.profile.uid, originalUid);

    global.fetch = async (url) => {
      const target = String(url);
      if (target.includes('/open_house_events?')) {
        return jsonResponse([{ id: 'initial-event', setup_context: {}, created_at: '2026-08-01T12:00:00Z' }]);
      }
      if (target.includes('/event_loan_officer_sessions?')) return jsonResponse([]);
      if (target.includes(`/verified_profiles?uid=eq.${freshRegistration.DEFAULT_REUSABLE_EVENT_PASS_SPONSOR_UID}`)) {
        return jsonResponse([{
          uid: freshRegistration.DEFAULT_REUSABLE_EVENT_PASS_SPONSOR_UID,
          full_name: 'Jared Feder',
          company_name: 'NMB',
          is_active: true
        }]);
      }
      assert.fail(`Unexpected request: ${target}`);
    };

    const fallback = await freshRegistration.resolveReusableEventPassSponsor({ signId: 'sign-one' });
    assert.equal(fallback.source, 'default_jared_feder');
    assert.equal(fallback.profile.full_name, 'Jared Feder');
    assert.equal(fallback.profile.uid, '38e5ab84-c1a2-4107-9f05-47a6caeda341');
  });
});

test('checkout can safely resume the interrupted Event Pass registration', () => {
  assert.equal(
    membershipReturn.localReturnPath('/event-pass-reuse?uid=one&open_house_id=two', ''),
    '/event-pass-reuse?uid=one&open_house_id=two'
  );
  assert.equal(membershipReturn.localReturnPath('https://attacker.example/path', ''), '');
  assert.equal(membershipReturn.localReturnPath('//attacker.example/path', ''), '');
  assert.equal(
    membershipReturn.withNotice('/event-pass-reuse?uid=one', 'membership', 'active'),
    '/event-pass-reuse?uid=one&membership=active'
  );
});

test('new browser scripts parse successfully', () => {
  for (const [label, html] of [
    ['reuse page', page],
    ['root wrapper', fs.readFileSync(path.join(root, 'event-pass-reuse.html'), 'utf8')]
  ]) {
    const scripts = inlineScripts(html);
    assert.ok(scripts.length > 0, `${label} should contain a script`);
    scripts.forEach((script) => assert.doesNotThrow(() => new Function(script), label));
  }
});

test('Freshen starts one included registration, then the next use requires sponsorship or membership', async () => {
  await withFreshRegistration(async (api) => {
    const inventory = { metadata: { freshened_at: '2026-08-10T12:00:00.000Z', freshened_source: 'admin_event_pass_scanner' }, last_activated_at: null };
    // Freshen may end an older event after the reset timestamp; created_at defines its cycle.
    const history = [{ id: 'old-event', created_at: '2026-08-01T12:00:00.000Z', ended_at: '2026-08-10T12:01:00.000Z' }];
    let entitlements = [];
    global.fetch = async (value, options = {}) => {
      assert.equal(options.method || 'GET', 'GET');
      const url = new URL(value);
      if (url.pathname.endsWith('/open_house_events')) {
        const after = url.searchParams.get('created_at')?.slice(4);
        return jsonResponse(history.filter((event) => !after || event.created_at >= after));
      }
      if (url.pathname.endsWith('/pricing_entitlements')) return jsonResponse(entitlements);
      assert.fail(`Unexpected request: ${url.pathname}`);
    };
    await api.requireReusableEventPassMembership('agent-one', 'sign-one', inventory);
    history.push({ id: 'first-after-freshen', created_at: '2026-08-10T13:00:00.000Z', ended_at: '2026-08-10T15:00:00.000Z' });
    await assert.rejects(api.requireReusableEventPassMembership('agent-one', 'sign-one', inventory), (error) => error.code === 'event_pass_membership_required');
    entitlements = [{ status: 'active', role: 'real_estate_agent', entitlement_codes: ['agent_dashboard', 'digital_card'] }];
    await api.requireReusableEventPassMembership('agent-one', 'sign-one', inventory);
    entitlements = [];
    inventory.metadata.freshened_at = '2026-08-11T12:00:00.000Z';
    await api.requireReusableEventPassMembership('agent-one', 'sign-one', inventory);
    // Joining another pass's event also consumes this pass's included registration.
    inventory.last_activated_at = '2026-08-11T13:00:00.000Z';
    await assert.rejects(api.requireReusableEventPassMembership('agent-one', 'sign-one', inventory), (error) => error.status === 402);
    inventory.last_activated_at = null;
    inventory.metadata.freshened_source = 'untrusted';
    await assert.rejects(api.requireReusableEventPassMembership('agent-one', 'sign-one', inventory), (error) => error.status === 402);
    assert.equal(history.length, 2, 'old events remain intact');
  });
});

test('reuse options and sponsor lookup ignore events before the last admin Freshen', async () => {
  await withFreshRegistration(async (api) => {
    const inventory = { id: 'inventory-one', public_code: 'pass-one', smart_sign_id: 'sign-one', metadata: { freshened_at: '2026-08-10T12:00:00.000Z', freshened_source: 'admin_event_pass_scanner' } };
    const sign = { id: 'sign-one', public_code: 'pass-one', uid_primary: 'uid-one', owner_agent_slug: 'agent-one' };
    const house = { id: 'house-one', agent: 'Test Host', agent_phone: '5165550101', brokerage: 'Test Realty' };
    global.fetch = async (value, options = {}) => {
      assert.equal(options.method || 'GET', 'GET');
      const url = new URL(value);
      const table = url.pathname.split('/').at(-1);
      if (table === 'keys') return jsonResponse([{ claimed: true, agent_slug: 'agent-one' }]);
      if (table === 'smart_sign_inventory') return jsonResponse([inventory]);
      if (table === 'smart_signs') return jsonResponse([sign]);
      if (table === 'open_houses') return jsonResponse([house]);
      if (table === 'agents') return jsonResponse([{ slug: 'agent-one', name: house.agent, phone: house.agent_phone, brokerage: house.brokerage }]);
      if (table === 'listing_agents') return jsonResponse([{ name: house.agent, phone: house.agent_phone }]);
      if (table === 'pricing_entitlements') return jsonResponse([]);
      if (table === 'open_house_events') {
        assert.equal(url.searchParams.get('created_at'), 'gte.2026-08-10T12:00:00.000Z');
        return jsonResponse([]);
      }
      if (table === 'verified_profiles') {
        assert.equal(url.searchParams.get('uid'), `eq.${api.DEFAULT_REUSABLE_EVENT_PASS_SPONSOR_UID}`);
        return jsonResponse([{ uid: api.DEFAULT_REUSABLE_EVENT_PASS_SPONSOR_UID, full_name: 'Jared Feder', is_active: true, photo_url: 'https://example.test/jared.jpg' }]);
      }
      assert.fail(`Unexpected request: ${table}`);
    };
    const result = await api.loadEventPassReuseOptions({ uid: 'uid-one', agentSlug: 'agent-one', publicCode: 'pass-one', openHouseId: 'house-one' });
    assert.equal(result.reuse_required, false);
    assert.equal(result.sponsor.name, 'Jared Feder');
    assert.equal(result.sponsor.photo_url, 'https://example.test/jared.jpg');
    assert.equal(result.sponsor_source, 'default_jared_feder');
  });
});

test('a failed history check cannot silently grant another included registration', async () => {
  await withFreshRegistration(async (api) => {
    global.fetch = async () => new Response(JSON.stringify({ message: 'history unavailable' }), { status: 503 });
    await assert.rejects(api.requireReusableEventPassMembership('agent-one', 'sign-one'), /history unavailable/);
  });
});

test('first registration hides both reuse choices; later use displays Jared and membership', () => {
  const vm = require('node:vm');
  const script = inlineScripts(page).find((value) => value.includes('function renderOptions'));
  for (const reuseRequired of [false, true]) {
    const app = { innerHTML: '' };
    const controls = new Map();
    const context = { URLSearchParams, location: { search: '' }, document: {
      getElementById(id) {
        if (id === 'app') return app;
        if (!controls.has(id)) controls.set(id, { addEventListener(event, callback) { this[event] = callback; } });
        return controls.get(id);
      }
    } };
    vm.createContext(context);
    vm.runInContext(script.replace(/\binit\(\);\s*$/, ''), context);
    vm.runInContext(`state.context = ${JSON.stringify({ reuse_required: reuseRequired, house: { address: '35 Test Lane' }, sponsor: { name: 'Jared Feder', company: 'NMB' }, plan: { label: '$29/month' } })}; renderOptions();`, context);
    if (reuseRequired) {
      assert.match(app.innerHTML, /Jared Feder/);
      assert.match(app.innerHTML, /Enroll for \$29\/month/);
      assert.match(app.innerHTML, /sponsorConsent/);
    } else {
      assert.match(app.innerHTML, /Activate Open House/);
      assert.doesNotMatch(app.innerHTML, /Jared Feder|Brian Puls|sponsorConsent|membershipCheckoutButton|\$29/);
      assert.equal(typeof controls.get('firstUseButton').click, 'function');
    }
  }
});
