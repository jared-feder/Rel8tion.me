const crypto = require('crypto');
const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ANON_KEY = process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_PUBLISHABLE_KEY || '';
const SOURCE_PDF_URL = process.env.REL8TION_NYS_DISCLOSURE_PDF_URL
  || process.env.NYS_DISCLOSURE_PDF_URL
  || 'https://nicanqrfqlbnlmnoernb.supabase.co/storage/v1/object/public/compliance/nyhousingantidisc.pdf';
const AGENCY_SOURCE_PDF_URL = process.env.REL8TION_NYS_AGENCY_DISCLOSURE_PDF_URL
  || 'https://nicanqrfqlbnlmnoernb.supabase.co/storage/v1/object/public/compliance/nysellerbuyerdisclosure.pdf';
const OFFICIAL_SOURCE_URL = 'https://dos.ny.gov/housing-and-anti-discrimination-disclosure-form';
const SIGNED_DISCLOSURE_BUCKET = process.env.SIGNED_DISCLOSURE_BUCKET || 'signed-disclosures';
const DISCLOSURE_PACKET_TYPE = 'rel8tion_open_house_disclosure_packet';
const DISCLOSURE_PACKET_VERSION = '2026-05-09-three-step-v1';
const COURTESY_NOTICE_TEXT = [
  'Rel8tion was created to make real estate interactions clearer, faster, and more transparent for everyone involved.',
  'At this open house, the listing agent may currently represent the seller. This does not mean you are alone, unwelcome, or unable to ask questions. It simply means the relationship is being disclosed clearly from the start.',
  'Rel8tion supports fair housing, equal treatment, clear communication, professional accountability, and informed decision-making.',
  'Rel8tion does not replace or modify any required agency disclosure. Rel8tion helps document and clarify the interaction, but does not create a buyer-agent, dual-agency, legal, lending, or fiduciary relationship unless separately agreed to in writing.',
  'You may choose your own real estate agent, attorney, lender, inspector, or other professional at any time.'
];

function sendJson(res, status, payload) {
  res.status(status).json(payload);
}

