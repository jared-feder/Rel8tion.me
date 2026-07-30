const test = require('node:test');
const assert = require('node:assert/strict');
const {
  inventoryPayload,
  internalInventoryPayload,
  inventorySemanticKey,
  matchProfiles,
  mergeInventoryPayload,
  openHousePayload,
  profileIndexes,
  readConfig,
  relationshipProfile,
  sourceIdentityRecord
} = require('../agent-listing-inventory-worker.cjs');
const cronHandler = require('../api/cron/sync-agent-listing-inventory.js');

function oneKeyRecord(overrides = {}) {
  return {
    UniqueListingId: 'L123',
    DisplayName: '12 Main Street, Huntington, NY 11743',
    Listing: {
      StandardStatus: 'Active',
      Price: { ListPrice: 925000 },
      ListAgent: { FullName: 'Ruth Chalco' },
      AgentOffice: { ListOffice: { ListOfficeName: 'Example Realty LLC' } }
    },
    Structure: {
      BedroomsTotal: 4,
      BathroomsTotalInteger: 3,
      LivingArea: 2400
    },
    Computed: {
      OpenHousesEarliestStartTime: '2026-08-01T16:00:00Z',
      OpenHousesEarliestEndTime: '2026-08-01T18:00:00Z'
    },
    Location: {
      City: 'Huntington',
      StateOrProvince: 'NY',
      PostalCode: '11743'
    },
    LocationPoint: { lat: 40.87, lon: -73.42 },
    Media: [{ MediaURL: 'https://images.example/listing.jpg' }],
    ...overrides
  };
}

test('queue relationship profiles do not treat the queue id as an agent id', () => {
  const profile = relationshipProfile({
    id: 'queue-row-id',
    agent_id: null,
    queue_row_id: 'queue-row-id',
    agent_name: 'Ruth Chalco',
    agent_phone: '(516) 555-0100'
  }, {
    relationship_source: 'agent_outreach_queue',
    relationship_status: 'interested'
  });

  assert.equal(profile.agent_id, null);
  assert.equal(profile.queue_row_id, 'queue-row-id');
  assert.equal(profile.relationship_key, 'phone:5165550100');
});

test('an exact agent name and compatible brokerage match without contact enrichment', () => {
  const profile = relationshipProfile({
    id: 'agent-1',
    name: 'Ruth Chalco',
    brokerage: 'Example Realty'
  });
  const matches = matchProfiles(oneKeyRecord(), [profile]);

  assert.equal(matches.length, 1);
  assert.equal(matches[0].match_reason, 'exact_name_brokerage');
  assert.equal(matches[0].match_score, 90);
});

test('same-name records with conflicting brokerages are rejected', () => {
  const profile = relationshipProfile({
    id: 'agent-1',
    name: 'Ruth Chalco',
    brokerage: 'Different Brokerage'
  });

  assert.deepEqual(matchProfiles(oneKeyRecord(), [profile]), []);
});

test('a shared office phone cannot assign one agent listing to a different agent', () => {
  const profiles = [
    relationshipProfile({
      id: 'agent-1',
      name: 'Ruth Chalco',
      brokerage: 'Example Realty',
      phone: '516-555-0100'
    }),
    relationshipProfile({
      id: 'agent-2',
      name: 'Someone Else',
      brokerage: 'Example Realty',
      phone: '516-555-0100'
    })
  ];
  const record = oneKeyRecord({
    Listing: {
      ...oneKeyRecord().Listing,
      ListAgent: { FullName: 'Ruth Chalco', Phone: '516-555-0100' }
    }
  });
  const matches = matchProfiles(record, profiles);

  assert.equal(matches.length, 1);
  assert.equal(matches[0].profile.agent_name, 'Ruth Chalco');
});

test('prebuilt profile indexes preserve ranked-agent matching without scanning every profile', () => {
  const profiles = [
    relationshipProfile({
      agent_id: null,
      agent_name: 'Ruth Chalco',
      brokerage: 'Example Realty'
    }, {
      relationship_source: 'agent_rankings',
      relationship_status: 'ranking_only'
    }),
    relationshipProfile({
      agent_id: null,
      agent_name: 'Someone Else',
      brokerage: 'Other Realty'
    }, {
      relationship_source: 'agent_rankings',
      relationship_status: 'ranking_only'
    })
  ];
  const matches = matchProfiles(oneKeyRecord(), profiles, profileIndexes(profiles));

  assert.equal(matches.length, 1);
  assert.equal(matches[0].profile.agent_name, 'Ruth Chalco');
  assert.equal(matches[0].profile.relationship_status, 'ranking_only');
});

test('inventory and upcoming open-house payloads use trusted relationship contact data', () => {
  const profile = relationshipProfile({
    id: 'agent-1',
    name: 'Ruth Chalco',
    brokerage: 'Example Realty',
    phone: '516-555-0100',
    email: 'ruth@example.com'
  });
  const match = matchProfiles(oneKeyRecord(), [profile])[0];
  const nowIso = '2026-07-30T00:00:00.000Z';
  const inventory = inventoryPayload(oneKeyRecord(), match, nowIso);
  const openHouse = openHousePayload(oneKeyRecord(), match, nowIso);

  assert.equal(inventory.source_listing_id, 'L123');
  assert.equal(inventory.listing_status, 'active');
  assert.equal(inventory.phone_normalized, '5165550100');
  assert.equal(inventory.price, 925000);
  assert.equal(openHouse.id, 'L123');
  assert.equal(openHouse.agent_phone, '516-555-0100');
  assert.equal(openHouse.agent_email, 'ruth@example.com');
  assert.equal(openHouse.agent_scraped, true);
  assert.equal(openHouse.agent_enriched, true);
});

