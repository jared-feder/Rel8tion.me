const assert = require('assert');

process.env.REL8TIONOS_API_KEY = 'rel8tionos_test_primary_1234567890';
process.env.REL8TIONOS_API_PREVIOUS_KEY = 'rel8tionos_test_previous_1234567890';
process.env.SUPABASE_URL = 'https://rel8tionos-test.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key';

const THREAD_ID = 'b674dd8f-99f1-40f7-9ec2-403634b3571c';
const LO_UID = 'f855a780-9be7-4d17-b2c6-464344b75475';

const queueRow = {
  id: THREAD_ID,
  open_house_id: 'open-house-test',
  agent_name: 'Owner Test',
  agent_phone: '(516) 555-8059',
  agent_phone_normalized: '5165558059',
  agent_email: 'owner@example.test',
  brokerage: 'REL8TION Test',
  address: '118 S 31st St',
  city: 'Wyandanch',
  state: 'NY',
  zip: '11798',
  review_status: 'pending',
  initial_delivery_status: 'delivered',
  last_delivery_status: 'delivered'
};

const inboxRow = {
  ...queueRow,
  queue_row_id: THREAD_ID,
  thread_key: THREAD_ID,
  reply_count: 2,
  direction: 'inbound',
  latest_reply_body: 'TEST',
  latest_reply_opt_out: false,
  any_opt_out: false,
  last_reply_at: '2026-07-15T12:00:00.000Z'
};

const outboundMessage = {
  id: '65fda4af-1d2d-45e5-9d22-101bfa050be9',
  queue_row_id: THREAD_ID,
  from_phone: '+18448211802',
  to_phone: '+15165558059',
  body: 'Dashboard test reply',
  direction: 'outbound',
  opt_out: false,
  message_sid: 'SM_TEST',
  received_at: '2026-07-15T12:01:00.000Z',
  created_at: '2026-07-15T12:01:00.000Z'
};

let duplicateLog = null;
let edgeCalls = 0;
let lastEdgeBody = null;

function jsonResponse(payload, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(payload)
  };
}

global.fetch = async (url, options = {}) => {
  const target = String(url);
  if (target.includes('/functions/v1/send-agent-manual-reply')) {
    edgeCalls += 1;
    lastEdgeBody = JSON.parse(options.body || '{}');
    return jsonResponse({ ok: true, sid: 'SM_REL8TIONOS_TEST', provider: 'twilio', sent_at: '2026-07-15T12:02:00.000Z' });
  }
  if (target.includes('/rest/v1/agent_outreach_inbox?')) return jsonResponse([inboxRow]);
  if (target.includes('/rest/v1/agent_outreach_queue?')) {
    if (target.includes('id=in.')) return jsonResponse([queueRow]);
    return jsonResponse([queueRow]);
  }
  if (target.includes('/rest/v1/agent_outreach_replies?')) return jsonResponse([outboundMessage]);
  if (target.includes('/rest/v1/field_demo_visits?')) return jsonResponse([]);
  if (target.includes('/rest/v1/sms_message_log?')) return jsonResponse(duplicateLog ? [duplicateLog] : []);
  if (target.includes('/rest/v1/verified_profiles?')) {
    return jsonResponse([{ uid: LO_UID, slug: 'jared-feder', full_name: 'Jared Feder', is_active: true }]);
  }
  throw new Error(`Unexpected test request: ${target}`);
};

function mockResponse() {
  return {
    headers: {},
    statusCode: 200,
    payload: null,
    setHeader(name, value) {
      this.headers[String(name).toLowerCase()] = value;
    },
    status(value) {
      this.statusCode = value;
      return this;
    },
    json(value) {
      this.payload = value;
      return this;
    }
  };
}

