const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const activationPath = path.join(__dirname, '../apps/rel8tion-app/sign-demo-activate.html');
const html = fs.readFileSync(activationPath, 'utf8');
const routerPath = path.join(__dirname, '../apps/rel8tion-app/k.html');
const routerHtml = fs.readFileSync(routerPath, 'utf8');

const registration = require('../lib/event-pass-registration');
const { canRebindFreshenedEventPass, matchingEventPassBackingSign } = registration;

test('only an explicitly Freshened inactive and unowned pass may replace a stale UID', () => {
  const inventory = {
    public_code: 'ep-test',
    smart_sign_id: null,
    claimed_at: null,
    metadata: {
      freshened_at: '2026-08-08T19:12:57.826Z',
      freshened_source: 'admin_event_pass_scanner'
    }
  };
  const stale = {
    id: 'sign-1',
    public_code: 'ep-test',
    status: 'inactive',
    owner_agent_slug: null,
    active_event_id: null,
    activation_method: 'event_pass_keychain'
  };

  assert.equal(canRebindFreshenedEventPass(inventory, null, stale), true);
  assert.equal(canRebindFreshenedEventPass({ ...inventory, claimed_at: '2026-08-08T19:15:00Z' }, null, stale), false);
  assert.equal(canRebindFreshenedEventPass({ ...inventory, metadata: {} }, null, stale), false);
  assert.equal(canRebindFreshenedEventPass(inventory, { id: 'another-sign' }, stale), false);
  assert.equal(canRebindFreshenedEventPass(inventory, null, { ...stale, status: 'active' }), false);
  assert.equal(canRebindFreshenedEventPass(inventory, null, { ...stale, owner_agent_slug: 'another-agent' }), false);
  assert.equal(canRebindFreshenedEventPass(inventory, null, { ...stale, active_event_id: 'event-1' }), false);
});

test('Event Pass backing-sign recovery reuses only the same QR and NFC pair', () => {
  const inventory = { public_code: 'ep-test' };
  const matching = {
    id: 'sign-1',
    public_code: 'ep-test',
    uid_primary: 'chip-1',
    activation_uid_primary: 'chip-1',
    activation_method: 'event_pass_keychain'
  };

  assert.equal(matchingEventPassBackingSign(inventory, 'chip-1', matching, matching), matching);
  assert.equal(matchingEventPassBackingSign(inventory, 'chip-1', null, matching), matching);
  assert.equal(matchingEventPassBackingSign(inventory, 'chip-1', null, null), null);
});

test('Event Pass backing-sign recovery rejects crossed QR and NFC records', () => {
  const inventory = { public_code: 'ep-test' };
  const otherCode = { id: 'sign-1', public_code: 'ep-other', uid_primary: 'chip-1' };
  const otherChip = {
    id: 'sign-2',
    public_code: 'ep-test',
    uid_primary: 'chip-2',
    activation_method: 'event_pass_keychain'
  };

  assert.throws(() => matchingEventPassBackingSign(inventory, 'chip-1', otherCode, null), /QR and NFC do not match/);
  assert.throws(() => matchingEventPassBackingSign(inventory, 'chip-1', null, otherChip), /QR and NFC do not match/);
  assert.throws(() => matchingEventPassBackingSign(inventory, 'chip-1', otherCode, otherChip), /QR and NFC do not match/);
});

test('activation page delegates Event Pass backing-sign creation to the protected server route', () => {
  for (const match of html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)) {
    if (match[1].trim()) new Function(match[1]);
  }

  assert.doesNotMatch(html, /createEventPassBackingSign/);
  assert.match(html, /const pendingSign=\{id:'',public_code:publicCode,uid_primary:state\.uid,inventory_pending:true\}/);
  assert.match(html, /fetch\('\/api\/event-pass\/action'/);
  assert.match(html, /sign_id:sign\?\.id\|\|''/);
  assert.match(fs.readFileSync(path.join(__dirname, '../lib/event-pass-registration.js'), 'utf8'), /ensureEventPassBackingSign/);
});