test('verified website listings match ranked agents without enrichment', () => {
  const profile = relationshipProfile({
    agent_id: null,
    agent_name: 'Ruth Chalco',
    brokerage: 'Example Realty'
  }, {
    relationship_source: 'agent_rankings',
    relationship_status: 'ranking_only'
  });
  const identity = sourceIdentityRecord('Ruth Chalco', '', '', 'Example Realty LLC');
  const match = matchProfiles(identity, [profile])[0];
  const payload = internalInventoryPayload({
    id: 'website-row-1',
    source_listing_id: 'MLS-123',
    address: '12 Main Street, Huntington, NY 11743',
    listing_status: 'Active',
    price: 925000,
    agent_name: 'Ruth Chalco',
    brokerage: 'Example Realty LLC'
  }, match, '2026-07-30T00:00:00.000Z', 'agent_website_listing');

  assert.equal(match.match_reason, 'exact_name_brokerage');
  assert.equal(payload.source_listing_id, 'MLS-123');
  assert.equal(payload.relationship_status, 'ranking_only');
  assert.equal(payload.listing_status, 'active');
});

test('an upcoming open house enriches a matching website listing instead of duplicating it', () => {
  const base = {
    relationship_key: 'phone:5165550100',
    relationship_status: 'ranking_only',
    relationship_source: 'agent_rankings',
    agent_id: 'agent-1',
    phone_normalized: '5165550100',
    source: 'agent_website_listing',
    source_listing_id: 'MLS-123',
    address: '12 Main Street, Huntington, NY 11743',
    image_url: 'https://images.example/listing.jpg',
    listing_url: 'https://example.com/listing',
    open_start: null,
    open_end: null,
    source_payload: { origin: 'agent_website_listing' }
  };
  const openHouse = {
    relationship_key: 'phone:7185550100',
    relationship_status: 'worked_with',
    relationship_source: 'agents',
    agent_id: 'agent-1',
    phone_normalized: '7185550100',
    source: 'open_house',
    source_listing_id: 'OH-123',
    address: '12 Main Street, Huntington, NY 11743',
    open_start: '2026-08-01T16:00:00Z',
    open_end: '2026-08-01T18:00:00Z',
    source_payload: { origin: 'open_house' }
  };
  const merged = mergeInventoryPayload(base, openHouse);

  assert.equal(inventorySemanticKey(base), inventorySemanticKey(openHouse));
  assert.equal(merged.source, 'agent_website_listing');
  assert.equal(merged.relationship_key, 'phone:7185550100');
  assert.equal(merged.relationship_status, 'worked_with');
  assert.equal(merged.open_start, '2026-08-01T16:00:00Z');
  assert.equal(merged.source_payload.related_source, 'open_house');
});

test('the cron refuses requests when CRON_SECRET is missing or incorrect', async () => {
  const previous = process.env.CRON_SECRET;
  const response = () => ({
    statusCode: 200,
    payload: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.payload = payload;
      return this;
    }
  });

  try {
    delete process.env.CRON_SECRET;
    const missing = response();
    await cronHandler({ method: 'GET', headers: {} }, missing);
    assert.equal(missing.statusCode, 503);
    assert.equal(missing.payload.error, 'Missing CRON_SECRET');

    process.env.CRON_SECRET = 'expected-secret';
    const denied = response();
    await cronHandler({ method: 'GET', headers: { authorization: 'Bearer wrong-secret' } }, denied);
    assert.equal(denied.statusCode, 401);
    assert.equal(denied.payload.error, 'Unauthorized');
  } finally {
    if (previous === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = previous;
  }
});

test('shadow mode is the default and the cron remains disabled until explicitly enabled', async () => {
  const previous = {
    url: process.env.SUPABASE_URL,
    anon: process.env.SUPABASE_ANON_KEY,
    promote: process.env.AGENT_LISTING_INVENTORY_PROMOTE_OPEN_HOUSES,
    secret: process.env.CRON_SECRET,
    enabled: process.env.AGENT_LISTING_INVENTORY_ENABLED
  };
  const res = {
    statusCode: 200,
    payload: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.payload = payload;
      return this;
    }
  };

  try {
    process.env.SUPABASE_URL = 'https://example.supabase.co';
    process.env.SUPABASE_ANON_KEY = 'test-anon-key';
    delete process.env.AGENT_LISTING_INVENTORY_PROMOTE_OPEN_HOUSES;
    const config = readConfig({ dryRun: true });
    assert.equal(config.promoteOpenHouses, false);

    process.env.CRON_SECRET = 'expected-secret';
    delete process.env.AGENT_LISTING_INVENTORY_ENABLED;
    await cronHandler({
      method: 'GET',
      headers: { authorization: 'Bearer expected-secret' }
    }, res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.payload.disabled, true);
  } finally {
    const restore = (name, value) => {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    };
    restore('SUPABASE_URL', previous.url);
    restore('SUPABASE_ANON_KEY', previous.anon);
    restore('AGENT_LISTING_INVENTORY_PROMOTE_OPEN_HOUSES', previous.promote);
    restore('CRON_SECRET', previous.secret);
    restore('AGENT_LISTING_INVENTORY_ENABLED', previous.enabled);
  }
});
