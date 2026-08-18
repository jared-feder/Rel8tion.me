const assert = require('node:assert/strict');
const {
  dedupeRowsByIdentityKey,
  identityKeyForAgentRanking,
  matchImportedRows
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

const fuzzySameFirstName = matchImportedRows([{
  agent_name: 'Lisa Pellegrino',
  brokerage: 'Douglas Elliman Real Estate',
  phone_normalized: '6312417117'
}], [{
  id: 'lisa-luttinger-id',
  name: 'Lisa Luttinger',
  brokerage: 'Douglas Elliman Real Estate',
  phone_normalized: '5166063511'
}])[0];
assert.equal(fuzzySameFirstName.match_reason, 'needs_review');
assert.equal(fuzzySameFirstName.needs_review, true);
assert.equal(fuzzySameFirstName.matched_agent_id, null, 'low-confidence fuzzy matches must never claim an agent UUID');

const exactPhone = matchImportedRows([{
  agent_name: 'Lisa Luttinger',
  brokerage: 'Douglas Elliman Real Estate',
  phone_normalized: '5166063511'
}], [{
  id: 'lisa-luttinger-id',
  name: 'Lisa Luttinger',
  brokerage: 'Douglas Elliman Real Estate',
  phone_normalized: '5166063511'
}])[0];
assert.equal(exactPhone.matched_agent_id, 'lisa-luttinger-id');
assert.equal(exactPhone.needs_review, false);

const sharedOfficePhoneConflict = matchImportedRows([{
  agent_name: 'Alicia Parenty',
  brokerage: 'Coldwell Banker American Homes',
  phone_normalized: '5162232525'
}], [{
  id: 'generic-office-agent-id',
  name: 'Different Person',
  brokerage: 'Coldwell Banker American Homes',
  phone_normalized: '5162232525'
}])[0];
assert.equal(sharedOfficePhoneConflict.match_reason, 'phone_name_conflict');
assert.equal(sharedOfficePhoneConflict.needs_review, true);
assert.equal(sharedOfficePhoneConflict.matched_agent_id, null, 'shared office phones must not claim another person UUID');

const sharedPhoneCorrectPerson = matchImportedRows([{
  agent_name: 'Perry Pappas',
  brokerage: 'Signature Premier Properties',
  phone_normalized: '5167667900'
}], [{
  id: 'perry-agent',
  name: 'Perry Pappas',
  brokerage: 'Signature Premier Properties',
  phone_normalized: '5167667900'
}, {
  id: 'david-agent',
  name: 'David W. Holmes',
  brokerage: 'Signature Premier Properties',
  phone_normalized: '5167667900'
}])[0];
assert.equal(sharedPhoneCorrectPerson.matched_agent_id, 'perry-agent');
assert.equal(sharedPhoneCorrectPerson.match_reason, 'phone');

console.log('Agent ranking canonical identity checks passed.');