test('protected server route creates a fresh Event Pass backing sign with the claimed NFC and agent', async () => {
  const originalFetch = global.fetch;
  const originalUrl = process.env.SUPABASE_URL;
  const originalKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  let inserted = null;
  try {
    process.env.SUPABASE_URL = 'https://example.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-test';
    delete require.cache[require.resolve('../lib/admin-auth')];
    delete require.cache[require.resolve('../lib/event-pass-registration')];
    const freshRegistration = require('../lib/event-pass-registration');
    global.fetch = async (_url, options = {}) => {
      if (options.method === 'POST') {
        inserted = JSON.parse(options.body);
        return new Response(JSON.stringify([{ id: 'sign-new', ...inserted }]), {
          status: 201,
          headers: { 'Content-Type': 'application/json' }
        });
      }
      return new Response('[]', { status: 200, headers: { 'Content-Type': 'application/json' } });
    };

    const sign = await freshRegistration.ensureEventPassBackingSign({
      inventory: { id: 'inventory-1', public_code: 'ep-fresh', metadata: {} },
      uid: 'chip-fresh',
      agentSlug: 'agent-fresh'
    });
    assert.equal(sign.id, 'sign-new');
    assert.deepEqual(inserted, {
      public_code: 'ep-fresh',
      uid_primary: 'chip-fresh',
      owner_agent_slug: 'agent-fresh',
      status: 'inactive',
      activation_uid_primary: 'chip-fresh',
      primary_device_type: 'event_pass_keychain',
      activation_method: 'event_pass_keychain',
      setup_confirmed_at: inserted.setup_confirmed_at
    });
  } finally {
    global.fetch = originalFetch;
    if (originalUrl === undefined) delete process.env.SUPABASE_URL; else process.env.SUPABASE_URL = originalUrl;
    if (originalKey === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY; else process.env.SUPABASE_SERVICE_ROLE_KEY = originalKey;
    delete require.cache[require.resolve('../lib/admin-auth')];
    delete require.cache[require.resolve('../lib/event-pass-registration')];
  }
});

test('completed Event Pass history never creates a one-time-use activation lock', () => {
  assert.doesNotMatch(html, /one-event Event Pass|Event Pass has already been used/);
  assert.doesNotMatch(html, /eventPassRenewalAllowed|getRecentEventForSign/);
  assert.match(html, /already live for another open house\. End its current event before activating it again\./);
});

test('NFC router blocks only a currently active Event Pass, not an inactive pass with history', async () => {
  const start = routerHtml.indexOf('async function eventPassInventoryCurrentlyActive(');
  const end = routerHtml.indexOf('\n    async function findRemoteEventPassActivationSession', start);
  assert.notEqual(start, -1, 'eventPassInventoryCurrentlyActive must exist');
  assert.notEqual(end, -1, 'eventPassInventoryCurrentlyActive must end before the next helper');
  const source = routerHtml.slice(start, end);
  assert.doesNotMatch(source, /open_house_events|created_at|alreadyUsed/i);

  const makeCheck = (sign) => {
    const requests = [];
    const request = async (url) => {
      requests.push(url);
      return sign ? [sign] : [];
    };
    const check = new Function('request', `${source}; return eventPassInventoryCurrentlyActive;`)(request);
    return { check, requests };
  };

  const inactive = makeCheck({ id: 'sign-1', status: 'inactive', active_event_id: null });
  assert.equal(await inactive.check({ smart_sign_id: 'sign-1' }), false);
  assert.equal(inactive.requests.length, 1);

  const active = makeCheck({ id: 'sign-1', status: 'active', active_event_id: 'event-2' });
  assert.equal(await active.check({ smart_sign_id: 'sign-1' }), true);
  assert.equal(active.requests.length, 1);
});
