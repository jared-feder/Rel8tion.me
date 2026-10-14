const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const worker = require('../outreach-performance-report-worker.cjs');
const now = new Date('2026-10-13T12:00:00Z');
const window = worker.reportWindow(now);
const empty = () => Object.fromEntries(['queue', 'replies', 'visits', 'houses', 'agents', 'checkins', 'leads', 'suppression'].map((key) => [key, []]));
const queue = (id, extra = {}) => ({ id, open_house_id: `house-${id}`, agent_name: 'Jared Test', agent_phone: '5165550100', open_start: '2026-10-11T16:00:00Z',
  created_at: '2026-10-05T12:00:00Z', initial_sent_at: '2026-10-06T12:00:00Z', twilio_sid_initial: `initial-${id}`, ...extra });
const summarize = (data, prior = []) => worker.summarize(data, window, prior, now);

test('cohorts honor New York Monday boundaries and timezone-less database timestamps are UTC', () => {
  assert.equal(worker.cohort('2026-10-05T03:59:59Z'), '2026-09-28');
  assert.equal(worker.cohort('2026-10-05T04:00:00Z'), '2026-10-05');
  assert.equal(worker.cohort('2026-11-02T04:59:59Z'), '2026-10-26');
  assert.equal(worker.cohort('2026-11-02T05:00:00Z'), '2026-11-02');
  assert.equal(worker.stamp('2026-10-05 04:00:00'), Date.parse('2026-10-05T04:00:00Z'));
});

test('initial and follow-up logs cannot inflate conversation totals', () => {
  const d = empty(); d.queue = [queue('1', { followup_sent_at: '2026-10-08T12:00:00Z', twilio_sid_followup: 'follow-1' })];
  d.replies = ['initial-1', 'follow-1', 'conversation-1', 'conversation-1'].map((sid, i) => ({ id: String(i), direction: 'outbound', message_sid: sid, received_at: '2026-10-09T12:00:00Z' }));
  const result = summarize(d);
  assert.deepEqual(result.lifetime.mix, { initial: 1, followup: 1, conversation: 1 });
  assert.equal(result.lifetime.outbound, 3);
});

test('same provider initial message is deduplicated and denominators stay explicit', () => {
  const d = empty(); d.queue = [queue('1'), queue('2', { twilio_sid_initial: 'initial-1' })];
  const result = summarize(d);
  assert.equal(result.current.initial, 1); assert.equal(result.current.contacts, 1);
  assert.equal(result.current.replyRate, 0);
  assert.equal(summarize(empty()).current.replyRate, null);
});

test('confirmations survive cancellation, opt-out and later missing source rows', () => {
  const d = empty(); d.queue = [queue('1', { review_status: 'confirmed' })];
  const first = summarize(d); assert.equal(first.lifetime.confirmed, 1);
  d.queue[0].review_status = 'opted_out';
  d.visits = [{ id: 'visit', outreach_queue_id: '1', source: 'agent_outreach', status: 'cancelled', created_at: '2026-10-08T12:00:00Z' }];
  const second = summarize(d, first.confirmationLedger);
  assert.equal(second.lifetime.confirmed, 1); assert.equal(second.lifetime.cancelled, 1);
  assert.equal(second.relationships.active, 0); assert.equal(second.lifetime.hostOptOuts, 1);
  assert.equal(summarize(empty(), second.confirmationLedger).lifetime.confirmed, 1);
});

test('house/date duplicates count once and test visits do not create confirmations', () => {
  const d = empty(); d.queue = [queue('1', { review_status: 'accepted' }), queue('2', { open_house_id: 'house-1', review_status: 'confirmed' }), queue('3')];
  d.visits = [{ id: 'test', outreach_queue_id: '3', source: 'manual_test', status: 'live' }];
  assert.equal(summarize(d).lifetime.confirmed, 1);
});

test('production confirmation statuses count even without a field visit', () => {
  const d = empty();
  d.queue = [queue('1', { review_status: 'confirmed_open_house' }), queue('2', { agent_phone: '5165550101', review_status: 'accepted_open_house' })];
  const s = summarize(d);
  assert.equal(s.lifetime.confirmed, 2);
  assert.equal(s.current.confirmed, 2);
  assert.equal(s.relationships.statuses.confirmed, 2);
});

