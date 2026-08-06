const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const { createOrResolveAgentRecord } = require('../lib/admin-agent-prospect');

const ranking = {
  id: 'ranking-1',
  agent_name: 'Christina Sanchez',
  phone: '786-252-4285',
  phone_normalized: '7862524285',
  email: 'christina@example.com',
  brokerage: 'Example Realty',
  market_area: 'Miami',
  recommended_tier: 'A',
  raw_sources: { labels: ['ListReports Listing Signal'] }
};

function responseRow(body, extra = {}) {
  return [{ id: extra.id || 'relationship-1', ...JSON.parse(body), ...extra }];
}

test('saves a durable agent record without requiring an open house, queue row, or send', async () => {
  const calls = [];
  const supabaseRest = async (requestPath, options = {}) => {
    calls.push({ path: requestPath, options });
    if (requestPath === 'agent_relationships' && options.method === 'POST') {
      return responseRow(options.body, { relationship_status: 'known' });
    }
    if (requestPath.startsWith('agent_rankings?') && options.method === 'PATCH') {
      return responseRow(options.body, { id: ranking.id });
    }
    return [];
  };

  const result = await createOrResolveAgentRecord({
    ranking,
    supabaseRest,
    now: new Date('2026-08-06T12:00:00.000Z')
  });

  assert.equal(result.rel8tion_status.kind, 'agent_saved');
  assert.equal(result.relationship.relationship_status, 'known');
  assert.equal(result.relationship.metadata.record_type, 'agent');
  assert.equal(result.relationship.metadata.outreach_lane, 'general_agent_invitation');
  assert.equal(result.relationship.metadata.automatic_sending, false);
  assert.equal(result.relationship.metadata.outreach_queue_created, false);
  assert.equal(result.outbound_sent, false);
  assert.equal(result.outreach_queue_created, false);
  assert.ok(result.invitation_drafts.soft_intro);
  assert.equal(calls.some((call) => call.path.includes('agent_outreach_queue')), false);
  assert.equal(calls.some((call) => call.path === 'agent_relationship_events' && call.options.method === 'POST'), true);
});

test('identifies an existing REL8TION member and links the ranking without queueing outreach', async () => {
  const calls = [];
  const member = {
    id: 'agent-1',
    slug: 'christina-sanchez',
    name: ranking.agent_name,
    phone_normalized: ranking.phone_normalized,
    email: ranking.email,
    brokerage: ranking.brokerage
  };
  const supabaseRest = async (requestPath, options = {}) => {
    calls.push({ path: requestPath, options });
    if (requestPath.startsWith('agents?')) return [member];
    if (requestPath === 'agent_relationships' && options.method === 'POST') {
      return responseRow(options.body, { relationship_status: 'member' });
    }
    if (requestPath.startsWith('agent_rankings?') && options.method === 'PATCH') {
      return responseRow(options.body, { id: ranking.id });
    }
    return [];
  };

  const result = await createOrResolveAgentRecord({ ranking, supabaseRest });

  assert.equal(result.rel8tion_status.kind, 'existing_member');
  assert.equal(result.ranking.agent_id, member.id);
  assert.equal(result.relationship.relationship_status, 'member');
  assert.equal(result.outbound_sent, false);
  assert.equal(calls.some((call) => call.path.includes('agent_outreach_queue')), false);
});

test('converts an earlier prospect label to a known agent without creating a duplicate', async () => {
  const calls = [];
  const existing = {
    id: 'relationship-existing',
    canonical_key: 'phone:7862524285',
    display_name: ranking.agent_name,
    phone_normalized: ranking.phone_normalized,
    email: ranking.email,
    brokerage: ranking.brokerage,
    relationship_status: 'prospect',
    metadata: { first_seen: true }
  };
  const supabaseRest = async (requestPath, options = {}) => {
    calls.push({ path: requestPath, options });
    if (requestPath.startsWith(`agent_relationships?id=eq.${existing.id}`) && options.method === 'PATCH') {
      return responseRow(options.body, { ...existing, ...JSON.parse(options.body) });
    }
    if (requestPath.startsWith('agent_relationships?')) return [existing];
    if (requestPath.startsWith('agent_rankings?') && options.method === 'PATCH') {
      return responseRow(options.body, { id: ranking.id });
    }
    return [];
  };

  const result = await createOrResolveAgentRecord({ ranking, supabaseRest });

  assert.equal(result.rel8tion_status.kind, 'existing_agent_record');
  assert.equal(result.relationship.relationship_status, 'known');
  assert.equal(result.created, false);
  assert.equal(calls.filter((call) => call.path === 'agent_relationships' && call.options.method === 'POST').length, 0);
  assert.equal(calls.some((call) => call.path.includes('agent_outreach_queue')), false);
});

test('Agent Ranking uses the dedicated save-agent action and explicit no-send language', () => {
  const html = fs.readFileSync(path.resolve(__dirname, '..', 'apps', 'rel8tion-app', 'agent-ranking.html'), 'utf8');
  const api = fs.readFileSync(path.resolve(__dirname, '..', 'api', 'admin', 'agent-ranking.js'), 'utf8');

  assert.match(html, /action:\s*'save_agent'/);
  assert.match(html, /Save Agent to REL8TION/);
  assert.match(html, /Nothing will be queued or sent/);
  assert.doesNotMatch(html, /data-outreach=/);
  assert.doesNotMatch(html, /prospect staged in outreach queue/i);
  assert.match(api, /if \(action === 'save_agent'\)/);
});
