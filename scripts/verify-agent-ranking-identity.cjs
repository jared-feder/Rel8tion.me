const assert = require('node:assert/strict');
const {
  dedupeRowsByIdentityKey,
  identityKeyForAgentRanking
} = require('../lib/agent-ranking');

const nassau = {
  agent_name: 'Aaleyah Allen',
  brokerage: 'eXp Realty',
  phone: '(929) 245-4568',
  primary_county: 'Nassau'
};
const suffolk = {
  ...nassau,
  phone_normalized: '9292454568',
  primary_county: 'Suffolk'
};

assert.equal(
  identityKeyForAgentRanking(nassau),
  'import:aaleyah allen|9292454568'
);
assert.equal(
  identityKeyForAgentRanking(suffolk),
  identityKeyForAgentRanking(nassau),
  'location must not create a second ranking identity'
);

const sharedOfficePhone = {
  ...nassau,
  agent_name: 'Another Agent'
};
assert.notEqual(
  identityKeyForAgentRanking(sharedOfficePhone),
  identityKeyForAgentRanking(nassau),
  'different agents sharing an office phone must remain distinct'
);

const movedBrokerage = {
  ...nassau,
  brokerage: 'Another Brokerage'
};
assert.equal(
  identityKeyForAgentRanking(movedBrokerage),
  identityKeyForAgentRanking(nassau),
  'a brokerage change must update the same current ranking'
);

const deduped = dedupeRowsByIdentityKey([
  { ...nassau, agent_rank_score: 60 },
  {
    ...suffolk,
    identity_key: 'import:aaleyah allen|exp realty|9292454568|suffolk',
    agent_rank_score: 80
  }
]);
assert.equal(deduped.rows.length, 1);
assert.equal(deduped.duplicates_skipped, 1);
assert.equal(deduped.rows[0].agent_rank_score, 80);
assert.equal(
  deduped.rows[0].identity_key,
  'import:aaleyah allen|9292454568',
  'stale brokerage/location-based keys must be replaced before upsert'
);

console.log('Agent ranking canonical identity checks passed.');
