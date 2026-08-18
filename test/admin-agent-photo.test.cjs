const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

process.env.KEY_RESET_ADMIN_TOKEN = 'test-admin-token';
process.env.SUPABASE_URL = 'https://example.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role';

const calls = [];
const rows = {
  agents: [{
    id: '11111111-1111-4111-8111-111111111111',
    slug: 'agent-one',
    name: 'Agent One',
    phone: '(516) 555-0100',
    phone_normalized: '5165550100',
    email: 'one@example.test',
    brokerage: 'Example Realty',
    image_url: null
  }],
  agent_outreach_queue: [{
    id: '22222222-2222-4222-8222-222222222222',
    agent_name: 'Agent One',
    agent_phone: '(516) 555-0100',
    agent_phone_normalized: '5165550100',
    agent_email: 'one@example.test',
    brokerage: 'Example Realty',
    agent_photo_url: null
  }],
  listing_agents: [{
    id: '33333333-3333-4333-8333-333333333333',
    name: 'Agent One',
    phone: '5165550100',
    phone_normalized: '5165550100',
    email: 'one@example.test',
    brokerage: 'Example Realty',
    primary_photo_url: null
  }],
  agent_websites: [{
    id: '44444444-4444-4444-8444-444444444444',
    rel8tion_agent_id: '11111111-1111-4111-8111-111111111111',
    slug: 'agent-one',
    name: 'Agent One',
    phone: '516-555-0100',
    email: 'one@example.test',
    brokerage: 'Example Realty',
    photo_url: null
  }],
  agent_relationships: [{
    id: '55555555-5555-4555-8555-555555555555',
    agent_source_id: '11111111-1111-4111-8111-111111111111',
    agent_slug: 'agent-one',
    display_name: 'Agent One',
    phone: '5165550100',
    phone_normalized: '5165550100',
    email: 'one@example.test',
    brokerage: 'Example Realty',
    photo_url: null
  }],
  agent_rankings: [{
    id: '66666666-6666-4666-8666-666666666666',
    agent_id: null,
    agent_name: 'Agent One',
    phone: '5165550100',
    phone_normalized: '5165550100',
    email: 'one@example.test',
    brokerage: 'Example Realty'
  }]
};

global.fetch = async (url, options = {}) => {
  calls.push({ url: String(url), options });
  const storage = String(url).includes('/storage/v1/object/');
  if (storage) return { ok: true, status: 200, text: async () => '{}' };

  const table = Object.keys(rows).find((name) => String(url).includes(`/rest/v1/${name}`));
  if (options.method === 'PATCH') {
    return { ok: true, status: 200, text: async () => JSON.stringify(table ? rows[table] : []) };
  }
  if (options.method === 'POST') {
    return { ok: true, status: 201, text: async () => '[]' };
  }
  return { ok: true, status: 200, text: async () => JSON.stringify(table ? rows[table] : []) };
};

const handler = require('../api/admin/agent-photo');
const adminSource = fs.readFileSync(path.join(__dirname, '..', 'apps', 'rel8tion-app', 'admin.html'), 'utf8');

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

function jpegDataUrl() {
  const buffer = Buffer.alloc(1600, 1);
  buffer[0] = 0xff;
  buffer[1] = 0xd8;
  buffer[2] = 0xff;
  return `data:image/jpeg;base64,${buffer.toString('base64')}`;
}

test('COMMAND agent photo upload requires admin authorization', async () => {
  const res = response();
  await handler({ method: 'POST', headers: {}, body: {} }, res);
  assert.equal(res.statusCode, 401);
});

test('missing-photo Agent Performance cards expose the plus file picker', () => {
  assert.match(adminSource, /function renderAgentAvatar\(row\)/);
  assert.match(adminSource, /data-agent-photo-pick/);
  assert.match(adminSource, /accept="image\/jpeg,image\/png,image\/webp"/);
  assert.equal((adminSource.match(/\$\{renderAgentAvatar\(row\)\}/g) || []).length, 2);
});

