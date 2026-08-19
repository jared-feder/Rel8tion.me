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
  const originalKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  try {
    process.env.SUPABASE_URL = 'https://example.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-test';
    delete require.cache[require.resolve('../lib/admin-auth')];
    delete require.cache[require.resolve('../lib/event-pass-registration')];
    return await run(require('../lib/event-pass-registration'));
  } finally {
    global.fetch = originalFetch;
    if (originalUrl === undefined) delete process.env.SUPABASE_URL; else process.env.SUPABASE_URL = originalUrl;
    if (originalKey === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY; else process.env.SUPABASE_SERVICE_ROLE_KEY = originalKey;
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
  assert.match(page, /type="checkbox"/);
  assert.match(page, /officer\?\.photo_url/);
});

test('full membership uses the $29 catalog price and lists the unlocked product value', () => {
  const monthly = catalog.products.rel8tion_agent_monthly;
  assert.equal(monthly.amount_cents, 2900);
  assert.match(page, /Remove the sponsorship message and unlock everything/);
  assert.match(page, /digital business card and networking tool/);
  assert.match(page, /permanent agent dashboard/);
  assert.match(page, /automated and REL8TION-assisted follow-up/i);
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
  const consentIndex = registration.indexOf('const consent = await recordSponsoredReuseConsent');
  const sessionIndex = registration.indexOf('const session = await upsertSponsoredReuseSession');
  const signLiveIndex = registration.indexOf('const signRows = await supabaseRest', consentIndex);
  assert.ok(consentIndex >= 0 && sessionIndex > consentIndex && signLiveIndex > sessionIndex);
});

test('reused Event Pass keeps the initial event loan officer and otherwise defaults to Brian Puls', async () => {
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
          full_name: 'Brian Puls',
          company_name: 'NMB',
          is_active: true
        }]);
      }
      assert.fail(`Unexpected request: ${target}`);
    };

    const fallback = await freshRegistration.resolveReusableEventPassSponsor({ signId: 'sign-one' });
    assert.equal(fallback.source, 'default_brian_puls');
    assert.equal(fallback.profile.full_name, 'Brian Puls');
    assert.equal(fallback.profile.uid, '7e05fcf5-18de-4ba1-b689-b944602ed4ca');
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
