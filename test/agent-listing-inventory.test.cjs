const test = require('node:test');
const assert = require('node:assert/strict');
const {
  cachedOneKeyMatch,
  circularBatch,
  discoverOneKeyListingsForProfile,
  inventoryPayload,
  internalInventoryPayload,
  inventorySemanticKey,
  loadOpenHousesByLinks,
  matchProfiles,
  matchOneKeyAgentProfile,
  mergeInventoryPayload,
  oneKeyListingUrl,
  openHousePayload,
  prioritizeDiscoveryProfiles,
  profileIndexes,
  readConfig,
  reconcileOpenHousePayloads,
  relationshipProfile,
  sourceIdentityRecord,
  wasHistoricalOutreach
} = require('../agent-listing-inventory-worker.cjs');
const cronHandler = require('../api/cron/sync-agent-listing-inventory.js');
const agentRankingHandler = require('../api/admin/agent-ranking.js');

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
  assert.equal(profile.relationship_key, 'phone:5165550100|agent:ruth|chalco');
});

test('shared office phones cannot merge two different agent identities', () => {
  const perry = relationshipProfile({
    name: 'Perry Pappas',
    phone: '516-766-7900'
  });
  const david = relationshipProfile({
    name: 'David W. Holmes',
    phone: '516-766-7900'
  });

  assert.notEqual(perry.relationship_key, david.relationship_key);
  assert.equal(perry.relationship_key, 'phone:5167667900|agent:perry|pappas');
  assert.equal(david.relationship_key, 'phone:5167667900|agent:david|holmes');
});

test('historical outreach includes sent rows but excludes untouched pending rows', () => {
  assert.equal(wasHistoricalOutreach({ initial_send_status: 'sent' }), true);
  assert.equal(wasHistoricalOutreach({ manual_sms_sent: true }), true);
  assert.equal(wasHistoricalOutreach({ last_outreach_at: '2026-07-01T12:00:00Z' }), true);
  assert.equal(wasHistoricalOutreach({ initial_send_status: 'pending', manual_sms_sent: false }), false);
});

test('reverse discovery prioritizes positive relationships, then prior outreach, then generic agents', () => {
  const profiles = [
    relationshipProfile({ name: 'Generic Agent' }),
    relationshipProfile({
      agent_name: 'Prior Agent',
      initial_sent_at: '2026-07-01T12:00:00Z'
    }, {
      relationship_source: 'agent_outreach_queue',
      relationship_status: 'prior_outreach',
      prior_outreach: true
    }),
    relationshipProfile({ agent_name: 'Interested Agent' }, {
      relationship_source: 'agent_outreach_queue',
      relationship_status: 'interested'
    }),
    relationshipProfile({ agent_name: 'Agent Phone: 5165550100' }, {
      relationship_source: 'agent_outreach_queue',
      relationship_status: 'prior_outreach',
      prior_outreach: true
    })
  ];

  assert.deepEqual(
    prioritizeDiscoveryProfiles(profiles).map((profile) => profile.agent_name),
    ['Interested Agent', 'Prior Agent', 'Generic Agent']
  );
});

test('reverse discovery cursor rotates through batches and wraps', () => {
  assert.deepEqual(circularBatch(['a', 'b', 'c', 'd'], 2, 2), {
    items: ['c', 'd'],
    cursor: 2,
    next_cursor: 0
  });
  assert.deepEqual(circularBatch(['a', 'b', 'c'], 2, 2).items, ['c', 'a']);
});

