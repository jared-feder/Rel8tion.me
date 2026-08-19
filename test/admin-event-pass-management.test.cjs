const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.join(__dirname, '..');
const adminSource = fs.readFileSync(path.join(root, 'apps/rel8tion-app/admin.html'), 'utf8');
const { classifySignProduct, isEventPassBackingSign } = require('../lib/sign-product');

function response() {
  return {
    statusCode: 200,
    payload: null,
    headers: {},
    setHeader(name, value) {
      this.headers[name] = value;
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.payload = payload;
      return this;
    }
  };
}

test('Event Pass backing signs remain classified as Event Passes after either link or ownership is cleared', () => {
  assert.equal(classifySignProduct({ activation_method: 'event_pass_keychain' }, []), 'event_pass');
  assert.equal(classifySignProduct({ primary_device_type: 'event_pass_qr' }, []), 'event_pass');
  assert.equal(classifySignProduct({ secondary_device_type: 'event_pass_nfc' }, []), 'event_pass');
  assert.equal(classifySignProduct({}, ['event_pass']), 'event_pass');
  assert.equal(classifySignProduct({ activation_method: 'two_chip_setup', primary_device_type: 'buyer' }, ['smart_sign']), 'smart_sign');
  assert.equal(isEventPassBackingSign({}, []), false);
});