test('shared office numbers never merge conflicting names or attribute ambiguous replies', () => {
  const d = empty(); d.queue = [queue('1'), queue('2', { agent_name: 'Jane Other' })];
  d.replies = [{ id: 'r', direction: 'inbound', from_phone: '5165550100', received_at: '2026-10-09T12:00:00Z' }];
  const s = summarize(d); assert.equal(s.lifetime.contacts, 2); assert.equal(s.current.replied, 0);
  d.replies[0].queue_row_id = '2'; assert.equal(summarize(d).current.replied, 1);
});

test('compatible names coalesce and pre-send replies do not count toward the cohort', () => {
  const d = empty(); d.queue = [queue('1'), queue('2', { agent_name: 'Jared A Test, MBA' })];
  d.replies = [{ id: 'r', direction: 'inbound', queue_row_id: '1', received_at: '2026-10-01T12:00:00Z' }];
  assert.equal(summarize(d).lifetime.contacts, 1); assert.equal(summarize(d).current.replied, 0);
  d.replies[0].received_at = '2026-10-07T12:00:00Z'; assert.equal(summarize(d).current.replied, 1);
});

test('current partial week is excluded from cadence and zero weeks remain in the average', () => {
  const d = empty(); d.houses = [{ id: 'h1', created_at: '2026-09-21T12:00:00Z' }, { id: 'h2', created_at: '2026-10-12T12:00:00Z' }];
  const s = summarize(d); assert.equal(s.engine.completedWeeks, 3); assert.equal(s.engine.housesPerWeek, 1 / 3);
  assert.equal(s.engine.houses, 2); assert.equal(s.current.houses, 0);
});

test('lead records, distinct producing events and enrichment mismatches remain separate', () => {
  const d = empty(); d.houses = [{ id: 'h1', created_at: '2026-10-05T12:00:00Z', agent_enriched: false }, { id: 'h2', created_at: '2026-10-05T12:00:00Z', agent_enriched: true }];
  d.agents = [{ id: 'a', open_house_id: 'h1', phone: '5165550100', created_at: '2026-10-06 12:00:00' }];
  d.checkins = ['buyer', 'buyer', 'buyer_agent'].map((type, i) => ({ id: String(i), visitor_type: type, open_house_event_id: 'e1', created_at: '2026-10-10T12:00:00Z' }));
  const s = summarize(d); assert.equal(s.current.buyerCheckins, 2); assert.equal(s.current.producingEvents, 1);
  assert.equal(s.engine.recordWithoutFlag, 1); assert.equal(s.engine.flagWithoutRecord, 1);
});

test('PDF renders all six sections for empty and populated reports', async () => {
  const { PDFDocument } = require('pdf-lib');
  const d = empty(); d.houses = [{ id: 'h', created_at: '2026-08-03T12:00:00Z' }];
  for (let i = 0; i < 10; i++) d.queue.push(queue(String(i), { agent_phone: `51655501${String(i).padStart(2, '0')}`, brokerage: `Brokerage ${i}`, review_status: 'confirmed' }));
  for (const input of [empty(), d]) {
    const bytes = await require('../lib/outreach-report-pdf').renderPdf(summarize(input));
    assert.equal((await PDFDocument.load(bytes)).getPageCount(), 6);
  }
});

test('unauthorized JSON and PDF requests cannot read the archive', async () => {
  const context = { module: { exports: {} }, console, require: (name) => name.includes('admin-auth') ? {
    adminAuthorized: () => ({ ok: false, error: 'Unauthorized' }), assertAdminConfig() {}, sendJson: (res, status, body) => ({ status, body })
  } : new Proxy({}, { get() { throw new Error('Archive must not be read'); } }) };
  vm.runInNewContext(fs.readFileSync(require.resolve('../api/admin/outreach-performance-reports'), 'utf8'), context);
  for (const query of [{}, { week: '2026-10-05', format: 'pdf' }]) {
    const result = await context.module.exports({ method: 'GET', query }, { setHeader() {} }); assert.equal(result.status, 401);
  }
});

test('Monday schedule, private migration and required CI check are protected', () => {
  assert.ok(require('../vercel.json').crons.some((row) => row.path === '/api/cron/outreach-performance-report' && row.schedule === '10 13,14 * * 1'));
  const sql = fs.readFileSync('supabase/migrations/20261014004205_outreach_performance_reports.sql', 'utf8');
  assert.match(sql, /enable row level security/); assert.match(sql, /from public, anon, authenticated/); assert.match(sql, /protect_weekly_report_snapshot/);
  assert.match(fs.readFileSync('.github/workflows/repo-checks.yml', 'utf8'), /verify:outreach-reports/);
});
