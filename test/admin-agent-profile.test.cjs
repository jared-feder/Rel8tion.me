const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

process.env.KEY_RESET_ADMIN_TOKEN = 'test-admin-token';
process.env.SUPABASE_URL = 'https://example.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role';

const phone = '5164459797';
const rows = {
  agent_relationships: [{
    id: 'relationship-melissa',
    canonical_key: 'phone:3478043357',
    agent_source_id: 'ranking-melissa',
    display_name: 'Melissa Cuartas',
    phone: '(347) 804-3357',
    phone_normalized: '3478043357',
    brokerage: 'Voro Llc',
    relationship_status: 'known',
    updated_at: '2026-08-06T08:18:39.000Z'
  }],
  agents: [],
  agent_rankings: [{
    id: 'ranking-marsha',
    agent_name: 'Marsha Welikson',
    brokerage: 'Signature Premier Properties',
    phone,
    phone_normalized: phone,
    agent_rank_score: 294,
    open_house_count: 3
  }],
  agent_outreach_queue: [{
    id: 'queue-marsha',
    open_house_id: 'house-marsha',
    agent_name: 'Marsha Welikson',
    agent_phone: '(516) 445-9797',
    agent_phone_normalized: phone,
    brokerage: 'Signature Premier Properties',
    address: '1 Test Lane',
    selected_sms: 'Stored outreach',
    initial_sent_at: '2026-05-15T03:00:14.521Z',
    review_status: 'pending',
    created_at: '2026-05-15T03:00:14.521Z'
  }],
  agent_outreach_inbox: [],
  agent_listing_inventory: [],
  listing_agents: [{
    id: 'listing-agent-marsha',
    open_house_id: 'house-marsha',
    name: 'Marsha Welikson',
    phone: '(516) 445-9797',
    phone_normalized: phone,
    brokerage: 'Signature Premier Properties',
    created_at: '2026-05-15T00:50:04.851Z'
  }],
  field_demo_visits: [],
  leads: [],
  open_houses: [{
    id: 'house-marsha',
    agent: 'Marsha Welikson',
    agent_phone: '(516) 445-9797',
    brokerage: 'Signature Premier Properties',
    address: '1 Test Lane',
    created_at: '2026-05-15T00:45:00.000Z'
  }],
  keys: [],
  open_house_events: []
};

global.fetch = async (url) => {
  const table = Object.keys(rows).find((name) => String(url).includes(`/rest/v1/${name}?`));
  return {
    ok: true,
    status: 200,
    text: async () => JSON.stringify(table ? rows[table] : [])
  };
};

const handler = require('../api/admin/agent-profile');
const adminSource = fs.readFileSync(path.join(__dirname, '..', 'apps', 'rel8tion-app', 'admin.html'), 'utf8');

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

test('focused agent hydration requires COMMAND admin authorization', async () => {
  const res = response();
  await handler({ method: 'GET', headers: {}, query: { agent: phone } }, res);
  assert.equal(res.statusCode, 401);
});

test('focused agent hydration finds an identity outside every dashboard slice', async () => {
  const res = response();
  await handler({
    method: 'GET',
    headers: { 'x-admin-token': 'test-admin-token' },
    query: { agent: phone }
  }, res);

  assert.equal(res.statusCode, 200, JSON.stringify(res.payload));
  assert.equal(res.payload.ok, true);
  assert.equal(res.payload.profiles.length, 1);
  const profile = res.payload.profiles[0];
  assert.equal(profile.name, 'Marsha Welikson');
  assert.equal(profile.phone_normalized, phone);
  assert.equal(profile.brokerage, 'Signature Premier Properties');
  assert.equal(profile.outreach_count, 1);
  assert.equal(profile.listing_count, 1);
  assert.equal(profile.ranking_id, 'ranking-marsha');
});

test('focused agent hydration finds a saved agent with no open house or outreach', async () => {
  const res = response();
  await handler({
    method: 'GET',
    headers: { 'x-admin-token': 'test-admin-token' },
    query: { agent: '3478043357' }
  }, res);

  assert.equal(res.statusCode, 200, JSON.stringify(res.payload));
  assert.equal(res.payload.profiles.length, 1);
  assert.equal(res.payload.profiles[0].name, 'Melissa Cuartas');
  assert.equal(res.payload.profiles[0].relationship_status, 'known');
  assert.equal(res.payload.profiles[0].relationship_label, 'Saved agent');
  assert.equal(res.payload.profiles[0].upcoming_open_house_count, 0);
});

test('COMMAND opens focused agents through the exact-profile endpoint without raising dashboard limits', () => {
  assert.match(adminSource, /\/api\/admin\/agent-profile\?agent=/);
  assert.match(adminSource, /Loading the full agent record/);
  assert.match(adminSource, /mergeHydratedAgentProfiles/);
  assert.doesNotMatch(adminSource, /agent_outreach_queue[^\n]+limit=4000/);
});