test('COMMAND separates normal Event Pass management from Smart Sign detach controls', () => {
  assert.match(adminSource, /row\.product_type !== 'event_pass'/);
  assert.match(adminSource, /renderRows\('Assigned Event Passes'/);
  assert.match(adminSource, /renderEventPassActions\(row\)/);
  assert.match(adminSource, /Event Pass backing records are managed above/);
  assert.match(adminSource, /if \(row\.pass_state === 'live'\) return 'Live'/);
  assert.match(adminSource, /row\.pass_state === 'live' \? row\.active_event_host \|\| 'Live event' : 'No live event'/);
});

test('COMMAND only renders assigned normal Event Passes with live and recently activated passes first', () => {
  assert.match(adminSource, /function eventPassIsAssigned\(row\)/);
  assert.match(adminSource, /row\?\.assigned_agent_slug \|\| row\?\.nfc_claimed \|\| row\?\.pass_state === 'live'/);
  assert.match(adminSource, /pass_model !== 'sponsored_agent_pass' && eventPassIsAssigned\(row\)/);
  assert.match(adminSource, /\.sort\(compareAssignedEventPasses\)/);
  assert.match(adminSource, /assignedEventPassSortValue\(right\) - assignedEventPassSortValue\(left\)/);
  assert.match(adminSource, /fresh unassigned inventory is hidden/);
  assert.doesNotMatch(adminSource, /eventPasses\.slice\(0, 80\)/);
});

test('detach_sign rejects Event Pass backing records before any production mutation', async () => {
  const originalFetch = global.fetch;
  const originalAdminToken = process.env.KEY_RESET_ADMIN_TOKEN;
  const originalUrl = process.env.SUPABASE_URL;
  const serviceKeyEnv = ['SUPABASE', 'SERVICE', 'ROLE', 'KEY'].join('_');
  const originalServiceKey = process.env[serviceKeyEnv];
  let patchCount = 0;

  try {
    process.env.KEY_RESET_ADMIN_TOKEN = 'test-admin-token';
    process.env.SUPABASE_URL = 'https://example.supabase.co';
    process.env[serviceKeyEnv] = ['test', 'service', 'role'].join('-');
    delete require.cache[require.resolve('../lib/admin-auth')];
    delete require.cache[require.resolve('../api/admin/sign-action')];

    global.fetch = async (url, options = {}) => {
      if (options.method === 'PATCH') patchCount += 1;
      const target = String(url);
      let rows = [];
      if (target.includes('/rest/v1/smart_signs?id=eq.sign-event-pass')) {
        rows = [{
          id: 'sign-event-pass',
          public_code: 'ep-test',
          status: 'inactive',
          activation_method: 'event_pass_keychain',
          primary_device_type: 'event_pass_qr'
        }];
      } else if (target.includes('/rest/v1/smart_sign_inventory?smart_sign_id=eq.sign-event-pass')) {
        rows = [{ inventory_type: 'event_pass' }];
      }
      return new Response(JSON.stringify(rows), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    };

    const handler = require('../api/admin/sign-action');
    const res = response();
    await handler({
      method: 'POST',
      headers: { 'x-admin-token': 'test-admin-token' },
      body: { action: 'detach_sign', sign_id: 'sign-event-pass', confirmation: 'REL8TION' }
    }, res);

    assert.equal(res.statusCode, 400);
    assert.match(res.payload.error, /Event Pass backing record/);
    assert.equal(patchCount, 0);
  } finally {
    global.fetch = originalFetch;
    if (originalAdminToken === undefined) delete process.env.KEY_RESET_ADMIN_TOKEN; else process.env.KEY_RESET_ADMIN_TOKEN = originalAdminToken;
    if (originalUrl === undefined) delete process.env.SUPABASE_URL; else process.env.SUPABASE_URL = originalUrl;
    if (originalServiceKey === undefined) delete process.env[serviceKeyEnv]; else process.env[serviceKeyEnv] = originalServiceKey;
    delete require.cache[require.resolve('../lib/admin-auth')];
    delete require.cache[require.resolve('../api/admin/sign-action')];
  }
});

test('Freshen clears NFC ownership when Event Pass identity comes from the linked inventory', async () => {
  const originalFetch = global.fetch;
  const originalAdminToken = process.env.KEY_RESET_ADMIN_TOKEN;
  const originalUrl = process.env.SUPABASE_URL;
  const serviceKeyEnv = ['SUPABASE', 'SERVICE', 'ROLE', 'KEY'].join('_');
  const originalServiceKey = process.env[serviceKeyEnv];
  let keyPatch = null;

  try {
    process.env.KEY_RESET_ADMIN_TOKEN = 'test-admin-token';
    process.env.SUPABASE_URL = 'https://example.supabase.co';
    process.env[serviceKeyEnv] = ['test', 'service', 'role'].join('-');
    delete require.cache[require.resolve('../lib/admin-auth')];
    delete require.cache[require.resolve('../api/admin/sign-action')];

    global.fetch = async (url, options = {}) => {
      const target = String(url);
      const method = options.method || 'GET';
      let rows = [];

      if (method === 'GET' && target.includes('/rest/v1/smart_sign_inventory?id=eq.inventory-event-pass')) {
        rows = [{
          id: 'inventory-event-pass',
          inventory_type: 'event_pass',
          public_code: 'ep-test',
          smart_sign_id: 'sign-event-pass',
          metadata: {}
        }];
      } else if (method === 'GET' && target.includes('/rest/v1/smart_signs?id=eq.sign-event-pass')) {
        rows = [{
          id: 'sign-event-pass',
          public_code: 'ep-test',
          status: 'inactive',
          uid_primary: 'event-pass-uid',
          activation_method: null,
          primary_device_type: null,
          secondary_device_type: null,
          active_event_id: null
        }];
      } else if (method === 'GET' && target.includes('/rest/v1/smart_sign_inventory?smart_sign_id=eq.sign-event-pass')) {
        rows = [{
          id: 'inventory-event-pass',
          inventory_type: 'event_pass',
          public_code: 'ep-test',
          smart_sign_id: 'sign-event-pass',
          metadata: {}
        }];
      } else if (method === 'GET' && target.includes('/rest/v1/open_house_events?smart_sign_id=eq.sign-event-pass')) {
        rows = [];
      } else if (method === 'GET' && target.includes('/rest/v1/keys?uid=eq.event-pass-uid')) {
        rows = [{
          uid: 'event-pass-uid',
          agent_slug: 'old-agent',
          claimed: true,
          device_role: 'event_pass_keychain',
          assigned_slot: 'primary'
        }];
      } else if (method === 'PATCH' && target.includes('/rest/v1/keys?uid=eq.event-pass-uid')) {
        keyPatch = JSON.parse(options.body);
        rows = [{ uid: 'event-pass-uid', ...keyPatch }];
      } else if (method === 'PATCH' && target.includes('/rest/v1/smart_signs?id=eq.sign-event-pass')) {
        rows = [{ id: 'sign-event-pass', ...JSON.parse(options.body) }];
      } else if (method === 'PATCH' && target.includes('/rest/v1/smart_sign_inventory?id=eq.inventory-event-pass')) {
        rows = [{ id: 'inventory-event-pass', inventory_type: 'event_pass', ...JSON.parse(options.body) }];
      }

      return new Response(JSON.stringify(rows), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    };

    const handler = require('../api/admin/sign-action');
    const res = response();
    await handler({
      method: 'POST',
      headers: { 'x-admin-token': 'test-admin-token' },
      body: {
        action: 'reset_event_pass',
        inventory_id: 'inventory-event-pass',
        confirmation: 'REL8TION'
      }
    }, res);

    assert.equal(res.statusCode, 200);
    assert.equal(res.payload.ok, true);
    assert.deepEqual(keyPatch, {
      agent_slug: null,
      claimed: false,
      assigned_slot: null,
      device_role: 'event_pass_keychain'
    });
    assert.equal(res.payload.nfc_key_reset.before.agent_slug, 'old-agent');
  } finally {
    global.fetch = originalFetch;
    if (originalAdminToken === undefined) delete process.env.KEY_RESET_ADMIN_TOKEN; else process.env.KEY_RESET_ADMIN_TOKEN = originalAdminToken;
    if (originalUrl === undefined) delete process.env.SUPABASE_URL; else process.env.SUPABASE_URL = originalUrl;
    if (originalServiceKey === undefined) delete process.env[serviceKeyEnv]; else process.env[serviceKeyEnv] = originalServiceKey;
    delete require.cache[require.resolve('../lib/admin-auth')];
    delete require.cache[require.resolve('../api/admin/sign-action')];
  }
});
