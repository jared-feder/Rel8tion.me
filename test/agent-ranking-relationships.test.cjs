const test = require('node:test');
const assert = require('node:assert/strict');
const {
  buildRelationshipOnlyRankings,
  stableRelationshipId
} = require('../lib/agent-ranking-relationships');

const now = new Date('2026-07-30T12:00:00Z');
const obeeAgent = {
  id: 'e2adaa69-b4f5-47ac-87eb-a08f71aca308',
  name: 'Delilah Obee',
  brokerage: 'Winkler Real Estate Inc',
  slug: 'delilah-obee-fz8',
  phone_normalized: '5165890653'
};
const obeeHistory = {
  agents: [obeeAgent],
  visits: [{
    id: 'visit-obee',
    open_house_id: 'M00000489-1023904',
    agent_name: 'Delilah Obee',
    agent_phone: '(516) 589-0653',
    brokerage: 'Winkler Real Estate Inc',
    scheduled_start: '2026-07-22T21:00:00Z',
    scheduled_end: '2026-07-22T23:00:00Z',
    status: 'confirmed'
  }],
  events: [{
    id: 'event-obee',
    host_agent_slug: 'delilah-obee-fz8',
    open_house_source_id: 'M00000489-1023904',
    start_time: '2026-07-22T21:00:00Z',
    end_time: '2026-07-22T23:00:00Z',
    status: 'ended',
    ended_at: '2026-07-26T13:54:54Z'
  }]
};
const obeeInventory = [{
  agent_id: obeeAgent.id,
  agent_name: 'Delilah Obee',
  brokerage: 'Winkler Real Estate Inc',
  phone_normalized: '5165890653',
  relationship_status: 'accepted_open_house',
  relationship_source: 'agent_outreach_queue',
  source: 'open_house',
  source_listing_id: 'M00000489-1034567',
  address: '2978 Grand Blvd, Baldwin, NY 11510',
  city: 'Baldwin',
  state: 'NY',
  zip: '11510',
  open_start: '2026-08-08T18:00:00Z',
  open_end: '2026-08-08T20:00:00Z',
  last_seen_at: '2026-07-30T05:43:39Z'
}];

test('a worked-with agent without ListReports enrichment becomes searchable relationship data', () => {
  const rows = buildRelationshipOnlyRankings({
    existingRankings: [],
    historyData: obeeHistory,
    inventory: obeeInventory,
    queueRows: [],
    now
  });

  assert.equal(rows.length, 1);
  assert.equal(rows[0].agent_name, 'Delilah Obee');
  assert.equal(rows[0].relationship_only, true);
  assert.equal(rows[0].relationship_status, 'accepted_open_house');
  assert.equal(rows[0].has_prior_rel8tion_open_house, true);
  assert.equal(rows[0].rel8tion_open_house_history_count, 1);
  assert.equal(rows[0].active_listing_count, 0);
  assert.equal(rows[0].recommended_tier, 'Relationship');
  assert.match(rows[0].id, /^relationship:/);
});

test('a trusted ListReports ranking suppresses the duplicate relationship-only row', () => {
  const rows = buildRelationshipOnlyRankings({
    existingRankings: [{
      id: 'ranking-obee',
      agent_name: 'Delilah Obee',
      brokerage: 'Winkler Real Estate Inc',
      phone_normalized: '5165890653'
    }],
    historyData: obeeHistory,
    inventory: obeeInventory,
    queueRows: [],
    now
  });

  assert.equal(rows.length, 0);
});

test('a future confirmed visit alone does not claim that the agent was already worked with', () => {
  const historyData = {
    agents: [],
    events: [],
    visits: [{
      id: 'future-visit',
      open_house_id: 'future-oh',
      agent_name: 'Future Agent',
      agent_phone: '5165550199',
      scheduled_start: '2026-08-10T18:00:00Z',
      scheduled_end: '2026-08-10T20:00:00Z',
      status: 'confirmed'
    }]
  };
  const rows = buildRelationshipOnlyRankings({
    existingRankings: [],
    historyData,
    inventory: [],
    queueRows: [],
    now
  });

  assert.equal(rows.length, 0);
});

test('relationship ids are deterministic for profile drill-down', () => {
  assert.equal(
    stableRelationshipId(`agent:${obeeAgent.id}`),
    stableRelationshipId(`agent:${obeeAgent.id}`)
  );
});