function sendPdf(res, filename, bytes) {
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="${filename}"`);
  res.status(200).send(Buffer.from(bytes));
}

function requireSupabaseConfig(serviceRequired = false) {
  if (!SUPABASE_URL) throw new Error('Missing SUPABASE_URL.');
  if (serviceRequired && !SERVICE_ROLE_KEY) throw new Error('Missing SUPABASE_SERVICE_ROLE_KEY.');
  if (!SERVICE_ROLE_KEY && !ANON_KEY) throw new Error('Missing Supabase API key.');
}

function apiKey(serviceRequired = false) {
  if (serviceRequired) return SERVICE_ROLE_KEY;
  return SERVICE_ROLE_KEY || ANON_KEY;
}

async function supabaseRest(path, options = {}, serviceRequired = false) {
  requireSupabaseConfig(serviceRequired);
  const key = apiKey(serviceRequired);
  const response = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...options,
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
      ...(options.headers || {})
    }
  });

  const raw = await response.text().catch(() => '');
  if (!response.ok) throw new Error(raw || `Supabase request failed: ${response.status}`);
  return raw ? JSON.parse(raw) : null;
}

function one(rows) {
  return Array.isArray(rows) && rows.length ? rows[0] : null;
}

function enc(value) {
  return encodeURIComponent(String(value || ''));
}

function cleanText(value, fallback = '') {
  return String(value ?? fallback).replace(/\s+/g, ' ').trim();
}

function safeFilenamePart(value) {
  return cleanText(value, 'document')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'document';
}

function shortToken(value, fallback = 'id') {
  return cleanText(value, fallback)
    .replace(/[^a-z0-9]/gi, '')
    .toLowerCase()
    .slice(0, 8) || fallback;
}

function todayLocalDate() {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(new Date());
}

function dateSlug(value) {
  const date = value ? new Date(value) : new Date();
  const safeDate = Number.isNaN(date.getTime()) ? new Date() : date;
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(safeDate);
}

function formatDateTime(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return cleanText(value);
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit'
  }).format(date);
}

function eventDateValue(context, checkin) {
  return firstPresent(
    context.house?.open_start,
    context.event?.start_time,
    context.event?.created_at,
    checkin?.created_at
  );
}

function buildSignedDisclosureFileName(context, checkin) {
  const date = dateSlug(eventDateValue(context, checkin));
  const address = safeFilenamePart(context.address || 'open-house');
  const buyer = safeFilenamePart(checkin.visitor_name || 'buyer');
  const checkinId = shortToken(checkin.id, 'checkin');
  return `${date}-${address}-${buyer}-${checkinId}-rel8tion-disclosure-packet.pdf`;
}

function buildSignedDisclosureStoragePath(context, checkin, fileName) {
  const agentSlug = safeFilenamePart(firstPresent(context.event?.host_agent_slug, context.agent?.slug, 'unassigned-agent'));
  const date = dateSlug(eventDateValue(context, checkin));
  const address = safeFilenamePart(context.address || 'open-house');
  const eventId = shortToken(context.eventId, 'event');
  return `${agentSlug}/${date}-${address}-${eventId}/${fileName}`;
}

function sha256Hex(bytes) {
  return crypto.createHash('sha256').update(Buffer.from(bytes)).digest('hex');
}

function firstPresent(...values) {
  return values.find((value) => value !== undefined && value !== null && String(value).trim() !== '') || '';
}

async function loadEventContext(eventId) {
  const event = one(await supabaseRest(`open_house_events?id=eq.${enc(eventId)}&select=*&limit=1`));
  if (!event) throw new Error('Open house event was not found.');

  const [house, agent] = await Promise.all([
    event.open_house_source_id
      ? supabaseRest(`open_houses?id=eq.${enc(event.open_house_source_id)}&select=*&limit=1`).then(one).catch(() => null)
      : Promise.resolve(null),
    event.host_agent_slug
      ? supabaseRest(`agents?slug=eq.${enc(event.host_agent_slug)}&select=*&limit=1`).then(one).catch(() => null)
      : Promise.resolve(null)
  ]);

  return buildContext({ event, house, agent });
}

async function loadCheckinContext(checkinId) {
  const checkin = one(await supabaseRest(`event_checkins?id=eq.${enc(checkinId)}&select=*&limit=1`, {}, true));
  if (!checkin) throw new Error('Check-in was not found.');
  const context = await loadEventContext(checkin.open_house_event_id);
  return { ...context, checkin };
}

function buildContext({ event, house, agent }) {
  const setup = event?.setup_context || {};
  return {
    event,
    house,
    agent,
    agentName: cleanText(firstPresent(agent?.name, setup.agent_name, event?.host_agent_slug, 'Host Agent')),
    brokerage: cleanText(firstPresent(agent?.brokerage, house?.brokerage, setup.detected_brokerage, setup.brokerage, '')),
    address: cleanText(firstPresent(house?.address, setup.address, 'Open house event')),
    eventId: event?.id || '',
    openHouseSourceId: event?.open_house_source_id || ''
  };
}

function wrapText(text, maxChars = 88) {
  const words = cleanText(text).split(' ').filter(Boolean);
  const lines = [];
  let line = '';
  words.forEach((word) => {
    const next = line ? `${line} ${word}` : word;
    if (next.length > maxChars && line) {
      lines.push(line);
      line = word;
    } else {
      line = next;
    }
  });
  if (line) lines.push(line);
  return lines;
}

function drawTextBlock(page, { text, x, y, size = 10, font, color = rgb(0.15, 0.2, 0.3), maxChars = 88, lineHeight = 14 }) {
  let cursor = y;
  wrapText(text, maxChars).forEach((line) => {
    page.drawText(line, { x, y: cursor, size, font, color });
    cursor -= lineHeight;
  });
  return cursor;
}

function drawField(page, { label, value, x, y, width = 500, font, boldFont }) {
  page.drawText(label.toUpperCase(), {
    x,
    y,
    size: 8,
    font: boldFont,
    color: rgb(0.35, 0.45, 0.58)
  });
  page.drawRectangle({
    x,
    y: y - 28,
    width,
    height: 22,
    borderColor: rgb(0.83, 0.88, 0.94),
    borderWidth: 1,
    color: rgb(0.97, 0.99, 1)
  });
  drawTextBlock(page, {
    text: cleanText(value, '-'),
    x: x + 8,
    y: y - 21,
    size: 10,
    font,
    color: rgb(0.06, 0.09, 0.16),
    maxChars: Math.max(28, Math.floor(width / 6))
  });
}

async function fetchSourcePdf(url = SOURCE_PDF_URL, label = 'disclosure') {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Unable to fetch ${label} source PDF: ${response.status}`);
  return new Uint8Array(await response.arrayBuffer());
}

