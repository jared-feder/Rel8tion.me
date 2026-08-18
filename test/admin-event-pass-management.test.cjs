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
  assert.equal(classifySignProduct({}, ['event_pass']), 'event_pass');
  assert.equal(classifySignProduct({ activation_method: 'two_chip_setup', primary_device_type: 'buyer' }, ['smart_sign']), 'smart_sign');
  assert.equal(isEventPassBackingSign({}, []), false);
});

test('COMMAND separates normal Event Pass management from Smart Sign detach controls', () => {
  assert.match(adminSource, /row\.product_type !== 'event_pass'/);
  assert.match(adminSource, /renderRows\('Event Passes'/);
  assert.match(adminSource, /use Freshen here instead of detaching the backing sign/);
  assert.match(adminSource, /renderEventPassActions\(row\)/);
  assert.match(adminSource, /Event Pass backing records are managed above/);
});

test('detach_sign rejects Event Pass backing records before any production mutation', async () => {
  const originalFetch = global.fetch;
  const originalAdminToken = process.env.KEY_RESET_ADMIN_TOKEN;
  const originalUrl = process.env.SUPABASE_URL;
  const originalServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  let patchCount = 0;

  try {
    process.env.KEY_RESET_ADMIN_TOKEN = 'test-admin-token';
    process.env.SUPABASE_URL = 'https://example.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role';
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
    if (originalServiceKey === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY; else process.env.SUPABASE_SERVICE_ROLE_KEY = originalServiceKey;
    delete require.cache[require.resolve('../lib/admin-auth')];
    delete require.cache[require.resolve('../api/admin/sign-action')];
  }
});
