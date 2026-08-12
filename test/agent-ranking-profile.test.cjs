const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
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

test('URL-opened production reports replace their loading or generic agent-name placeholder', () => {
  const html = fs.readFileSync(path.resolve(__dirname, '..', 'apps', 'rel8tion-app', 'agent-ranking.html'), 'utf8');
  assert.match(html, /'loading agent profile',[\s\S]*'listing agent'/);
  assert.match(html, /agent_name:\s*baseNameIsPlaceholder\s*\?\s*detail\.agent_name/);
});

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

test('display dedupe collapses brokerage aliases for the same linked agent and keeps the newer snapshot', () => {
  const shared = {
    agent_name: 'Elena Galluzzo',
    phone_normalized: '6317743333',
    agent_id: 'f2eba1bd-7502-444f-8e37-950257c081eb',
    active_listing_count: 20,
    listings_active_last_12_months: 58
  };
  const older = {
    ...shared,
    id: 'older-ranking',
    brokerage: 'Compass',
    listings_days_since_last: 26,
    buyside_last_12_months: 5,
    raw_sources: {
      upload_id: 'older-upload',
      period_end: '2026-06-26'
    }
  };
  const newer = {
    ...shared,
    id: 'newer-ranking',
    brokerage: 'Compass Greater NY LLC',
    listings_days_since_last: 31,
    buyside_last_12_months: 6,
    raw_sources: {
      upload_id: 'newer-upload',
      period_end: '2026-07-03'
    }
  };

  const result = agentRankingHandler.__test.dedupeRankingsForDisplay([older, newer]);

  assert.equal(result.rankings.length, 1);
  assert.equal(result.collapsed, 1);
  assert.equal(result.groups, 1);
  assert.equal(result.rankings[0].id, 'newer-ranking');
  assert.equal(result.rankings[0].brokerage, 'Compass Greater NY LLC');
  assert.equal(result.rankings[0].raw_sources.display_duplicate_count, 2);
  assert.deepEqual(
    new Set(result.rankings[0].raw_sources.display_duplicate_ranking_ids),
    new Set(['older-ranking', 'newer-ranking'])
  );
});

test('display dedupe does not merge different linked agents that share a phone', () => {
  const result = agentRankingHandler.__test.dedupeRankingsForDisplay([
    {
      id: 'first-agent',
      agent_name: 'First Agent',
      brokerage: 'Compass',
      phone_normalized: '6315550100',
      agent_id: 'first-agent-id'
    },
    {
      id: 'second-agent',
      agent_name: 'Second Agent',
      brokerage: 'Compass',
      phone_normalized: '6315550100',
      agent_id: 'second-agent-id'
    }
  ]);

  assert.equal(result.rankings.length, 2);
  assert.equal(result.collapsed, 0);
});
