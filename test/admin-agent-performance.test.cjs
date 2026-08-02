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
  assert.equal(rows[0].contacted_thread_count, 1);
  assert.equal(rows[0].latest_contacted_queue_row_id, 'queue-1');
  assert.equal(rows[0].upcoming_open_houses.length, 1);
  assert.equal(rows[1].name, 'Agent Two');
  assert.equal(rows[1].outreach_count, 0);
  assert.equal(rows[1].listing_count, 0);
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
  assert.equal(rows[0].contacted_thread_count, 0);
  assert.equal(rows[0].latest_contacted_queue_row_id, null);
});

test('Agent Board does not classify a staged unsent row as an existing conversation', () => {
  const rows = buildAgentPerformance({
    outreach: [{
      id: 'queue-staged',
      agent_name: 'Staged Agent',
      agent_phone_normalized: '5165550400',
      address: '4 Future Way',
      open_start: '2099-08-02T16:00:00Z',
      open_end: '2099-08-02T18:00:00Z',
      initial_send_status: 'not_queued',
      created_at: '2099-07-31T12:00:00Z'
    }]
  });

  assert.equal(rows.length, 1);
  assert.equal(rows[0].outreach_count, 1);
  assert.equal(rows[0].contacted_thread_count, 0);
  assert.equal(rows[0].latest_contacted_queue_row_id, null);
});