test('cached OneKey identity is reused only for the same non-conflicting agent', () => {
  const profile = relationshipProfile({
    name: 'Nina Sabag',
    phone: '917-705-0005'
  });
  const payload = {
    source_agent_name: 'Nina Sabag',
    source_agent_phone: '917-705-0005',
    source_agent_member_key: '326232401',
    source_agent_office_key: '326109033'
  };

  assert.equal(cachedOneKeyMatch(profile, payload).candidate.member_key, '326232401');
  assert.equal(cachedOneKeyMatch(profile, { ...payload, source_agent_phone: '516-555-9999' }), null);
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

test('OneKey agent directory identity prefers an exact phone match', () => {
  const profile = relationshipProfile({
    id: 'agent-nina',
    name: 'Nina Sabag',
    brokerage: '5 Boro Realty Corp',
    phone: '917-705-0005'
  });
  const match = matchOneKeyAgentProfile(profile, [{
    MemberFullName: 'Nina Sabag',
    MemberMobilePhone: '917-705-0005',
    MemberKey: '326232401',
    MemberMlsId: '223544',
    OfficeMetadata: {
      OfficeKey: '326109033',
      OfficeName: '5 Boro Realty Corp'
    }
  }]);

  assert.equal(match.match_score, 100);
  assert.equal(match.match_reason, 'onekey_agent_phone');
  assert.equal(match.candidate.member_key, '326232401');
});

test('OneKey agent directory rejects an exact name with a conflicting phone', () => {
  const profile = relationshipProfile({
    id: 'agent-nina',
    name: 'Nina Sabag',
    brokerage: '5 Boro Realty Corp',
    phone: '917-705-0005'
  });
  const match = matchOneKeyAgentProfile(profile, [{
    MemberFullName: 'Nina Sabag',
    MemberMobilePhone: '516-555-9999',
    MemberKey: 'other-member',
    OfficeMetadata: {
      OfficeKey: 'other-office',
      OfficeName: '5 Boro Realty Corp'
    }
  }]);

  assert.equal(match, null);
});

test('targeted OneKey discovery requests sale and rental listings by stable member key', async () => {
  const previousFetch = global.fetch;
  const requested = [];
  const profile = relationshipProfile({
    id: 'agent-nina',
    name: 'Nina Sabag',
    brokerage: '5 Boro Realty Corp',
    phone: '917-705-0005'
  });
  const listing = (id, saleType) => oneKeyRecord({
    UniqueListingId: id,
    BUPI: `${id}-hash`,
    DisplayLastLine: 'Brooklyn, NY 11207',
    Location: {},
    Listing: {
      StandardStatus: 'Active',
      Price: { ListPrice: saleType === 'Rent' ? 3500 : 1199999 },
      AgentOffice: { ListOffice: { ListOfficeName: '5 Boro Realty Corp' } }
    },
    Computed: {
      PropertySaleType: [saleType]
    }
  });

  global.fetch = async (url) => {
    requested.push(String(url));
    let payload;
    if (String(url).includes('/api/agents?')) {
      payload = {
        Results: [{
          MemberFullName: 'Nina Sabag',
          MemberMobilePhone: '917-705-0005',
          MemberKey: '326232401',
          MemberMlsId: '223544',
          OfficeMetadata: {
            OfficeKey: '326109033',
            OfficeName: '5 Boro Realty Corp'
          }
        }],
        Total: 1
      };
    } else if (String(url).includes('propertySaleType=Rent')) {
      payload = { Results: [listing('RENT-1', 'Rent')], Total: 1, NextOffset: null };
    } else {
      payload = { Results: [listing('SALE-1', 'Sale')], Total: 1, NextOffset: null };
    }
    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify(payload)
    };
  };

  try {
    const result = await discoverOneKeyListingsForProfile({ maxOffsets: 3 }, profile);
    assert.equal(result.complete, true);
    assert.equal(result.records.length, 2);
    assert.deepEqual(result.listing_totals, { Sale: 1, Rent: 1 });
    assert.ok(requested.some((url) => url.includes('listAgentKey=326232401')));
    assert.ok(requested.some((url) => url.includes('propertySaleType=Sale')));
    assert.ok(requested.some((url) => url.includes('propertySaleType=Rent')));
  } finally {
    global.fetch = previousFetch;
  }
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
  assert.equal(openHouse.sqft, 2400);
  assert.equal(openHouse.agent_scraped, true);
  assert.equal(openHouse.agent_enriched, true);
});

test('canonical open-house payloads round decimal square footage without changing listing inventory precision', () => {
  const profile = relationshipProfile({
    id: 'agent-1',
    name: 'Ruth Chalco',
    brokerage: 'Example Realty',
    phone: '516-555-0100'
  });
  const record = oneKeyRecord({
    Structure: {
      ...oneKeyRecord().Structure,
      LivingArea: '2866.56'
    }
  });
  const match = matchProfiles(record, [profile])[0];
  const nowIso = '2026-07-30T00:00:00.000Z';

  assert.equal(inventoryPayload(record, match, nowIso).sqft, 2866.56);
  assert.equal(openHousePayload(record, match, nowIso).sqft, 2867);
});

test('reverse discovery attaches an agent to an existing canonical event without changing its source or id', () => {
  const nowIso = '2026-08-04T12:00:00.000Z';
  const existing = [{
    id: 'existing-event',
    address: '12 Main Street, Huntington, NY 11743',
    open_start: '2026-08-08T16:00:00Z',
    open_end: '2026-08-08T18:00:00Z',
    source: 'manual',
    agent: null,
    agent_phone: null,
    agent_email: null,
    price: 900000
  }];
  const discovered = [{
    id: 'existing-event',
    address: '12 Main St, Huntington, NY 11743',
    open_start: '2026-08-08T16:00:00Z',
    open_end: '2026-08-08T18:00:00Z',
    source: 'onekey',
    agent: 'Ruth Chalco',
    agent_phone: '516-555-0100',
    agent_email: 'ruth@example.com',
    price: 925000
  }];
  const result = reconcileOpenHousePayloads(discovered, existing, nowIso);

  assert.equal(result.matched_by_id, 1);
  assert.equal(result.attached, 1);
  assert.equal(result.inserted, 0);
  assert.equal(result.rows[0].id, 'existing-event');
  assert.equal(result.rows[0].source, 'manual');
  assert.equal(result.rows[0].price, 900000);
  assert.equal(result.rows[0].agent, 'Ruth Chalco');
  assert.equal(result.rows[0].agent_enriched, true);
});

test('reverse discovery cross-references a different source id by normalized address and start time', () => {
  const existing = [{
    id: 'estately-event',
    address: '12 Main Street, Huntington, NY 11743',
    open_start: '2026-08-08T16:00:00Z',
    source: 'estately'
  }];
  const discovered = [{
    id: 'M00000489-123',
    address: '12 Main St, Huntington, NY 11743',
    open_start: '2026-08-08T16:20:00Z',
    source: 'onekey',
    agent: 'Ruth Chalco',
    agent_phone: '516-555-0100'
  }];
  const result = reconcileOpenHousePayloads(discovered, existing, '2026-08-04T12:00:00.000Z');

  assert.equal(result.matched_by_address_time, 1);
  assert.equal(result.inserted, 0);
  assert.equal(result.rows[0].id, 'estately-event');
  assert.equal(result.rows[0].source, 'estately');
});

test('reverse discovery inserts a OneKey event when no canonical match exists', () => {
  const discovered = [{
    id: 'M00000489-new',
    address: '99 New Road, Huntington, NY 11743',
    open_start: '2026-08-09T16:00:00Z',
    source: 'onekey',
    agent: 'Ruth Chalco'
  }];
  const result = reconcileOpenHousePayloads(discovered, [], '2026-08-04T12:00:00.000Z');

  assert.equal(result.inserted, 1);
  assert.equal(result.rows[0].id, 'M00000489-new');
});

test('reverse discovery reuses the canonical row that already owns a OneKey listing link', () => {
  const link = 'https://www.onekeymls.com/home-details/910-e-226th-st-bronx-ny-10466/9dDYYGr6PEf?propertySaleType=Rent';
  const existing = [{
    id: 'canonical-event',
    address: '910 E 226th St, Bronx, NY 10466',
    open_start: '2026-08-01T16:00:00Z',
    open_end: '2026-08-01T18:00:00Z',
    link,
    source: 'estately',
    agent: null
  }];
  const discovered = [{
    id: 'M00000489-new-id',
    address: '910 E 226th St, Bronx, NY 10466',
    open_start: '2026-08-09T16:00:00Z',
    open_end: '2026-08-09T18:00:00Z',
    link,
    source: 'onekey',
    agent: 'Ruth Chalco',
    agent_phone: '516-555-0100'
  }];
  const result = reconcileOpenHousePayloads(discovered, existing, '2026-08-06T12:00:00.000Z');

  assert.equal(result.matched_by_link, 1);
  assert.equal(result.inserted, 0);
  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0].id, 'canonical-event');
  assert.equal(result.rows[0].source, 'estately');
  assert.equal(result.rows[0].link, link);
  assert.equal(result.rows[0].agent, 'Ruth Chalco');
});

