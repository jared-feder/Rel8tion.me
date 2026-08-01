const test = require('node:test');
const assert = require('node:assert/strict');

process.env.KEY_RESET_ADMIN_TOKEN = 'test-admin-token';
process.env.SUPABASE_URL = 'https://example.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role';

let forwarded = null;
global.fetch = async (_url, options = {}) => {
  forwarded = JSON.parse(options.body || '{}');
  return {
    ok: true,
    status: 200,
    text: async () => JSON.stringify({ ok: true, media_attached: true })
  };
};

const handler = require('../api/admin/outreach-reply');

function response() {
  return {
    statusCode: 200,
    payload: null,
    setHeader() {},
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

test('admin manual reply forwards a property-specific outreach photo reference', async () => {
  const res = response();
  await handler({
    method: 'POST',
    headers: { 'x-admin-token': 'test-admin-token' },
    body: {
      id: 'queue-id',
      body: 'See you at the open house.',
      media_source: 'listing_inventory',
      media_id: 'inventory-id'
    }
  }, res);

  assert.equal(res.statusCode, 200);
  assert.equal(forwarded.media_source, 'listing_inventory');
  assert.equal(forwarded.media_id, 'inventory-id');
});

test('admin manual reply rejects incomplete or unknown photo references', async () => {
  const res = response();
  await handler({
    method: 'POST',
    headers: { 'x-admin-token': 'test-admin-token' },
    body: {
      id: 'queue-id',
      body: 'See you at the open house.',
      media_source: 'external_url'
    }
  }, res);

  assert.equal(res.statusCode, 400);
  assert.match(res.payload.error, /valid outreach photo source/i);
});
