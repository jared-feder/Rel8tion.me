const test = require('node:test');
const assert = require('node:assert/strict');
const agentRankingHandler = require('../api/admin/agent-ranking.js');
const { scoreRow } = require('../lib/agent-ranking');

const ninaRanking = {
  id: 'nina-ranking',
  identity_key: 'import:nina sabag|5 boro realty corp|9177050005',
  agent_name: 'Nina Sabag',
  brokerage: '5 Boro Realty Corp',
  phone_normalized: '9177050005',
  active_listing_count: 23,
  listings_active_last_12_months: 75,
  buyside_last_12_months: 1,
  listings_days_since_last: 3,
  agent_rank_score: 295
};

test('profile portrait resolver reuses the identity-matched outreach headshot', () => {
  const candidate = agentRankingHandler.__test.bestProfilePhotoCandidate(ninaRanking, [
    {
      source: 'agent_websites',
      rows: [{
        name: 'Nina Sabag',
        phone: '5165559999',
        brokerage: 'Different Realty',
        photo_url: 'https://example.test/wrong-agent.jpg'
      }]
    },
    {
      source: 'agent_outreach_queue',
      rows: [{
        agent_name: 'Nina Sabag',
        agent_phone_normalized: '19177050005',
        brokerage: '5 Boro Realty Corp',
        agent_photo_url: 'https://example.test/nina.jpg'
      }]
    }
  ]);

  assert.equal(candidate.photo_url, 'https://example.test/nina.jpg');
  assert.equal(candidate.profile_photo_source, 'agent_outreach_queue');
  assert.equal(candidate.match_score, 100);
});

test('canonical agent photo wins when equally verified photos exist', () => {
  const candidate = agentRankingHandler.__test.bestProfilePhotoCandidate(ninaRanking, [
    {
      source: 'agent_outreach_queue',
      rows: [{
        agent_name: 'Nina Sabag',
        agent_phone_normalized: '9177050005',
        brokerage: '5 Boro Realty Corp',
        agent_photo_url: 'https://example.test/outreach.jpg'
      }]
    },
    {
      source: 'agents',
      rows: [{
        name: 'Nina Sabag',
        phone_normalized: '9177050005',
        brokerage: '5 Boro Realty Corp',
        image_url: 'https://example.test/agent.jpg'
      }]
    }
  ]);

  assert.equal(candidate.photo_url, 'https://example.test/agent.jpg');
  assert.equal(candidate.profile_photo_source, 'agents');
});

test('ListReports activity is not described as verified current inventory', () => {
  const comparison = agentRankingHandler.__test.areaComparisonForRanking(ninaRanking, {
    label: 'Long Island',
    basis: 'market',
    rows: [
      ninaRanking,
      {
        id: 'peer-ranking',
        identity_key: 'import:peer agent|peer realty|5165550100',
        agent_name: 'Peer Agent',
        phone_normalized: '5165550100',
        active_listing_count: 3,
        listings_active_last_12_months: 7,
        buyside_last_12_months: 3,
        listings_days_since_last: 90,
        agent_rank_score: 100
      }
    ]
  });
  const scored = scoreRow(ninaRanking, {
    average_active_listings: 3,
    average_listing_side_12_months: 7,
    average_buyside_12_months: 3
  });
  const text = JSON.stringify(comparison);

  assert.ok(comparison.metrics.some((metric) => metric.label === 'Imported listing signal'));
  assert.match(text, /not verified current inventory/i);
  assert.doesNotMatch(text, /23 active listings/i);
  assert.ok(scored.labels.includes('ListReports Listing Signal'));
  assert.doesNotMatch(scored.recommended_pitch, /23 active listings/i);
});