async function appendSourcePdf(pdf, url, label) {
  const sourceBytes = await fetchSourcePdf(url, label);
  const sourcePdf = await PDFDocument.load(sourceBytes);
  const copiedPages = await pdf.copyPages(sourcePdf, sourcePdf.getPageIndices());
  copiedPages.forEach((page) => pdf.addPage(page));
}

async function buildDisclosurePdf(context, options = {}) {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const boldFont = await pdf.embedFont(StandardFonts.HelveticaBold);
  const agency = options.agency || {};
  const courtesy = options.courtesy || {};
  const agencySignedAt = firstPresent(agency.agency_disclosure_signed_at, options.agencySignedAt);
  const courtesySignedAt = firstPresent(courtesy.rel8tion_courtesy_signed_at, options.courtesySignedAt);
  const housingReviewedAt = firstPresent(options.housingReviewedAt, options.signedAt);

  const cover = pdf.addPage([612, 792]);
  cover.drawRectangle({ x: 0, y: 0, width: 612, height: 792, color: rgb(0.94, 0.98, 1) });
  cover.drawText('REL8TION', { x: 42, y: 728, size: 12, font: boldFont, color: rgb(0.03, 0.42, 0.72) });
  cover.drawText('Open House Disclosure Packet', {
    x: 42,
    y: 692,
    size: 22,
    font: boldFont,
    color: rgb(0.06, 0.09, 0.16)
  });
  cover.drawText(options.signed ? 'Signed acknowledgement packet' : 'Prefilled acknowledgement preview', {
    x: 42,
    y: 666,
    size: 12,
    font,
    color: rgb(0.28, 0.35, 0.45)
  });

  drawField(cover, { label: 'Provided by', value: context.agentName, x: 42, y: 610, width: 244, font, boldFont });
  drawField(cover, { label: 'Brokerage', value: context.brokerage || '-', x: 326, y: 610, width: 244, font, boldFont });
  drawField(cover, { label: 'Date', value: options.signedDate || todayLocalDate(), x: 42, y: 552, width: 244, font, boldFont });
  drawField(cover, { label: 'Property / Event', value: context.address, x: 42, y: 494, width: 528, font, boldFont });

  if (options.signed) {
    drawField(cover, { label: 'Consumer role', value: options.consumerRole || 'Buyer', x: 42, y: 420, width: 244, font, boldFont });
    drawField(cover, { label: 'Electronic signature', value: options.signature || '-', x: 326, y: 420, width: 244, font, boldFont });
    drawField(cover, { label: 'NYS Agency Disclosure signed', value: formatDateTime(agencySignedAt), x: 42, y: 362, width: 528, font, boldFont });
    drawField(cover, { label: 'Housing & Anti-Discrimination reviewed', value: formatDateTime(housingReviewedAt), x: 42, y: 304, width: 528, font, boldFont });
    drawField(cover, { label: 'Rel8tion Courtesy Notice signed', value: formatDateTime(courtesySignedAt), x: 42, y: 246, width: 528, font, boldFont });
    drawTextBlock(cover, {
      text: 'The consumer completed the buyer-facing REL8TION disclosure sequence: New York State Agency Disclosure, New York State Housing and Anti-Discrimination Disclosure, and Rel8tion Courtesy Notice. The check-in name is recorded as the electronic signature where applicable.',
      x: 42,
      y: 192,
      size: 10,
      font,
      maxChars: 92,
      lineHeight: 15
    });
  } else {
    drawTextBlock(cover, {
      text: 'This preview is prefilled with event context. The signed packet is generated after the buyer completes the required disclosure sequence and final acknowledgement.',
      x: 42,
      y: 420,
      size: 10,
      font,
      maxChars: 92,
      lineHeight: 15
    });
  }

  cover.drawText('Source references:', { x: 42, y: 96, size: 8, font: boldFont, color: rgb(0.28, 0.35, 0.45) });
  cover.drawText(AGENCY_SOURCE_PDF_URL, { x: 42, y: 82, size: 8, font, color: rgb(0.03, 0.42, 0.72) });
  cover.drawText(OFFICIAL_SOURCE_URL, { x: 42, y: 69, size: 8, font, color: rgb(0.03, 0.42, 0.72) });
  cover.drawText('Source form pages follow this REL8TION acknowledgement cover and courtesy notice page.', {
    x: 42,
    y: 50,
    size: 8,
    font,
    color: rgb(0.35, 0.45, 0.58)
  });

  const courtesyPage = pdf.addPage([612, 792]);
  courtesyPage.drawRectangle({ x: 0, y: 0, width: 612, height: 792, color: rgb(0.98, 1, 0.98) });
  courtesyPage.drawText('REL8TION', { x: 42, y: 728, size: 12, font: boldFont, color: rgb(0.03, 0.42, 0.72) });
  courtesyPage.drawText('Rel8tion Courtesy Notice', { x: 42, y: 692, size: 22, font: boldFont, color: rgb(0.06, 0.09, 0.16) });
  if (options.signed) {
    drawField(courtesyPage, { label: 'Electronic signature', value: options.signature || '-', x: 42, y: 636, width: 244, font, boldFont });
    drawField(courtesyPage, { label: 'Signed at', value: formatDateTime(courtesySignedAt), x: 326, y: 636, width: 244, font, boldFont });
  }
  let courtesyY = 560;
  COURTESY_NOTICE_TEXT.forEach((paragraph) => {
    courtesyY = drawTextBlock(courtesyPage, {
      text: paragraph,
      x: 42,
      y: courtesyY,
      size: 11,
      font,
      color: rgb(0.12, 0.18, 0.28),
      maxChars: 88,
      lineHeight: 16
    }) - 18;
  });

  try {
    await appendSourcePdf(pdf, AGENCY_SOURCE_PDF_URL, 'agency disclosure');
  } catch (error) {
    console.log('[ny-disclosure] agency source append skipped', error.message || error);
  }
  await appendSourcePdf(pdf, SOURCE_PDF_URL, 'housing and anti-discrimination disclosure');
  return pdf.save();
}