test('COMMAND agent photo upload stores and propagates one canonical photo', async () => {
  calls.length = 0;
  const res = response();
  await handler({
    method: 'POST',
    headers: { 'x-admin-token': 'test-admin-token' },
    body: {
      agent: {
        id: rows.agents[0].id,
        ranking_id: rows.agent_rankings[0].id,
        slug: 'agent-one',
        name: 'Agent One',
        phone: '(516) 555-0100',
        phone_normalized: '5165550100',
        email: 'one@example.test',
        brokerage: 'Example Realty',
        queue_row_ids: [rows.agent_outreach_queue[0].id]
      },
      photo: jpegDataUrl(),
      width: 1200,
      height: 1500
    }
  }, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.payload.ok, true);
  assert.equal(res.payload.bucket, 'agent-images');
  assert.match(res.payload.public_url, /\/storage\/v1\/object\/public\/agent-images\/command\//);
  assert.ok(calls.some((call) => call.url.includes('/storage/v1/object/agent-images/command/')));
  for (const table of ['agents', 'agent_outreach_queue', 'listing_agents', 'agent_websites', 'agent_relationships', 'agent_rankings']) {
    assert.ok(calls.some((call) => call.url.includes(`/rest/v1/${table}?id=in.`) && call.options.method === 'PATCH'), `${table} should be updated`);
  }
  const photoInsert = calls.find((call) => call.url.endsWith('/rest/v1/agent_photos') && call.options.method === 'POST');
  assert.ok(photoInsert);
  assert.equal(JSON.parse(photoInsert.options.body).manually_verified, true);
});

test('shared-phone rows with a conflicting agent name are not treated as the same identity', () => {
  const { identityMatches, normalizeIdentity } = require('../lib/admin-agent-photo');
  const identity = normalizeIdentity({
    name: 'Agent One',
    phone: '5165550100',
    brokerage: 'Example Realty'
  });
  const spec = { name: 'name', phone: 'phone', phoneNormalized: 'phone_normalized', email: 'email', brokerage: 'brokerage' };
  assert.equal(identityMatches({
    name: 'Different Agent',
    phone_normalized: '5165550100',
    brokerage: 'Example Realty'
  }, identity, spec), false);
});

test('an explicitly supplied queue ID cannot override a conflicting agent name', () => {
  const { identityMatches, normalizeIdentity } = require('../lib/admin-agent-photo');
  const queueId = '22222222-2222-4222-8222-222222222222';
  const identity = normalizeIdentity({
    name: 'Perry Pappas',
    phone: '5167667900',
    brokerage: 'Signature Premier Properties',
    queue_row_ids: [queueId]
  });
  const spec = {
    queueId: 'id',
    name: 'agent_name',
    phone: 'agent_phone',
    phoneNormalized: 'agent_phone_normalized',
    email: 'agent_email',
    brokerage: 'brokerage'
  };
  assert.equal(identityMatches({
    id: queueId,
    agent_name: 'David W Holmes',
    agent_phone_normalized: '5167667900',
    brokerage: 'Signature Premier Properties'
  }, identity, spec), false);
});

test('harmless middle initials do not block an otherwise matching photo identity', () => {
  const { identityMatches, normalizeIdentity } = require('../lib/admin-agent-photo');
  const identity = normalizeIdentity({
    agent_id: '11111111-1111-4111-8111-111111111111',
    name: 'Teresa DeDonato',
    phone: '5163684369',
    brokerage: 'Signature Premier Properties'
  });
  const spec = {
    agentId: 'id',
    name: 'name',
    phone: 'phone',
    phoneNormalized: 'phone_normalized',
    email: 'email',
    brokerage: 'brokerage'
  };
  assert.equal(identityMatches({
    id: identity.agentId,
    name: 'Teresa A. DeDonato CBR',
    phone_normalized: '5163684369',
    brokerage: 'Signature Premier Properties'
  }, identity, spec), true);
});
