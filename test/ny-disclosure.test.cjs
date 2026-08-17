const assert = require('node:assert/strict');
const test = require('node:test');

const {
  PDFArray,
  PDFDocument,
  PDFRawStream,
  decodePDFRawStream
} = require('pdf-lib');

const disclosure = require('../api/compliance/ny-disclosure.js').__test;

async function twoPageSourcePdf() {
  const pdf = await PDFDocument.create();
  pdf.addPage([612, 792]);
  pdf.addPage([612, 792]);
  return Buffer.from(await pdf.save());
}

function decodedPageContent(pdf, pageIndex) {
  const page = pdf.getPage(pageIndex);
  const contents = page.node.Contents();
  const refs = contents instanceof PDFArray ? contents.asArray() : [contents];
  return refs.map((ref) => {
    const stream = pdf.context.lookup(ref);
    if (!(stream instanceof PDFRawStream)) return '';
    return Buffer.from(decodePDFRawStream(stream).decode()).toString('latin1');
  }).join('\n');
}

function pdfHex(value) {
  return Buffer.from(value, 'latin1').toString('hex').toUpperCase();
}

test('signed packet writes names, signature, date, and agency role onto both official forms', async () => {
  const sourceBytes = await twoPageSourcePdf();
  const originalFetch = global.fetch;
  const requests = [];
  global.fetch = async (url, options = {}) => {
    const target = String(url);
    requests.push({ target, options });
    if (target === disclosure.AGENCY_SOURCE_PDF_URL || target === disclosure.SOURCE_PDF_URL) {
      return new Response(sourceBytes, { status: 200, headers: { 'content-type': 'application/pdf' } });
    }
    throw new Error(`Unexpected URL: ${target}`);
  };

  try {
    const bytes = await disclosure.buildDisclosurePdf({
      agentName: 'Alexandra Listing Agent',
      brokerage: 'Signature Premier Properties',
      address: '123 Main Street, Farmingdale, NY'
    }, {
      signed: true,
      auditEventId: '00000000-0000-4000-8000-000000000001',
      signature: 'Jordan Buyer',
      signedAt: '2026-08-13T18:12:00.000Z',
      signedDate: '2026-08-13',
      consumerRole: 'Buyer',
      agency: { agency_disclosure_signed_at: '2026-08-13T18:09:00.000Z' },
      courtesy: { rel8tion_courtesy_signed_at: '2026-08-13T18:11:00.000Z' }
    });
    const pdf = await PDFDocument.load(bytes);

    assert.equal(pdf.getPageCount(), 6);
    const coverPage = decodedPageContent(pdf, 0);
    const agencyPage = decodedPageContent(pdf, 3);
    const housingPage = decodedPageContent(pdf, 5);
    for (const page of [agencyPage, housingPage]) {
      assert.match(page, new RegExp(`<${pdfHex('Alexandra Listing Agent')}>`));
      assert.match(page, new RegExp(`<${pdfHex('Signature Premier Properties')}>`));
      assert.match(page, new RegExp(`<${pdfHex('Jordan Buyer')}>`));
      assert.match(page, new RegExp(`<${pdfHex('08/13/2026')}>`));
    }
    assert.ok((agencyPage.match(new RegExp(`<${pdfHex('X')}>`, 'g')) || []).length >= 3);
    assert.match(agencyPage, /Helvetica-Oblique/);
    assert.match(housingPage, /Helvetica-Oblique/);
    assert.match(coverPage, new RegExp(pdfHex('00000000-0000-4000-8000-000000000001')));
    assert.match(coverPage, new RegExp(pdfHex(disclosure.DISCLOSURE_PACKET_VERSION)));
    assert.equal(requests.length, 2);
    for (const request of requests) {
      assert.equal(request.options.headers.Accept, 'application/pdf,*/*');
      assert.match(request.options.headers['User-Agent'], /^REL8TION\//);
    }
  } finally {
    global.fetch = originalFetch;
  }
});

test('source fetch rejects an HTML response even when the server returns 200', async () => {
  const originalFetch = global.fetch;
  global.fetch = async () => new Response('<html>blocked</html>', {
    status: 200,
    headers: { 'content-type': 'text/html' }
  });
  try {
    await assert.rejects(
      disclosure.fetchSourcePdf('https://example.test/form', 'test form'),
      /received text\/html/
    );
  } finally {
    global.fetch = originalFetch;
  }
});

test('only the corrected packet version is reused from storage', () => {
  const common = {
    storage_bucket: 'signed-disclosures',
    storage_path: 'agent/event/packet.pdf',
    document_type: disclosure.DISCLOSURE_PACKET_TYPE
  };
  assert.equal(disclosure.isCurrentStoredPacket({ ...common, packet_version: '2026-05-09-three-step-v1' }), false);
  assert.equal(disclosure.isCurrentStoredPacket({ ...common, packet_version: disclosure.DISCLOSURE_PACKET_VERSION }), false);
  assert.equal(disclosure.isCurrentStoredPacket({
    ...common,
    packet_version: disclosure.DISCLOSURE_PACKET_VERSION,
    audit_event_id: '00000000-0000-4000-8000-000000000001',
    write_once: true
  }), true);
});

test('write-once storage paths bind packet version, audit event, and PDF hash', () => {
  const auditEventId = '00000000-0000-4000-8000-000000000001';
  const hash = 'a'.repeat(64);
  const fileName = 'signed-packet.pdf';
  const path = disclosure.buildWriteOnceStoragePath({
    address: '123 Main St',
    eventId: '11111111-1111-4111-8111-111111111111',
    event: { host_agent_slug: 'alex-agent' }
  }, {
    id: '22222222-2222-4222-8222-222222222222',
    created_at: '2026-08-17T12:00:00Z'
  }, fileName, auditEventId, hash);

  assert.match(path, new RegExp(disclosure.DISCLOSURE_PACKET_VERSION));
  assert.match(path, new RegExp(auditEventId));
  assert.match(path, new RegExp(hash));
  assert.match(path, new RegExp(`${fileName}$`));
});

test('server request evidence prefers Vercel trusted forwarding headers', () => {
  const evidence = disclosure.readRequestEvidence({
    headers: {
      'x-vercel-forwarded-for': '203.0.113.12',
      'x-forwarded-for': '198.51.100.4',
      'user-agent': 'Audit Browser/1.0',
      'x-vercel-id': 'iad1::abc'
    }
  });
  assert.deepEqual(evidence, {
    requestIp: '203.0.113.12',
    serverUserAgent: 'Audit Browser/1.0',
    requestId: 'iad1::abc'
  });
  assert.equal(disclosure.readRequestEvidence({ headers: { 'x-forwarded-for': 'not-an-ip' } }).requestIp, null);
});

test('historical packet conversion never presents downloader headers as signer evidence', () => {
  const context = {
    checkin: {
      id: '22222222-2222-4222-8222-222222222222',
      visitor_name: 'Jordan Buyer',
      visitor_type: 'Buyer',
      created_at: '2026-08-01T12:00:00Z',
      metadata: {
        ny_discrimination_disclosure: {
          acknowledged: true,
          esign_consent: true,
          e_signature_value: 'Jordan Buyer',
          signed_at: '2026-08-01T12:00:00Z',
          user_agent: 'Original Browser/1.0'
        }
      }
    },
    eventId: '11111111-1111-4111-8111-111111111111',
    agentName: 'Alex Agent',
    brokerage: 'Example Realty'
  };
  const signedPdf = {
    storage_bucket: 'signed-disclosures',
    storage_path: 'write-once.pdf',
    storage_file_name: 'write-once.pdf',
    document_sha256: 'a'.repeat(64),
    source_pdf_url: disclosure.SOURCE_PDF_URL,
    agency_source_pdf_url: disclosure.AGENCY_SOURCE_PDF_URL
  };
  const event = disclosure.buildSigningEvent(
    context,
    signedPdf,
    '00000000-0000-4000-8000-000000000001',
    { requestIp: '203.0.113.12', serverUserAgent: 'Downloader/1.0', requestId: 'request' },
    'legacy_import'
  );
  assert.equal(event.request_ip, null);
  assert.equal(event.server_user_agent, null);
  assert.equal(event.request_id, null);
  assert.equal(event.client_user_agent, 'Original Browser/1.0');
  assert.equal(event.consent_text, null);
  assert.equal(event.evidence.legacy_evidence, true);
});

test('only a recent signing is eligible for server-observed request evidence', () => {
  const now = Date.parse('2026-08-17T12:10:00Z');
  const context = (signedAt) => ({
    checkin: {
      created_at: signedAt,
      metadata: {
        ny_discrimination_disclosure: {
          signed_at: signedAt,
          esign_consent: true,
          esign_consent_text: disclosure.DISCLOSURE_CONSENT_TEXT,
          esign_consent_version: disclosure.DISCLOSURE_CONSENT_VERSION
        }
      }
    }
  });
  assert.equal(disclosure.isRecentSigning(context('2026-08-17T12:00:00Z'), now), true);
  assert.equal(disclosure.isRecentSigning(context('2026-08-17T10:00:00Z'), now), false);
  const missingConsent = context('2026-08-17T12:00:00Z');
  missingConsent.checkin.metadata.ny_discrimination_disclosure.esign_consent = false;
  assert.equal(disclosure.isRecentSigning(missingConsent, now), false);
  const mismatchedText = context('2026-08-17T12:00:00Z');
  mismatchedText.checkin.metadata.ny_discrimination_disclosure.esign_consent_text = 'Different wording';
  assert.equal(disclosure.isRecentSigning(mismatchedText, now), false);
});

test('corrected packet uses a versioned path and preserves the prior packet descriptor', () => {
  const oldPacket = {
    document_type: disclosure.DISCLOSURE_PACKET_TYPE,
    packet_version: '2026-05-09-three-step-v1',
    storage_bucket: 'signed-disclosures',
    storage_path: 'agent/event/original.pdf',
    storage_file_name: 'original.pdf',
    document_sha256: 'old-sha'
  };
  const newPacket = {
    document_type: disclosure.DISCLOSURE_PACKET_TYPE,
    packet_version: disclosure.DISCLOSURE_PACKET_VERSION,
    storage_bucket: 'signed-disclosures',
    storage_path: 'agent/event/corrected-v2.pdf',
    storage_file_name: 'corrected-v2.pdf',
    document_sha256: 'new-sha'
  };
  const metadata = disclosure.buildDisclosureMetadata({
    metadata: {
      unrelated: { retained: true },
      ny_discrimination_disclosure: { acknowledged: true, signed_pdf: oldPacket }
    }
  }, newPacket);
  const updated = metadata.ny_discrimination_disclosure;

  assert.equal(metadata.unrelated.retained, true);
  assert.equal(updated.signed_pdf.storage_path, newPacket.storage_path);
  assert.equal(updated.signed_pdf.supersedes_storage_path, oldPacket.storage_path);
  assert.equal(updated.signed_pdf.legacy_packet_preserved, true);
  assert.deepEqual(updated.signed_pdf_history, [oldPacket]);
  assert.notEqual(updated.signed_pdf.storage_path, updated.signed_pdf_history[0].storage_path);

  const fileName = disclosure.buildSignedDisclosureFileName({ address: '123 Main St' }, {
    id: 'abcdef12-3456',
    visitor_name: 'Jordan Buyer',
    created_at: '2026-08-13T16:00:00Z'
  });
  assert.match(fileName, new RegExp(`${disclosure.DISCLOSURE_PACKET_VERSION}\\.pdf$`));
});

test('packet history is deduplicated when metadata is rebuilt', () => {
  const oldPacket = {
    storage_bucket: 'signed-disclosures',
    storage_path: 'agent/event/original.pdf',
    document_sha256: 'old-sha'
  };
  const checkin = {
    metadata: {
      ny_discrimination_disclosure: {
        signed_pdf: oldPacket,
        signed_pdf_history: [oldPacket]
      }
    }
  };
  const updated = disclosure.buildDisclosureMetadata(checkin, {
    storage_bucket: 'signed-disclosures',
    storage_path: 'agent/event/corrected.pdf',
    document_sha256: 'new-sha'
  });
  assert.equal(updated.ny_discrimination_disclosure.signed_pdf_history.length, 1);
});

test('date-only disclosure values do not shift backward across the New York time zone', () => {
  assert.equal(disclosure.formatFormDate('2026-08-13'), '08/13/2026');
});

test('legacy completed check-ins can use the saved visitor name when regenerating', () => {
  const context = {
    checkin: {
      visitor_name: 'Jordan Buyer',
      metadata: { ny_discrimination_disclosure: { acknowledged: true } }
    }
  };
  assert.equal(disclosure.hasCompletedDisclosure(context), true);
  assert.equal(disclosure.signedPacketOptions(context).signature, 'Jordan Buyer');
});