async function main() {
  const auth = require('../lib/rel8tionos-auth');
  const outreach = require('../lib/rel8tionos-outreach');

  assert.equal(auth.authorizeRel8tionOs({ headers: {} }).status, 401);
  assert.equal(auth.authorizeRel8tionOs({ headers: { authorization: 'Bearer wrong' } }).status, 401);
  assert.deepEqual(
    auth.authorizeRel8tionOs({ headers: { authorization: `Bearer ${process.env.REL8TIONOS_API_KEY}` } }),
    { ok: true, key_id: 'primary' }
  );
  assert.deepEqual(
    auth.authorizeRel8tionOs({ headers: { 'x-rel8tionos-key': process.env.REL8TIONOS_API_PREVIOUS_KEY } }),
    { ok: true, key_id: 'previous' }
  );

  assert.equal(outreach.validateThreadId(THREAD_ID), THREAD_ID);
  assert.throws(() => outreach.validateThreadId('bad-id'), /valid thread_id/);
  assert.equal(outreach.validateIdempotencyKey('reply:test-001'), 'reply:test-001');
  assert.throws(() => outreach.validateIdempotencyKey('short'), /8-120/);

  const listed = await outreach.listThreads({ filter: 'needs_reply', limit: 10 });
  assert.equal(listed.threads.length, 1);
  assert.equal(listed.threads[0].id, THREAD_ID);
  assert.equal(listed.threads[0].latest_message.body, 'TEST');
  assert.equal(listed.threads[0].can_reply, true);
  await assert.rejects(() => outreach.listThreads({ filter: 'surprise' }), /filter must be/);

  const detail = await outreach.getThread(THREAD_ID);
  assert.equal(detail.thread.id, THREAD_ID);
  assert.equal(detail.messages.length, 1);
  assert.equal(detail.messages[0].message_sid, 'SM_TEST');

  duplicateLog = null;
  const sent = await outreach.sendReply({
    thread_id: THREAD_ID,
    body: 'Rel8tionOS integration test\n\nReply STOP to opt out.',
    idempotency_key: 'reply:test-send-001'
  });
  assert.equal(sent.duplicate, false);
  assert.equal(sent.message_sid, 'SM_REL8TIONOS_TEST');
  assert.equal(edgeCalls, 1);
  assert.equal(lastEdgeBody.campaign, 'rel8tionos:reply:test-send-001');

  duplicateLog = {
    id: '2973990d-355a-4800-a3fb-bd206707a4c8',
    external_id: 'SM_ALREADY_SENT',
    status: 'sent',
    body: 'Rel8tionOS integration test',
    metadata: { queue_row_id: THREAD_ID },
    created_at: '2026-07-15T12:03:00.000Z'
  };
  const duplicate = await outreach.sendReply({
    thread_id: THREAD_ID,
    body: 'Rel8tionOS integration test',
    idempotency_key: 'reply:test-send-001'
  });
  assert.equal(duplicate.duplicate, true);
  assert.equal(duplicate.message_sid, 'SM_ALREADY_SENT');
  assert.equal(edgeCalls, 1, 'duplicate reply must not call the SMS function again');
  await assert.rejects(
    () => outreach.sendReply({
      thread_id: THREAD_ID,
      body: 'A different message',
      idempotency_key: 'reply:test-send-001'
    }),
    /already used for a different reply/
  );

  const healthHandler = require('../api/rel8tionos/health');
  const unauthorizedResponse = mockResponse();
  await healthHandler({ method: 'GET', headers: {} }, unauthorizedResponse);
  assert.equal(unauthorizedResponse.statusCode, 401);
  assert.equal(unauthorizedResponse.payload.ok, false);
  assert.equal(unauthorizedResponse.headers['cache-control'].includes('no-store'), true);

  const replyHandler = require('../api/rel8tionos/reply');
  const methodResponse = mockResponse();
  await replyHandler({ method: 'GET', headers: {} }, methodResponse);
  assert.equal(methodResponse.statusCode, 405);
  assert.equal(methodResponse.headers.allow, 'POST');

  assert.equal(typeof require('../api/admin/outreach-action').acceptOpenHouse, 'function');
  assert.equal(typeof require('../api/admin/loan-officer-assignment').assignLiveCoverage, 'function');

  console.log('Rel8tionOS API verification passed: auth, validation, thread reads, reply send, and reply deduplication.');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
