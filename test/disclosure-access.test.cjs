'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), crypto = require('node:crypto');
process.env.DISCLOSURE_RECEIPT_SECRET = 'synthetic-receipt-secret-for-tests-only';
const { createAccess, setReceiptCookie, readReceipt, cookieName, assertSameOrigin } = require('../lib/disclosure-access');
const { createHandler, __test: internals } = require('../api/compliance/ny-disclosure');
const { createHandler: checkinHandler } = require('../api/event-checkin');
const res = () => ({ headers: {}, statusCode: 0, setHeader(k,v) { this.headers[k.toLowerCase()] = v; }, getHeader(k) { return this.headers[k.toLowerCase()]; }, status(n) { this.statusCode = n; return this; }, json(value) { this.body = value; }, send(value) { this.bytes = value; } });
const req = (extra = {}) => ({ method: 'GET', query: { checkin: 'checkin-1' }, headers: { host: 'app.rel8tion.me' }, ...extra });
const bytes = Buffer.from('%PDF-1.4 EXACT PRESERVED ORIGINAL\n%%EOF');
const hash = crypto.createHash('sha256').update(bytes).digest('hex');
function context(packet = true) { return { eventId: 'event-1', event: { id: 'event-1', host_agent_slug: 'host-one' }, checkin: { id: 'checkin-1', open_house_event_id: 'event-1', visitor_name: 'Synthetic Visitor', metadata: { ny_discrimination_disclosure: packet ? { signed_pdf: { storage_bucket: 'signed-disclosures', storage_path: 'host-one/original.pdf', storage_file_name: 'original.pdf', checkin_id: 'checkin-1', event_id: 'event-1', document_sha256: hash, packet_version: 'old-v1' } } : {} } } }; }
const actor = { kind: 'agent', slug: 'host-one' };
const noWrites = () => { throw new Error('A read must never invoke generation'); };
function harness({ ctx = context(), access = createAccess({ receipt: () => null, session: async () => null }), principal = actor, download = async () => bytes, generate = noWrites } = {}) {
  let reads = 0; const endpoint = createHandler({ access: { principal: async () => principal, authorize: access.authorize }, load: async () => { reads++; return ctx; }, download, generate }); return { endpoint, reads: () => reads };
}
function receiptCookie(checkinId = 'checkin-1', eventId = 'event-1') { const response = res(); setReceiptCookie(req(), response, { id: checkinId, open_house_event_id: eventId }); return response.headers['set-cookie'].at(-1).split(';')[0]; }
test('anonymous signed download rejects before reading any personal record', async () => {
  const response = res(); let reads = 0;
  await createHandler({ access: createAccess({ receipt: () => null, session: async () => null }), load: async () => { reads++; } })(req(), response);
  assert.equal(response.statusCode, 401); assert.equal(reads, 0); assert.match(response.headers['cache-control'], /private, no-store/);
});
test('signed NFC and phone sessions use current claimed-device validation; UID/query claims do not grant access', async () => {
  for (const [cookie, kind] of [['rel8tion_agent_nfc_session=verified', 'nfc'], ['rel8tion_agent_phone_session=verified', 'phone']]) {
    let checked = 0; const access = createAccess({ receipt: () => null, session: async () => null, [kind]: async () => { checked++; return { slug: 'host-one' }; } });
    const p = await access.principal(req({ headers: { cookie } }), res(), 'checkin-1'); await access.authorize(p, context()); assert.equal(checked, 1);
  }
  await assert.rejects(createAccess({ receipt: () => null, session: async () => null }).principal(req({ query: { uid: 'host-key', agent: 'host-one' } }), res(), 'checkin-1'), { status: 401 });
});
test('another host is rejected and no archive is retrieved', async () => {
  let downloads = 0; const h = harness({ principal: { kind: 'agent', slug: 'other-host' }, download: async () => { downloads++; return bytes; } }), response = res(); await h.endpoint(req(), response);
  assert.equal(response.statusCode, 403); assert.equal(downloads, 0);
});
test('an authenticated active workspace takes precedence over stale legacy NFC cookies', async () => {
  const context = { activeWorkspace: { role: 'broker', id: 'broker-workspace' }, permissions: ['compliance.read'] };
  const access = createAccess({ receipt: () => null, session: async () => context, nfc: async () => { throw new Error('Stale NFC cookie must not replace workspace authorization'); } });
  assert.equal((await access.principal(req({ headers: { cookie: 'rel8tion_agent_nfc_session=old' } }), res(), 'checkin-1')).kind, 'workspace');
});
test('anonymous generation and guessed administrative UID claims reject before personal reads', async () => {
  let reads = 0; const endpoint = createHandler({ access: createAccess({ receipt: () => null, session: async () => null }), load: async () => { reads++; } });
  const response = res(); await endpoint(req({ method: 'POST', headers: { host: 'app.rel8tion.me', 'x-admin-uid': 'guessed-admin' }, body: { checkin_id: 'checkin-1' } }), response);
  assert.equal(response.statusCode, 401); assert.equal(reads, 0);
});
test('broker requires explicit event compliance assignment, not just a matching brokerage or agent assignment', async () => {
  const p = { kind: 'workspace', context: { activeWorkspace: { id: 'office-workspace', role: 'broker', organization: { id: 'office-one' } }, permissions: ['compliance.read'] } };
  await assert.rejects(createAccess().authorize({ ...p, context: { ...p.context, activeWorkspace: { ...p.context.activeWorkspace, organization: null } } }, context()), { status: 403 });
  for (const assignments of [[], [{ resource_type: 'agent_slug', resource_id: 'host-one', relationship_type: 'team' }], [{ resource_type: 'open_house_event', resource_id: 'event-2', relationship_type: 'compliance' }]]) await assert.rejects(createAccess({ rest: async () => assignments }).authorize(p, context()), { status: 403 });
  await createAccess({ rest: async path => { assert.match(path, /workspace_id=eq.office-workspace/); return [{ resource_type: 'open_house_event', resource_id: 'event-1', relationship_type: 'compliance' }]; } }).authorize(p, context());
  await assert.rejects(createAccess().authorize(p, context(), true), { status: 403 });
});
test('LO and staff roles are not implicit signed-record access; workspace permissions can deny access', async () => {
  for (const role of ['loan_officer', 'staff', 'buyer', 'founder']) await assert.rejects(createAccess({ receipt: () => null, session: async () => ({ activeWorkspace: { role }, permissions: ['compliance.read'] }) }).principal(req(), res(), 'checkin-1'), { status: 403 });
  await assert.rejects(createAccess({ receipt: () => null, session: async () => ({ activeWorkspace: { role: 'broker' }, permissions: [] }) }).principal(req(), res(), 'checkin-1'), { status: 403 });
});
test('receipt is HttpOnly, secure, check-in/event scoped, tamper resistant and expiring', () => {
  const response = res(); setReceiptCookie(req(), response, { id: 'checkin-1', open_house_event_id: 'event-1' }); const raw = response.headers['set-cookie'][0]; assert.match(raw, /HttpOnly; SameSite=Strict; Secure/);
  const cookie = raw.split(';')[0]; assert.equal(readReceipt(req({ headers: { cookie } }), 'checkin-1').eventId, 'event-1'); assert.equal(readReceipt(req({ headers: { cookie } }), 'other'), null);
  assert.equal(readReceipt(req({ headers: { cookie: cookie.replace(/.$/, cookie.endsWith('a') ? 'b' : 'a') } }), 'checkin-1'), null);
  const now = Date.now; try { Date.now = () => now() + 86401000; assert.equal(readReceipt(req({ headers: { cookie } }), 'checkin-1'), null); } finally { Date.now = now; }
});
test('receipt accesses its own original but cannot access another event or generate after 15 minutes', async () => {
  const access = createAccess(), request = req({ headers: { host: 'app.rel8tion.me', cookie: receiptCookie() } }), p = await access.principal(request, res(), 'checkin-1');
  await access.authorize(p, context()); await assert.rejects(access.authorize(p, { ...context(), eventId: 'other' }), { status: 403 });
  await assert.rejects(access.authorize({ ...p, claim: { ...p.claim, iat: Math.floor(Date.now() / 1000) - 901 } }, context(), true), { status: 403 });
});
test('GET streams exact stored old-version bytes without source fetching, writes or current-version replacement', async () => {
  const h = harness(), response = res(); await h.endpoint(req(), response);
  assert.equal(response.statusCode, 200); assert.deepEqual(response.bytes, bytes); assert.equal(response.headers['x-rel8tion-archive-integrity'], 'sha256-verified');
});
test('missing descriptor, missing object or corrupt hash fail visibly, with no regeneration', async () => {
  const badHash = context(); badHash.checkin.metadata.ny_discrimination_disclosure.signed_pdf.document_sha256 = '0'.repeat(64);
  for (const options of [{ ctx: context(false) }, { download: async () => { throw Object.assign(new Error('Original missing; no replacement'), { status: 409 }); } }, { ctx: badHash }]) { const h = harness(options), response = res(); await h.endpoint(req(), response); assert.equal(response.statusCode, 409); assert.equal(response.bytes, undefined); }
});
test('legacy missing hash is labeled, and explicit history selection preserves exact chosen original', async () => {
  const ctx = context(); const original = ctx.checkin.metadata.ny_discrimination_disclosure.signed_pdf;
  const olderBytes = Buffer.from('%PDF-1.4 OLDER ORIGINAL\n%%EOF'), oldHash = crypto.createHash('sha256').update(olderBytes).digest('hex');
  ctx.checkin.metadata.ny_discrimination_disclosure.signed_pdf_history = [{ ...original, storage_path: 'host-one/older.pdf', document_sha256: oldHash }];
  const h = harness({ ctx, download: async (_, path) => path.endsWith('older.pdf') ? olderBytes : bytes }), response = res(); await h.endpoint(req({ query: { checkin: 'checkin-1', packet: oldHash } }), response); assert.deepEqual(response.bytes, olderBytes);
  delete original.document_sha256; const legacy = res(); await h.endpoint(req(), legacy); assert.equal(legacy.headers['x-rel8tion-archive-integrity'], 'legacy-hash-unavailable');
});
test('storage descriptors cannot traverse, change bucket or bind to a different buyer/event', () => {
  for (const patch of [{ storage_path: '../another.pdf' }, { storage_path: 'host\\file.pdf' }, { storage_bucket: 'another-private-bucket' }, { checkin_id: 'another-checkin' }, { event_id: 'another-event' }]) {
    const ctx = context(); Object.assign(ctx.checkin.metadata.ny_discrimination_disclosure.signed_pdf, patch); assert.throws(() => internals.storedPacket(ctx), { status: 409 });
  }
});
test('POST retry returns an existing archive without overwriting or regenerating it', async () => {
  const response = res(); await harness().endpoint(req({ method: 'POST', query: {}, body: { checkin_id: 'checkin-1' } }), response); assert.equal(response.statusCode, 200); assert.equal(response.body.existing, true);
});
test('a still-valid buyer receipt can reuse its original after the initial-generation window closes', async () => {
  const h = harness({ principal: { kind: 'receipt', claim: { checkinId: 'checkin-1', eventId: 'event-1', iat: Math.floor(Date.now()/1000) - 1000 } } }), response = res();
  await h.endpoint(req({ method: 'POST', query: {}, body: { checkin_id: 'checkin-1' } }), response); assert.equal(response.statusCode, 200); assert.equal(response.body.existing, true);
});
test('POST requires captured sequence, rejects cross-origin mutation; public unsigned preview stays available', async () => {
  const h = harness({ ctx: context(false) }), incomplete = res(); await h.endpoint(req({ method: 'POST', query: {}, body: { checkin_id: 'checkin-1' } }), incomplete); assert.equal(incomplete.statusCode, 409);
  const cross = res(); await h.endpoint(req({ method: 'POST', headers: { host: 'app.rel8tion.me', origin: 'https://evil.test' }, body: { checkin_id: 'checkin-1' } }), cross); assert.equal(cross.statusCode, 403); assert.equal(h.reads(), 1);
  const unsigned = res(); await createHandler({ preview: async (_, response) => response.status(200).send(bytes), load: noWrites })(req({ query: { event: 'public-event' } }), unsigned); assert.equal(unsigned.statusCode, 200);
  assert.throws(() => assertSameOrigin(req({ headers: { 'sec-fetch-site': 'same-site' } })), { status: 403 });
});
test('initial generation requires a fresh complete capture; historical missing archives cannot be reconstructed', async () => {
  const ctx = context(false), now = new Date().toISOString(); ctx.checkin.created_at = now;
  ctx.checkin.metadata = { ny_discrimination_disclosure: { acknowledged: true, reviewed: true, esign_consent: true, e_signature_value: 'Synthetic Visitor', signed_at: now }, nys_agency_disclosure: { agency_disclosure_reviewed: true, seller_representation_acknowledged: true, agency_disclosure_signed_at: now }, rel8tion_courtesy_notice: { rel8tion_courtesy_acknowledged: true, rel8tion_courtesy_signed_at: now } };
  let generated = 0; const h = harness({ ctx, generate: async original => { generated++; return { signedPdf: { document_sha256: hash }, updatedCheckin: original.checkin }; } });
  const first = res(); await h.endpoint(req({ method: 'POST', query: {}, body: { checkin_id: 'checkin-1' } }), first); assert.equal(first.statusCode, 201); assert.equal(generated, 1);
  ctx.checkin.created_at = '2020-01-01T00:00:00Z'; const historical = res(); await h.endpoint(req({ method: 'POST', query: {}, body: { checkin_id: 'checkin-1' } }), historical); assert.equal(historical.statusCode, 409); assert.equal(generated, 1);
});
test('create issues a receipt only for the inserted row and strips caller supplied archive pointers', async () => {
  const calls = [], response = res(); const handler = checkinHandler({ rest: async (path, options) => { calls.push({ path, options }); if (path.startsWith('open_house_events?') && !options) return [{ id: 'event-1' }]; if (path === 'event_checkins') return [{ id: 'new-checkin', ...JSON.parse(options.body) }]; return []; } });
  await handler(req({ method: 'POST', query: {}, body: { checkin: { open_house_event_id: 'event-1', visitor_type: 'buyer', visitor_name: 'Synthetic Visitor', visitor_phone: '2025550111', metadata: { ny_discrimination_disclosure: { acknowledged: true, signed_pdf: { storage_path: 'stolen' }, signed_pdf_history: [{ storage_path: 'stolen' }] } } } } }), response);
  assert.equal(response.statusCode, 201); const saved = JSON.parse(calls.find(c => c.path === 'event_checkins').options.body); assert.deepEqual(saved.metadata.ny_discrimination_disclosure, { acknowledged: true });
  const cookie = response.headers['set-cookie'][0].split(';')[0]; assert.ok(readReceipt(req({ headers: { cookie } }), 'new-checkin')); assert.equal(readReceipt(req({ headers: { cookie } }), 'checkin-1'), null);
});
test('metadata mutation requires own receipt and preserves captured evidence when stale/full metadata is submitted', async () => {
  const original = { ny_discrimination_disclosure: { signed_pdf: { storage_path: 'original' } }, disclosure_accepted: true, financing_requested: false };
  let writes = 0;
  const handler = checkinHandler({ rest: async (path, options) => { if (!options) return [{ id: 'checkin-1', open_house_event_id: 'event-1', metadata: original }]; writes++; const metadata = JSON.parse(options.body).metadata; assert.deepEqual(metadata.ny_discrimination_disclosure, original.ny_discrimination_disclosure); assert.equal(metadata.financing_requested, false); assert.equal(metadata.listing_sms_url, 'https://example.test/property'); assert.match(path, /&metadata=eq\./); return [{ id: 'checkin-1', metadata }]; } });
  const body = { action: 'update_metadata', checkin_id: 'checkin-1', metadata: { ny_discrimination_disclosure: {}, financing_requested: true, listing_sms_url: 'https://example.test/property' } };
  const anonymous = res(); await handler(req({ method: 'POST', body }), anonymous); assert.equal(anonymous.statusCode, 401); assert.equal(writes, 0);
  const own = res(); await handler(req({ method: 'POST', headers: { host: 'app.rel8tion.me', cookie: receiptCookie() }, body }), own); assert.equal(own.statusCode, 200); assert.equal(writes, 1);
});