function storageObjectUrl(bucket, path) {
  const encodedPath = path.split('/').map(encodeURIComponent).join('/');
  return `${SUPABASE_URL}/storage/v1/object/${encodeURIComponent(bucket)}/${encodedPath}`;
}

async function uploadSignedPdf(path, bytes) {
  requireSupabaseConfig(true);
  const response = await fetch(storageObjectUrl(SIGNED_DISCLOSURE_BUCKET, path), {
    method: 'POST',
    headers: {
      apikey: SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/pdf',
      'x-upsert': 'true'
    },
    body: Buffer.from(bytes)
  });
  const raw = await response.text().catch(() => '');
  if (!response.ok) throw new Error(raw || `Signed disclosure upload failed: ${response.status}`);
}

async function downloadStoredPdf(bucket, path) {
  requireSupabaseConfig(true);
  const response = await fetch(storageObjectUrl(bucket, path), {
    headers: {
      apikey: SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SERVICE_ROLE_KEY}`
    }
  });
  if (!response.ok) throw new Error(`Signed disclosure download failed: ${response.status}`);
  return new Uint8Array(await response.arrayBuffer());
}

async function patchCheckinMetadata(checkin, signedPdf) {
  const metadata = checkin.metadata || {};
  const disclosure = metadata.ny_discrimination_disclosure || {};
  const updatedMetadata = {
    ...metadata,
    ny_discrimination_disclosure: {
      ...disclosure,
      signed_pdf: signedPdf
    }
  };
  const rows = await supabaseRest(`event_checkins?id=eq.${enc(checkin.id)}`, {
    method: 'PATCH',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ metadata: updatedMetadata })
  }, true);
  return one(rows) || { ...checkin, metadata: updatedMetadata };
}

async function handlePreview(req, res) {
  const eventId = cleanText(req.query.event);
  if (!eventId) return sendJson(res, 400, { ok: false, error: 'Missing event.' });
  const context = await loadEventContext(eventId);
  const bytes = await buildDisclosurePdf(context, { signed: false });
  return sendPdf(res, `rel8tion-disclosure-packet-${safeFilenamePart(context.address)}.pdf`, bytes);
}

async function handleDownloadSigned(req, res) {
  const checkinId = cleanText(req.query.checkin);
  if (!checkinId) return sendJson(res, 400, { ok: false, error: 'Missing checkin.' });
  const context = await loadCheckinContext(checkinId);
  const metadata = context.checkin.metadata || {};
  const disclosure = metadata.ny_discrimination_disclosure || {};
  const agency = metadata.nys_agency_disclosure || {};
  const courtesy = metadata.rel8tion_courtesy_notice || {};
  const signedPdf = disclosure.signed_pdf || {};

  let bytes;
  if (signedPdf.storage_bucket && signedPdf.storage_path && signedPdf.document_type === DISCLOSURE_PACKET_TYPE) {
    bytes = await downloadStoredPdf(signedPdf.storage_bucket, signedPdf.storage_path);
  } else {
    bytes = await buildDisclosurePdf(context, {
      signed: true,
      signature: disclosure.e_signature_value || context.checkin.visitor_name,
      signedAt: disclosure.signed_at || context.checkin.created_at,
      signedDate: disclosure.signed_date,
      consumerRole: disclosure.consumer_role || context.checkin.visitor_type || 'Buyer',
      housingReviewedAt: disclosure.reviewed_at || disclosure.signed_at || context.checkin.created_at,
      agency,
      courtesy
    });
  }

  const filename = signedPdf.storage_file_name || buildSignedDisclosureFileName(context, context.checkin);
  return sendPdf(res, filename, bytes);
}

async function handleGenerateSigned(req, res) {
  const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
  const checkinId = cleanText(body.checkin_id || body.checkinId);
  if (!checkinId) return sendJson(res, 400, { ok: false, error: 'Missing checkin_id.' });

  const context = await loadCheckinContext(checkinId);
  const checkin = context.checkin;
  const metadata = checkin.metadata || {};
  const disclosure = metadata.ny_discrimination_disclosure || {};
  const agency = metadata.nys_agency_disclosure || {};
  const courtesy = metadata.rel8tion_courtesy_notice || {};
  if (disclosure.acknowledged !== true || !disclosure.e_signature_value) {
    return sendJson(res, 400, { ok: false, error: 'Check-in does not contain a completed NYS disclosure acknowledgement.' });
  }

  const bytes = await buildDisclosurePdf(context, {
    signed: true,
    signature: disclosure.e_signature_value || checkin.visitor_name,
    signedAt: disclosure.signed_at || checkin.created_at,
    signedDate: disclosure.signed_date,
    consumerRole: disclosure.consumer_role || checkin.visitor_type || 'Buyer',
    housingReviewedAt: disclosure.reviewed_at || disclosure.signed_at || checkin.created_at,
    agency,
    courtesy
  });

  const generatedAt = new Date().toISOString();
  const fileName = buildSignedDisclosureFileName(context, checkin);
  const path = buildSignedDisclosureStoragePath(context, checkin, fileName);
  const documentSha256 = sha256Hex(bytes);
  await uploadSignedPdf(path, bytes);
  const signedPdf = {
    generated: true,
    document_type: DISCLOSURE_PACKET_TYPE,
    packet_version: DISCLOSURE_PACKET_VERSION,
    packet_includes: [
      'nys_agency_disclosure',
      'ny_housing_anti_discrimination_disclosure',
      'rel8tion_courtesy_notice'
    ],
    storage_bucket: SIGNED_DISCLOSURE_BUCKET,
    storage_path: path,
    storage_file_name: fileName,
    download_url: `/api/compliance/ny-disclosure?checkin=${encodeURIComponent(checkin.id)}&download=1`,
    generated_at: generatedAt,
    document_sha256: documentSha256,
    event_id: context.eventId || '',
    checkin_id: checkin.id,
    open_house_source_id: context.openHouseSourceId || '',
    host_agent_slug: context.event?.host_agent_slug || '',
    property_address: context.address || '',
    buyer_name: checkin.visitor_name || '',
    source_pdf_url: SOURCE_PDF_URL,
    agency_source_pdf_url: AGENCY_SOURCE_PDF_URL,
    official_source_url: OFFICIAL_SOURCE_URL
  };
  const updatedCheckin = await patchCheckinMetadata(checkin, signedPdf);

  return sendJson(res, 200, {
    ok: true,
    signed_pdf: signedPdf,
    checkin: updatedCheckin
  });
}

module.exports = async function handler(req, res) {
  try {
    if (req.method === 'GET') {
      if (req.query.checkin) return handleDownloadSigned(req, res);
      return handlePreview(req, res);
    }
    if (req.method === 'POST') return handleGenerateSigned(req, res);
    res.setHeader('Allow', 'GET, POST');
    return sendJson(res, 405, { ok: false, error: 'Method not allowed.' });
  } catch (error) {
    console.error('[ny-disclosure] failed', error);
    return sendJson(res, 500, { ok: false, error: error.message || 'Unable to generate NYS disclosure PDF.' });
  }
};