test('canonical link lookup includes historical open houses and deduplicates requested URLs', async () => {
  const previousFetch = global.fetch;
  const requested = [];
  const link = 'https://www.onekeymls.com/home-details/910-e-226th-st-bronx-ny-10466/9dDYYGr6PEf?propertySaleType=Rent';
  global.fetch = async (url) => {
    requested.push(String(url));
    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify([{ id: 'canonical-event', link }])
    };
  };

  try {
    const rows = await loadOpenHousesByLinks({
      url: 'https://example.supabase.co',
      key: 'test-key',
      relationshipLimit: 100
    }, [link, link]);
    assert.equal(requested.length, 1);
    assert.match(decodeURIComponent(requested[0]), /open_houses\?link=in\.\("https:\/\/www\.onekeymls\.com\/home-details\//);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].id, 'canonical-event');
  } finally {
    global.fetch = previousFetch;
  }
});

test('same-run OneKey discoveries sharing one link collapse to one upsert row', () => {
  const link = 'https://www.onekeymls.com/home-details/12-main-st-huntington-ny-11743/shared?propertySaleType=Sale';
  const discovered = [
    {
      id: 'onekey-first',
      address: '12 Main St, Huntington, NY 11743',
      open_start: '2026-08-09T16:00:00Z',
      link,
      source: 'onekey',
      agent: 'Ruth Chalco'
    },
    {
      id: 'onekey-duplicate',
      address: '12 Main Street, Huntington, NY 11743',
      open_start: '2026-08-09T16:00:00Z',
      link,
      source: 'onekey',
      agent: 'Ruth Chalco'
    }
  ];
  const result = reconcileOpenHousePayloads(discovered, [], '2026-08-06T12:00:00.000Z');

  assert.equal(result.inserted, 1);
  assert.equal(result.matched_by_link, 1);
  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0].id, 'onekey-first');
  assert.equal(result.rows[0].link, link);
});

