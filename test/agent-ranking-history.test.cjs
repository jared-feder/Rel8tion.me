const test = require('node:test');
const assert = require('node:assert/strict');
const {
  annotateRankingsWithHistory,
  historyRowsForRanking,
  historySignalForRanking
} = require('../lib/agent-ranking-history');
const agentRankingHandler = require('../api/admin/agent-ranking.js');

const ranking = {
  id: 'ranking-ruth',
  agent_id: 'agent-ruth',
  agent_name: 'Ruth Chalco',
  brokerage: 'Example Realty',
  phone_normalized: '5165550100',
  email: 'ruth@example.com'
};

const data = {
  agents: [{
    id: 'agent-ruth',
    name: 'Ruth Chalco',
    brokerage: 'Example Realty LLC',
    phone_normalized: '5165550100',
    email: 'ruth@example.com',
    slug: 'ruth-chalco'
  }],
  visits: [{
    id: 'visit-1',
    open_house_id: 'oh-1',
    agent_name: 'Ruth Chalco',
    brokerage: 'Example Realty',
    agent_phone: '(516) 555-0100',
    scheduled_start: '2026-05-31T19:00:00Z',
    scheduled_end: '2026-05-31T21:00:00Z',
    status: 'confirmed'
  }],
  events: [{
    id: 'event-1',
    host_agent_id: 'agent-ruth',
    host_agent_slug: 'ruth-chalco',
    open_house_source_id: 'oh-1',
    start_time: '2026-05-31T19:00:00Z',
    end_time: '2026-05-31T21:00:00Z',
    status: 'ended',
    ended_at: '2026-05-31T21:00:00Z'
  }]
};

test('completed REL8TION events and past confirmed visits establish worked-together history', () => {
  const signal = historySignalForRanking(ranking, data, new Date('2026-07-30T12:00:00Z'));
  assert.equal(signal.has_prior_rel8tion_open_house, true);
  assert.equal(signal.rel8tion_open_house_history_count, 1);
  assert.equal(signal.last_rel8tion_open_house_at, '2026-05-31T19:00:00Z');
});

test('an ended event wins when the same real open house also has a confirmed field visit', () => {
  const rows = historyRowsForRanking(ranking, data, new Date('2026-07-30T12:00:00Z'));
  assert.equal(rows.length, 1);
  assert.equal(rows[0].history_source, 'open_house_event');
  assert.equal(rows[0].history_status, 'completed');
});

test('future confirmed visits and unrelated agents are not counted as prior work', () => {
  const futureAndUnrelated = {
    agents: data.agents,
    events: [{
      ...data.events[0],
      id: 'event-other',
      host_agent_id: 'agent-other',
      host_agent_slug: 'someone-else',
      open_house_source_id: 'oh-other'
    }],
    visits: [{
      ...data.visits[0],
      id: 'visit-future',
      open_house_id: 'oh-future',
      scheduled_start: '2026-08-31T19:00:00Z',
      scheduled_end: '2026-08-31T21:00:00Z'
    }]
  };
  const [annotated] = annotateRankingsWithHistory(
    [ranking],
    futureAndUnrelated,
    new Date('2026-07-30T12:00:00Z')
  );
  assert.equal(annotated.has_prior_rel8tion_open_house, false);
  assert.equal(annotated.rel8tion_open_house_history_count, 0);
});

test('a shared office phone cannot transfer another agent history', () => {
  const signal = historySignalForRanking({
    ...ranking,
    agent_name: 'Perry Pappas',
    phone_normalized: '5167667900',
    email: ''
  }, {
    agents: [],
    events: [],
    visits: [{
      id: 'visit-david',
      open_house_id: 'oh-david',
      agent_name: 'David W. Holmes',
      agent_phone: '5167667900',
      scheduled_start: '2026-07-01T18:00:00Z',
      scheduled_end: '2026-07-01T20:00:00Z',
      status: 'confirmed'
    }]
  }, new Date('2026-07-30T12:00:00Z'));

  assert.equal(signal.has_prior_rel8tion_open_house, false);
});

test('manual reminder copy uses the real address/date and says again only for prior work', () => {
  const listing = {
    address: '12 Main Street, Huntington, NY 11743',
    open_start: '2026-08-01T17:00:00Z'
  };
  const prior = agentRankingHandler.__test.openHouseReminderVariants(ranking, listing, true);
  const newRelationship = agentRankingHandler.__test.openHouseReminderVariants(ranking, listing, false);

  assert.match(prior[0], /12 Main Street/);
  assert.match(prior[0], /Sat, Aug 1 at 1:00 PM/);
  assert.match(prior[0], /there again/);
  assert.match(prior[0], /Reply STOP to opt out/);
  assert.doesNotMatch(newRelationship[0], /there again/);
});

test('history rows preserve the actual REL8TION event time over a stale source listing time', () => {
  const rows = historyRowsForRanking(ranking, {
    ...data,
    events: [{
      ...data.events[0],
      start_time: '2026-07-19T16:00:00Z',
      end_time: '2026-07-19T18:00:00Z',
      ended_at: '2026-07-19T18:00:00Z'
    }]
  }, new Date('2026-07-30T12:00:00Z'));

  assert.equal(rows[0].start, '2026-07-19T16:00:00Z');
  assert.equal(rows[0].end, '2026-07-19T18:00:00Z');

  const detail = agentRankingHandler.__test.historyDetailRow(rows[0], {
    id: 'oh-1',
    address: '12 Main Street',
    open_start: '2026-06-28T16:00:00Z',
    open_end: '2026-06-28T18:00:00Z'
  }, ranking);
  assert.equal(detail.address, '12 Main Street');
  assert.equal(detail.open_start, '2026-07-19T16:00:00Z');
  assert.equal(detail.open_end, '2026-07-19T18:00:00Z');
});
