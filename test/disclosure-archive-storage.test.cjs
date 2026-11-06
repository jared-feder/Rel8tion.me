'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
process.env.SUPABASE_URL = 'https://database.example.test';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'synthetic-test-service-key';
const { PDFDocument } = require('pdf-lib');
const { __test: archive } = require('../api/compliance/ny-disclosure');
const ctx = () => ({ address: '42 Fictional Court', agentName: 'Test Agent', brokerage: 'Test Brokerage', eventId: 'event-test', event: { host_agent_slug: 'test-agent' }, checkin: { id: 'abcdef12-1234', visitor_name: 'Test Visitor', created_at: new Date().toISOString(), metadata: { ny_discrimination_disclosure: { e_signature_value: 'Test Visitor', signed_at: new Date().toISOString() } } } });
test('phone archive access verifies the signed cookie and rechecks that the device remains claimed', async () => {
  const crypto = require('node:crypto'), { requirePhoneSession } = require('../api/agent-phone-lock');
  const beforeSecret = process.env.AGENT_PHONE_LOCK_SECRET, original = global.fetch; process.env.AGENT_PHONE_LOCK_SECRET = 'synthetic-phone-secret';
  let claimed = true, reads = 0;
  global.fetch = async url => { reads++; return new Response(JSON.stringify(url.includes('/keys?') ? (claimed ? [{ uid: 'test-key', agent_slug: 'test-agent', device_role: 'chip' }] : []) : [{ slug: 'test-agent', name: 'Test Agent', phone_normalized: '+12025550111' }]), { status: 200 }); };
  const cookie = expiry => { const payload = Buffer.from(JSON.stringify({ slug: 'test-agent', uid: 'test-key', exp: expiry })).toString('base64url'); return `rel8tion_agent_phone_session=${payload}.${crypto.createHmac('sha256', process.env.AGENT_PHONE_LOCK_SECRET).update(payload).digest('base64url')}`; };
  try {
    const request = { headers: { cookie: cookie(Math.floor(Date.now()/1000) + 60) } }; assert.equal((await requirePhoneSession(request)).slug, 'test-agent');
    claimed = false; await assert.rejects(requirePhoneSession(request), { status: 403 });
    const before = reads; await assert.rejects(requirePhoneSession({ headers: { cookie: cookie(1) } }), { status: 401 }); assert.equal(reads, before);
  } finally { global.fetch = original; if (beforeSecret === undefined) delete process.env.AGENT_PHONE_LOCK_SECRET; else process.env.AGENT_PHONE_LOCK_SECRET = beforeSecret; }
});
test('initial archive uses content-addressed create-only storage and compare-and-set metadata', async () => {
  const source = await PDFDocument.create(); source.addPage([612,792]); const sourceBytes = await source.save();
  const original = global.fetch, calls = [], context = ctx();
  global.fetch = async (url, options) => {
    calls.push({ url, options });
    if (url.includes('/storage/v1/object/')) { assert.equal(options.method, 'POST'); assert.equal(options.headers['x-upsert'], 'false'); assert.match(url, /-[a-f0-9]{64}\.pdf$/); return new Response('{}', { status: 200 }); }
    if (url.includes('/rest/v1/event_checkins')) { assert.equal(options.method, 'PATCH'); assert.ok(url.includes(`&metadata=eq.${encodeURIComponent(JSON.stringify(context.checkin.metadata))}`)); return new Response(JSON.stringify([{ ...context.checkin, ...JSON.parse(options.body) }]), { status: 200 }); }
    return new Response(sourceBytes, { status: 200, headers: { 'content-type': 'application/pdf' } });
  };
  try {
    const result = await archive.generateAndStoreSignedPacket(context); const upload = calls.find(c => c.url.includes('/storage/v1/object/'));
    assert.equal(result.signedPdf.document_sha256, archive.sha256Hex(upload.options.body)); assert.equal(result.signedPdf.checkin_id, context.checkin.id);
    assert.equal(calls.filter(c => c.options?.method === 'PATCH').length, 1);
  } finally { global.fetch = original; }
});
test('a concurrent metadata change cannot replace another archive pointer; storage objects are never upserted', async () => {
  const source = await PDFDocument.create(); source.addPage([612,792]); const sourceBytes = await source.save(), original = global.fetch; let writes = 0;
  global.fetch = async (url, options) => {
    if (url.includes('/storage/v1/object/')) { assert.equal(options.headers['x-upsert'], 'false'); return new Response('{}', { status: 200 }); }
    if (url.includes('/rest/v1/event_checkins')) { writes++; assert.match(url, /&metadata=eq\./); return new Response('[]', { status: 200 }); }
    return new Response(sourceBytes, { status: 200, headers: { 'content-type': 'application/pdf' } });
  };
  try { await assert.rejects(archive.generateAndStoreSignedPacket(ctx()), { status: 409 }); assert.equal(writes, 1); } finally { global.fetch = original; }
});
