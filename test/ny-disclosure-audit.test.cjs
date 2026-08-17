const assert = require('node:assert/strict');
const test = require('node:test');

const { PDFDocument } = require('pdf-lib');

process.env.SUPABASE_URL = 'https://supabase.test';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-test-key';

const disclosure = require('../api/compliance/ny-disclosure.js').__test;

async function twoPageSourcePdf() {
  const pdf = await PDFDocument.create();
  pdf.addPage([612, 792]);
  pdf.addPage([612, 792]);
  return Buffer.from(await pdf.save());
}

test('packet generation is write-once, audited, hash-checked, and idempotent', async () => {
  const sourceBytes = await twoPageSourcePdf();
  const originalFetch = global.fetch;
  const storageWrites = [];
  const auditWrites = [];
  const metadataWrites = [];
  let storedBytes;
  let insertedAuditEvent;

  global.fetch = async (url, options = {}) => {
    const target = String(url);
    const method = options.method || 'GET';

    if (target === disclosure.AGENCY_SOURCE_PDF_URL || target === disclosure.SOURCE_PDF_URL) {
      return new Response(sourceBytes, { status: 200, headers: { 'content-type': 'application/pdf' } });
    }
    if (target.includes('/rest/v1/disclosure_signing_events?') && method === 'GET') {
      return Response.json(insertedAuditEvent ? [insertedAuditEvent] : []);
    }
    if (target.includes('/storage/v1/object/signed-disclosures/') && method === 'POST') {
      storageWrites.push({ target, options });
      storedBytes = Buffer.from(options.body);
      return Response.json({ Key: target });
    }
    if (target.includes('/storage/v1/object/signed-disclosures/') && method === 'GET') {
      return new Response(storedBytes, { status: 200, headers: { 'content-type': 'application/pdf' } });
    }
    if (target.includes('/rest/v1/disclosure_signing_events?') && method === 'POST') {
      const body = JSON.parse(options.body);
      auditWrites.push(body);
      insertedAuditEvent = {
        ...body,
        event_hash: 'b'.repeat(64),
        server_received_at: '2026-08-17T12:00:01.000Z'
      };
      return Response.json([insertedAuditEvent]);
    }
    if (target.includes('/rest/v1/event_checkins?') && method === 'PATCH') {
      const body = JSON.parse(options.body);
      metadataWrites.push(body.metadata);
      return Response.json([{ id: context.checkin.id, ...context.checkin, metadata: body.metadata }]);
    }
    throw new Error(`Unexpected request: ${method} ${target}`);
  };

  const context = {
    checkin: {
      id: '22222222-2222-4222-8222-222222222222',
      open_house_event_id: '11111111-1111-4111-8111-111111111111',
      visitor_name: 'Jordan Buyer',
      visitor_type: 'Buyer',
      created_at: '2026-08-17T12:00:00.000Z',
      metadata: {
        ny_discrimination_disclosure: {
          form_version: '11/25',
          acknowledged: true,
          esign_consent: true,
          esign_consent_text: disclosure.DISCLOSURE_CONSENT_TEXT,
          esign_consent_version: disclosure.DISCLOSURE_CONSENT_VERSION,
          e_signature_type: 'checkbox_plus_prefilled_name',
          e_signature_value: 'Jordan Buyer',
          signed_at: '2026-08-17T12:00:00.000Z',
          signed_date: '2026-08-17',
          user_agent: 'Client Browser/1.0',
          provided_by_agent_name: 'Alex Agent',
          provided_by_brokerage: 'Example Realty'
        },
        nys_agency_disclosure: {
          agency_disclosure_signed_at: '2026-08-17T11:59:00.000Z',
          agency_disclosure_version: 'DOS-1736-f-09/21'
        },
        rel8tion_courtesy_notice: {
          rel8tion_courtesy_signed_at: '2026-08-17T11:59:30.000Z'
        }
      }
    },
    event: { id: '11111111-1111-4111-8111-111111111111', host_agent_slug: 'alex-agent' },
    eventId: '11111111-1111-4111-8111-111111111111',
    house: { open_start: '2026-08-17T15:00:00.000Z' },
    agent: { slug: 'alex-agent' },
    agentName: 'Alex Agent',
    brokerage: 'Example Realty',
    address: '123 Main Street, Farmingdale, NY',
    openHouseSourceId: 'listing-123'
  };

  try {
    const first = await disclosure.generateAndStoreSignedPacket(context, {
      requestIp: '203.0.113.12',
      serverUserAgent: 'Server Browser/1.0',
      requestId: 'iad1::request'
    }, 'server_request');

    assert.equal(first.reused, false);
    assert.equal(storageWrites.length, 1);
    assert.equal(storageWrites[0].options.headers['x-upsert'], 'false');
    assert.match(storageWrites[0].target, new RegExp(first.signedPdf.audit_event_id));
    assert.match(storageWrites[0].target, new RegExp(first.signedPdf.document_sha256));
    assert.equal(auditWrites.length, 1);
    assert.equal(auditWrites[0].request_ip, '203.0.113.12');
    assert.equal(auditWrites[0].consent_text, disclosure.DISCLOSURE_CONSENT_TEXT);
    assert.equal(auditWrites[0].evidence.client_consent_text_matches, true);
    assert.equal(first.signedPdf.audit_event_hash, 'b'.repeat(64));
    assert.equal(metadataWrites.length, 1);

    const second = await disclosure.generateAndStoreSignedPacket(context, {
      requestIp: '198.51.100.9',
      serverUserAgent: 'Retry Browser/1.0',
      requestId: 'iad1::retry'
    }, 'server_request');

    assert.equal(second.reused, true);
    assert.equal(storageWrites.length, 1);
    assert.equal(auditWrites.length, 1);
    assert.equal(metadataWrites.length, 2);
    assert.equal(second.signedPdf.document_sha256, first.signedPdf.document_sha256);
    assert.deepEqual(Buffer.from(second.bytes), Buffer.from(first.bytes));
  } finally {
    global.fetch = originalFetch;
  }
});
