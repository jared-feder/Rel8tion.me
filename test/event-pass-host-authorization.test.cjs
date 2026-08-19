const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {
  authorizeListingHost,
  normalizeBrokerage
} = require('../lib/event-pass-registration');

const house = {
  id: 'house-1',
  address: '123 Main Street',
  brokerage: 'Compass Greater NY, LLC',
  agent: 'Listing Agent',
  agent_phone: '(516) 555-0101',
  agent_email: 'listing@example.com'
};

const listingAgents = [{
  id: 'listing-agent-1',
  name: 'Listing Agent',
  phone: '516-555-0101',
  email: 'listing@example.com',
  brokerage: 'Compass Greater NY LLC',
  is_primary: true
}];

test('listing agent contact authorizes a locked Event Pass', () => {
  const result = authorizeListingHost({
    house,
    listingAgents,
    agent: { slug: 'listing-agent', name: 'Listing Agent', phone: '5165550101', brokerage: 'Compass Greater NY' },
    identityVerified: true
  });
  assert.equal(result.basis, 'listing_agent');
  assert.equal(result.supporting_listing_agent, false);
  assert.equal(result.listing_agent_id, 'listing-agent-1');
});

test('verified same-brokerage substitute requires an explicit hosting confirmation', () => {
  const agent = { slug: 'support-agent', name: 'Support Agent', phone: '5165550199', brokerage: 'Compass Greater NY, Inc.' };
  assert.throws(() => authorizeListingHost({ house, listingAgents, agent, identityVerified: true }), /Confirm that you are hosting/);
  const result = authorizeListingHost({
    house,
    listingAgents,
    agent,
    identityVerified: true,
    supportingListingAgent: true
  });
  assert.equal(result.basis, 'same_brokerage_substitute');
  assert.equal(result.supporting_listing_agent, true);
});

test('typed brokerage alone cannot authorize an unverified substitute', () => {
  assert.throws(() => authorizeListingHost({
    house,
    listingAgents,
    agent: { name: 'Unknown Person', phone: '5165550198', brokerage: 'Compass Greater NY' },
    identityVerified: false,
    supportingListingAgent: true
  }), /could not verify the supporting agent/);
});

test('different-company agents and manual listings are denied', () => {
  assert.throws(() => authorizeListingHost({
    house,
    listingAgents,
    agent: { slug: 'other-agent', name: 'Other Agent', phone: '5165550197', brokerage: 'Douglas Elliman' },
    identityVerified: true,
    supportingListingAgent: true
  }), (error) => {
    assert.match(error.message, /only be activated/);
    assert.equal(error.code, 'event_pass_listing_authorization_failed');
    return true;
  });
  assert.throws(() => authorizeListingHost({
    house: { address: 'Manual address' },
    listingAgents: [],
    agent: { slug: 'listing-agent' },
    identityVerified: true
  }), (error) => {
    assert.match(error.message, /verified listing/);
    assert.equal(error.code, 'event_pass_listing_authorization_failed');
    return true;
  });
});

test('brokerage normalization ignores legal suffixes but not the company identity', () => {
  assert.equal(normalizeBrokerage('Compass Greater NY, LLC'), normalizeBrokerage('Compass Greater NY Inc.'));
  assert.notEqual(normalizeBrokerage('Compass Greater NY'), normalizeBrokerage('Douglas Elliman'));
});

test('normal Event Pass UI activates through the server route and records substitute confirmation', () => {
  const source = fs.readFileSync(path.join(__dirname, '../apps/rel8tion-app/sign-demo-activate.html'), 'utf8');
  const start = source.indexOf('async function activateEventPassOnServer(');
  const end = source.indexOf('\n    async function createOrLockEvent', start);
  assert.notEqual(start, -1);
  assert.notEqual(end, -1);
  const activation = source.slice(start, end);
  assert.match(activation, /fetch\('\/api\/event-pass\/action'/);
  assert.match(activation, /supporting_listing_agent/);
  assert.match(activation, /open_house_id:house\.id/);
  assert.doesNotMatch(activation, /open_house_events|smart_signs\?/);
});

test('listing authorization failures render a dedicated recovery screen instead of a small inline error', () => {
  const source = fs.readFileSync(path.join(__dirname, '../apps/rel8tion-app/sign-demo-activate.html'), 'utf8');
  assert.match(source, /We Can’t Verify This Open House/);
  assert.match(source, /Choose Another Open House/);
  assert.match(source, /event_pass_listing_authorization_failed/);
  assert.match(source, /renderEventPassAuthorizationIssue\(err\.message\)/);
});

test('database migration guards ordinary and Sponsored Event Pass inserts', () => {
  const migrations = fs.readdirSync(path.join(__dirname, '../supabase/migrations'));
  const file = migrations.find((name) => name.endsWith('_enforce_event_pass_host_authorization.sql'));
  assert.ok(file);
  const sql = fs.readFileSync(path.join(__dirname, '../supabase/migrations', file), 'utf8');
  assert.match(sql, /activation_method not in \('event_pass_keychain', 'sponsored_event_pass'\)/);
  assert.match(sql, /request_role <> 'service_role'/);
  assert.match(sql, /same_brokerage_substitute/);
  assert.match(sql, /claimed is true/);
});
