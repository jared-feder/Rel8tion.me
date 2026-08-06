const test = require('node:test');
const assert = require('node:assert/strict');

process.env.CRON_SECRET = 'test-cron-secret';
process.env.SUPABASE_URL = 'https://example.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role';

const calls = [];
let queueRefreshStatus = 204;

global.fetch = async (url, options = {}) => {
  const call = { url: String(url), options };
  calls.push(call);

  if (call.url.endsWith('/rest/v1/rpc/queue_recent_outreach_candidates')) {
    return {
      ok: queueRefreshStatus < 400,
      status: queueRefreshStatus,
      text: async () => queueRefreshStatus < 400 ? '' : JSON.stringify({ message: 'queue refresh failed' })
    };
  }

  if (call.url.endsWith('/functions/v1/generate-agent-outreach')) {
    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ ok: true, processed: 1 })
    };
  }

  throw new Error(`Unexpected fetch: ${call.url}`);
};

const handler = require('../api/cron/generate-agent-outreach');

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

test.beforeEach(() => {
  calls.length = 0;
  queueRefreshStatus = 204;
});

test('generation cron stages eligible enriched open houses before generating outreach', async () => {
  const res = response();
  await handler({
    method: 'POST',
    headers: { authorization: 'Bearer test-cron-secret' },
    body: { limit: 7 }
  }, res);

  assert.equal(res.statusCode, 200, JSON.stringify(res.payload));
  assert.deepEqual(res.payload.queue_refresh, {
    ok: true,
    rpc: 'queue_recent_outreach_candidates'
  });
  assert.equal(calls.length, 2);
  assert.match(calls[0].url, /\/rest\/v1\/rpc\/queue_recent_outreach_candidates$/);
  assert.equal(calls[0].options.method, 'POST');
  assert.equal(calls[0].options.body, '{}');
  assert.equal(calls[0].options.headers.Prefer, 'return=minimal');
  assert.match(calls[1].url, /\/functions\/v1\/generate-agent-outreach$/);
  assert.deepEqual(JSON.parse(calls[1].options.body), { limit: 7 });
});

test('generation does not continue when queue staging fails', async () => {
  queueRefreshStatus = 500;
  const res = response();
  const originalError = console.error;
  console.error = () => {};
  try {
    await handler({
      method: 'GET',
      headers: { authorization: 'Bearer test-cron-secret' }
    }, res);
  } finally {
    console.error = originalError;
  }

  assert.equal(res.statusCode, 500);
  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /\/rest\/v1\/rpc\/queue_recent_outreach_candidates$/);
});

test('queue staging remains protected by cron authorization', async () => {
  const res = response();
  await handler({ method: 'GET', headers: {} }, res);

  assert.equal(res.statusCode, 401);
  assert.equal(calls.length, 0);
});
