const test = require('node:test');
const assert = require('node:assert/strict');
const { buildAgentPerformance } = require('../lib/admin-agent-performance');

test('Agent Board merges sources and keeps agents without messages or listings', () => {
  const rows = buildAgentPerformance({
    agents: [
      {
        id: 'agent-1',
        slug: 'agent-one',
        name: 'Agent One',
        phone: '516-555-0100',
        phone_normalized: '5165550100',
        email: 'one@example.test',
        brokerage: 'Example Realty'
      },
      {
        id: 'agent-2',
        slug: 'agent-two',
        name: 'Agent Two',
        phone: '516-555-0200',
        phone_normalized: '5165550200',
        brokerage: 'Example Realty'
      }
    ],
    keys: [{ agent_slug: 'agent-one', claimed: true }],
    rankings: [{
      id: 'ranking-1',
      agent_id: 'agent-1',
      agent_name: 'Agent One',
      phone_normalized: '5165550100',
      brokerage: 'Example Realty',
      agent_rank_score: 88,
      open_house_count: 5
    }],
    outreach: [{
      id: 'queue-1',
      open_house_id: 'listing-1',
      agent_name: 'Agent One',
      agent_phone: '516-555-0100',
      agent_phone_normalized: '5165550100',
      agent_photo_url: 'https://images.example.test/agent-one.jpg',
      brokerage: 'Example Realty',
      address: '12 Main St',
      open_start: '2099-08-02T16:00:00Z',
      open_end: '2099-08-02T18:00:00Z',
      selected_sms: 'Original outreach',
      initial_sent_at: '2099-07-31T12:00:00Z'
    }],
    inbox: [{
      queue_row_id: 'queue-1',
      agent_name: 'Agent One',
      agent_phone_normalized: '5165550100',
      brokerage: 'Example Realty',
      reply_count: 3,
      last_reply_at: '2099-07-31T13:00:00Z'
    }],
    listingInventory: [{
      id: 'inventory-1',
      source_listing_id: 'listing-1',
      queue_row_id: 'queue-1',
      agent_id: 'agent-1',
      agent_name: 'Agent One',
      phone_normalized: '5165550100',
      brokerage: 'Example Realty',
      address: '12 Main St',
      open_start: '2099-08-02T16:00:00Z',
      open_end: '2099-08-02T18:00:00Z',
      last_seen_at: '2099-07-31T12:30:00Z'
    }]
  });

  assert.equal(rows.length, 2);
  assert.equal(rows[0].name, 'Agent One');
  assert.equal(rows[0].ranking_id, 'ranking-1');
  assert.equal(rows[0].image_url, 'https://images.example.test/agent-one.jpg');
  assert.equal(rows[0].keychain_count, 1);
  assert.equal(rows[0].outreach_count, 1);
  assert.equal(rows[0].reply_count, 3);
  assert.equal(rows[0].listing_count, 1);
  assert.equal(rows[0].upcoming_open_house_count, 1);
  assert.equal(rows[0].listings.length, 1);
  assert.equal(rows[0].outreach_threads.length, 1);
  assert.equal(rows[0].outreach_threads[0].latest_reply_body, '');
  assert.equal(rows[0].upcoming_open_houses.length, 1);
  assert.equal(rows[0].upcoming_open_houses[0].queue_row_id, 'queue-1');
  assert.equal(rows[0].relationship_category, 'prior_outreach');
  assert.equal(rows[0].has_prior_outreach, true);
  assert.equal(rows[1].name, 'Agent Two');
  assert.equal(rows[1].outreach_count, 0);
  assert.equal(rows[1].listing_count, 0);
  assert.equal(rows[1].relationship_category, 'new');
});

test('Agent Board keeps past events out of the upcoming list', () => {
  const rows = buildAgentPerformance({
    outreach: [{
      id: 'queue-past',
      open_house_id: 'listing-past',
      agent_name: 'Past Event Agent',
      agent_phone_normalized: '5165550300',
      address: '1 Old Event Way',
      open_start: '2000-01-01T12:00:00Z',
      open_end: '2000-01-01T14:00:00Z'
    }]
  });

  assert.equal(rows.length, 1);
  assert.equal(rows[0].upcoming_open_house_count, 0);
});

test('Agent Board ranks future open houses by accepted, interested, prior outreach, then new', () => {
  const upcoming = (id, name, phone, hour) => ({
    id,
    open_house_id: `open-${id}`,
    agent_name: name,
    agent_phone_normalized: phone,
    address: `${id} Future Ln`,
    open_start: `2099-08-02T${hour}:00:00Z`,
    open_end: `2099-08-02T${String(Number(hour) + 1).padStart(2, '0')}:00:00Z`
  });
  const rows = buildAgentPerformance({
    outreach: [
      { ...upcoming('accepted', 'Accepted Agent', '5165551001', '19'), review_status: 'accepted_open_house' },
      { ...upcoming('interested', 'Interested Agent', '5165551002', '18'), review_status: 'interested' },
      { ...upcoming('sent', 'Sent Agent', '5165551003', '17'), initial_sent_at: '2099-07-30T12:00:00Z' },
      { ...upcoming('new', 'New Agent', '5165551004', '16'), created_at: '2099-07-30T12:00:00Z' }
    ]
  });

  assert.deepEqual(rows.map((row) => row.relationship_category), [
    'accepted_worked',
    'interested',
    'prior_outreach',
    'new'
  ]);
  assert.equal(rows.find((row) => row.name === 'New Agent').has_prior_outreach, false);
});

test('Agent Board uses real accepted visits and hosted events as worked-with signals', () => {
  const rows = buildAgentPerformance({
    agents: [{ id: 'agent-visit', slug: 'visit-agent', name: 'Visit Agent', phone_normalized: '5165552001' }],
    listingInventory: [{
      id: 'listing-visit',
      agent_id: 'agent-visit',
      agent_name: 'Visit Agent',
      phone_normalized: '5165552001',
      address: '8 Visit Ave',
      open_start: '2099-08-03T17:00:00Z',
      open_end: '2099-08-03T19:00:00Z'
    }],
    fieldVisits: [{
      id: 'visit-1',
      agent_name: 'Visit Agent',
      agent_phone_normalized: '5165552001',
      status: 'confirmed',
      scheduled_start: '2099-08-03T17:00:00Z'
    }, {
      id: 'visit-cancelled',
      agent_name: 'Visit Agent',
      agent_phone_normalized: '5165552001',
      status: 'cancelled'
    }],
    events: [{
      id: 'event-1',
      host_agent_slug: 'visit-agent',
      status: 'ended',
      ended_at: '2099-07-20T19:00:00Z'
    }, {
      id: 'event-draft',
      host_agent_slug: 'visit-agent',
      status: 'draft'
    }]
  });

  assert.equal(rows.length, 1);
  assert.equal(rows[0].relationship_category, 'accepted_worked');
  assert.equal(rows[0].accepted_open_house_count, 2);
});