test('OneKey listing payloads derive location and a clickable URL from current search fields', () => {
  const profile = relationshipProfile({
    id: 'agent-nina',
    name: 'Nina Sabag',
    brokerage: '5 Boro Realty Corp',
    phone: '917-705-0005'
  });
  const match = {
    profile,
    candidate: {
      name: 'Nina Sabag',
      phone: '917-705-0005',
      brokerage: '5 Boro Realty Corp',
      member_key: '326232401'
    },
    match_score: 100,
    match_reason: 'onekey_agent_phone'
  };
  const record = oneKeyRecord({
    BUPI: '9Nuu3J1ViHD',
    DisplayName: '405 Miller Ave, Brooklyn, NY 11207',
    DisplayLastLine: 'Brooklyn, NY 11207',
    Location: {},
    Computed: { PropertySaleType: ['Sale'] }
  });
  const payload = inventoryPayload(record, match, '2026-07-30T00:00:00.000Z');

  assert.equal(payload.city, 'Brooklyn');
  assert.equal(payload.state, 'NY');
  assert.equal(payload.zip, '11207');
  assert.equal(
    payload.listing_url,
    'https://www.onekeymls.com/home-details/405-miller-ave-brooklyn-ny-11207/9Nuu3J1ViHD?propertySaleType=Sale'
  );
  assert.equal(oneKeyListingUrl(record), payload.listing_url);
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

test('dashboard inventory counts follow canonical agent id when a phone changes', () => {
  const rankings = [{
    agent_id: 'agent-1',
    agent_name: 'Fidel Lloyd',
    phone_normalized: '7183416987'
  }];
  const inventory = [{
    agent_id: 'agent-1',
    relationship_key: 'phone:5165880919',
    source: 'agent_website_listing',
    source_listing_id: 'MLS-123',
    agent_name: 'Fidel Lloyd',
    open_start: null,
    open_end: null
  }];
  const [result] = agentRankingHandler.__test.inventoryCountsForRankings(rankings, inventory);

  assert.equal(result.database_current_listing_count, 1);
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
    oneKeyAgent: process.env.AGENT_LISTING_INVENTORY_ONEKEY_AGENT_DISCOVERY_ENABLED,
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
    assert.equal(config.oneKeyAgentDiscoveryEnabled, false);

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
    restore('AGENT_LISTING_INVENTORY_ONEKEY_AGENT_DISCOVERY_ENABLED', previous.oneKeyAgent);
    restore('CRON_SECRET', previous.secret);
    restore('AGENT_LISTING_INVENTORY_ENABLED', previous.enabled);
  }
});
