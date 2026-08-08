const test = require('node:test');
const assert = require('node:assert/strict');

const {
  assessListReportsChange,
  dedupeRowsByIdentityKey,
  identityKeyForAgentRanking
} = require('../lib/agent-ranking');
const { __test } = require('../api/admin/agent-ranking');

function ranking(overrides = {}) {
  return {
    agent_name: 'Emily Alcantara',
    brokerage: 'EXP Realty LLC',
    phone: '(516) 555-1212',
    phone_normalized: '5165551212',
    active_listing_count: 2,
    listings_active_last_12_months: 2,
    buyside_last_90_days: 0,
    buyside_last_12_months: 0,
    listings_days_since_last: 94,
    raw_sources: {
      period_end: '2026-07-01',
      snapshot_at: '2026-07-01T00:00:00.000Z'
    },
    ...overrides
  };
}

test('canonical identity ignores brokerage spelling drift', () => {
  const previous = ranking();
  const current = ranking({ brokerage: 'eXp Realty' });
  assert.equal(identityKeyForAgentRanking(previous), identityKeyForAgentRanking(current));
  assert.equal(identityKeyForAgentRanking(previous), 'import:emily alcantara|5165551212');
});

test('agents sharing an office phone remain distinct by name', () => {
  const first = ranking({ agent_name: 'Agent One' });
  const second = ranking({ agent_name: 'Agent Two' });
  assert.notEqual(identityKeyForAgentRanking(first), identityKeyForAgentRanking(second));
});

test('same-period brokerage aliases collapse to the stronger ListReports snapshot', () => {
  const weaker = ranking({ active_listing_count: 1, brokerage: 'EXP Realty LLC' });
  const stronger = ranking({ active_listing_count: 3, brokerage: 'eXp Realty' });
  const result = dedupeRowsByIdentityKey([weaker, stronger]);
  assert.equal(result.rows.length, 1);
  assert.equal(result.duplicates_skipped, 1);
  assert.equal(result.rows[0].active_listing_count, 3);
  assert.equal(result.rows[0].brokerage, 'eXp Realty');
});

test('normal month-over-month movement is accepted', () => {
  const previous = ranking({
    agent_name: 'Nina Sabag',
    active_listing_count: 23,
    listings_active_last_12_months: 75,
    buyside_last_90_days: 1,
    buyside_last_12_months: 1,
    listings_days_since_last: 3
  });
  const current = ranking({
    agent_name: 'Nina Sabag',
    active_listing_count: 29,
    listings_active_last_12_months: 73,
    buyside_last_90_days: 0,
    buyside_last_12_months: 1,
    listings_days_since_last: 2
  });
  assert.equal(assessListReportsChange(previous, current).classification, 'normal');
});

test('large increases are flagged but not held', () => {
  const assessment = assessListReportsChange(
    ranking({ active_listing_count: 1, listings_active_last_12_months: 1 }),
    ranking({ active_listing_count: 65, listings_active_last_12_months: 272 })
  );
  assert.equal(assessment.large_increase, true);
  assert.equal(assessment.severe_drop, false);
});

test('severe newer decreases are held while ordinary decreases remain eligible', () => {
  const severePrevious = ranking({
    agent_name: 'Ryan Serhant',
    active_listing_count: 505,
    listings_active_last_12_months: 803
  });
  const severeCurrent = ranking({
    agent_name: 'Ryan Serhant',
    active_listing_count: 33,
    listings_active_last_12_months: 46,
    raw_sources: {
      period_end: '2026-08-01',
      snapshot_at: '2026-08-01T00:00:00.000Z'
    }
  });
  const ordinaryPrevious = ranking({ active_listing_count: 3, listings_active_last_12_months: 13 });
  const ordinaryCurrent = ranking({
    active_listing_count: 3,
    listings_active_last_12_months: 12,
    raw_sources: {
      period_end: '2026-08-01',
      snapshot_at: '2026-08-01T00:00:00.000Z'
    }
  });

  assert.equal(assessListReportsChange(severePrevious, severeCurrent).severe_drop, true);
  assert.equal(assessListReportsChange(ordinaryPrevious, ordinaryCurrent).classification, 'normal');

  const continuity = __test.assessImportContinuity(
    [severeCurrent, ordinaryCurrent],
    [severePrevious, ordinaryPrevious]
  );
  assert.equal(continuity.existing_matches, 2);
  assert.equal(continuity.severe_drops_held, 1);
  assert.equal(continuity.large_increases_accepted, 0);
});

test('merging a newer report preserves linked agent data and relationship history', () => {
  const previous = ranking({
    agent_id: 'agent-123',
    email: 'agent@example.com',
    brokerage: 'EXP Realty LLC',
    county: 'Nassau',
    location_confidence: 90,
    location_source: 'manual',
    matched_open_house_count: 4,
    matched_open_house_ids: ['oh-1'],
    raw_sources: { period_end: '2026-07-01', upload_id: 'upload-july' }
  });
  const current = ranking({
    agent_id: null,
    email: null,
    brokerage: 'eXp Realty',
    county: null,
    location_confidence: 0,
    matched_open_house_count: 2,
    matched_open_house_ids: ['oh-2'],
    raw_sources: { period_end: '2026-08-01', upload_id: 'upload-august' }
  });
  const assessment = assessListReportsChange(previous, current);
  const merged = __test.mergeRankingForImport(previous, current, assessment);

  assert.equal(merged.agent_id, 'agent-123');
  assert.equal(merged.email, 'agent@example.com');
  assert.equal(merged.county, 'Nassau');
  assert.equal(merged.matched_open_house_count, 4);
  assert.deepEqual(new Set(merged.matched_open_house_ids), new Set(['oh-1', 'oh-2']));
  assert.deepEqual(new Set(merged.raw_sources.brokerage_history), new Set(['EXP Realty LLC', 'eXp Realty']));
});

test('an exact-name unique same-brokerage phone change updates the existing identity', () => {
  const previous = ranking({ phone: '7187634110', phone_normalized: '7187634110' });
  const current = ranking({ phone: '9172570211', phone_normalized: '9172570211' });
  const byIdentity = __test.canonicalRankingMap([previous]);
  const resolution = __test.resolveExistingRankingForImport(
    current,
    byIdentity,
    new Map([['emily alcantara', [previous]]])
  );
  assert.equal(resolution.status, 'phone_alias_resolved');
  const resolved = __test.preserveExistingContactForPhoneAlias(previous, current, resolution);
  assert.equal(resolved.phone_normalized, '7187634110');
  assert.equal(resolved.identity_key, 'import:emily alcantara|7187634110');
  assert.deepEqual(new Set(resolved.raw_sources.phone_aliases), new Set(['7187634110', '9172570211']));
});

test('an exact-name phone change is held when multiple same-brokerage identities already exist', () => {
  const first = ranking({
    agent_name: 'Ryan Serhant',
    brokerage: 'Serhant LLC',
    phone: '6464807665',
    phone_normalized: '6464807665'
  });
  const second = ranking({
    agent_name: 'Ryan Serhant',
    brokerage: 'Serhant LLC',
    phone: '5612620856',
    phone_normalized: '5612620856'
  });
  const current = ranking({
    agent_name: 'Ryan Serhant',
    brokerage: 'Serhant LLC',
    phone: '5613067220',
    phone_normalized: '5613067220'
  });
  const resolution = __test.resolveExistingRankingForImport(
    current,
    __test.canonicalRankingMap([first, second]),
    new Map([['ryan serhant', [first, second]]])
  );
  assert.equal(resolution.status, 'identity_alias_held');
  assert.equal(resolution.candidates.length, 2);
});
