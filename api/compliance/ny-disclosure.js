const crypto = require('crypto');
const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ANON_KEY = process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_PUBLISHABLE_KEY || '';
const SOURCE_PDF_URL = process.env.REL8TION_NYS_DISCLOSURE_PDF_URL
  || process.env.NYS_DISCLOSURE_PDF_URL
  || 'https://dos.ny.gov/housinganti-discrimination-form';
const AGENCY_SOURCE_PDF_URL = process.env.REL8TION_NYS_AGENCY_DISCLOSURE_PDF_URL
  || 'https://dos.ny.gov/buyer-and-seller-disclosure-form-english';
const OFFICIAL_SOURCE_URL = 'https://dos.ny.gov/housing-and-anti-discrimination-disclosure-form';
const SIGNED_DISCLOSURE_BUCKET = process.env.SIGNED_DISCLOSURE_BUCKET || 'signed-disclosures';
const DISCLOSURE_PACKET_TYPE = 'rel8tion_open_house_disclosure_packet';
const DISCLOSURE_PACKET_VERSION = '2026-08-13-official-forms-v2';
const SOURCE_FETCH_TIMEOUT_MS = 10000;
const SOURCE_REQUEST_HEADERS = Object.freeze({
  Accept: 'application/pdf,*/*',
  'User-Agent': 'REL8TION/1.0 (+https://rel8tion.me)'
});
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

function buildSignedDisclosureFileName(context, checkin, packetVersion = DISCLOSURE_PACKET_VERSION) {
  const date = dateSlug(eventDateValue(context, checkin));
  const address = safeFilenamePart(context.address || 'open-house');
  const buyer = safeFilenamePart(checkin.visitor_name || 'buyer');
  const checkinId = shortToken(checkin.id, 'checkin');
  const version = safeFilenamePart(packetVersion);
  return `${date}-${address}-${buyer}-${checkinId}-rel8tion-disclosure-packet-${version}.pdf`;
}

function formatFormDate(value) {
  if (!value) return todayLocalDate();
  const dateOnly = cleanText(value).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (dateOnly) return `${dateOnly[2]}/${dateOnly[3]}/${dateOnly[1]}`;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return cleanText(value);
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(date);
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
  let lastError;
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), SOURCE_FETCH_TIMEOUT_MS);
    try {
      const response = await fetch(url, {
        headers: SOURCE_REQUEST_HEADERS,
        signal: controller.signal
      });
      if (!response.ok) {
        lastError = new Error(`Unable to fetch ${label} source PDF: ${response.status}`);
        if (response.status < 500 && response.status !== 429) break;
        continue;
      }

      const bytes = new Uint8Array(await response.arrayBuffer());
      const contentType = cleanText(response.headers?.get?.('content-type')).toLowerCase();
      const hasPdfHeader = bytes.length >= 5
        && Buffer.from(bytes.subarray(0, 5)).toString('ascii') === '%PDF-';
      if (!contentType.includes('application/pdf') && !hasPdfHeader) {
        throw new Error(`Unable to fetch ${label} source PDF: received ${contentType || 'unknown content type'}.`);
      }
      if (!hasPdfHeader) throw new Error(`Unable to fetch ${label} source PDF: invalid PDF content.`);
      return bytes;
    } catch (error) {
      lastError = error?.name === 'AbortError'
        ? new Error(`Timed out fetching ${label} source PDF.`)
        : error;
    } finally {
      clearTimeout(timeout);
    }
  }
  throw lastError || new Error(`Unable to fetch ${label} source PDF.`);
}

async function appendSourcePdf(pdf, url, label) {
  const sourceBytes = await fetchSourcePdf(url, label);
  const sourcePdf = await PDFDocument.load(sourceBytes);
  const copiedPages = await pdf.copyPages(sourcePdf, sourcePdf.getPageIndices());
  copiedPages.forEach((page) => pdf.addPage(page));
  return copiedPages;
}

function fittedFontSize(font, text, maxWidth, preferredSize = 10, minimumSize = 6.5) {
  let size = preferredSize;
  while (size > minimumSize && font.widthOfTextAtSize(text, size) > maxWidth) size -= 0.25;
  return size;
}

function drawLineValue(page, { value, x, y, maxWidth, font, preferredSize = 10, color = rgb(0.02, 0.06, 0.12) }) {
  const text = cleanText(value);
  if (!text) return;
  page.drawText(text, {
    x,
    y,
    size: fittedFontSize(font, text, maxWidth, preferredSize),
    font,
    color
  });
}

function decorateAgencyDisclosure(page, context, options, fonts) {
  const signature = cleanText(options.signature);
  const signedDate = formatFormDate(firstPresent(options.signedAt, options.signedDate));

  drawLineValue(page, { value: context.agentName, x: 154, y: 619, maxWidth: 198, font: fonts.regular, preferredSize: 9 });
  drawLineValue(page, { value: context.brokerage, x: 371, y: 619, maxWidth: 217, font: fonts.regular, preferredSize: 9 });
  drawLineValue(page, { value: signature, x: 53, y: 298, maxWidth: 258, font: fonts.regular, preferredSize: 10 });
  drawLineValue(page, { value: signature, x: 24, y: 233, maxWidth: 257, font: fonts.signature, preferredSize: 12 });
  drawLineValue(page, { value: signedDate, x: 44, y: 143, maxWidth: 236, font: fonts.regular, preferredSize: 10 });

  page.drawText('X', { x: 76, y: 554, size: 9, font: fonts.bold, color: rgb(0.02, 0.06, 0.12) });
  page.drawText('X', { x: 101, y: 533, size: 9, font: fonts.bold, color: rgb(0.02, 0.06, 0.12) });
  page.drawText('X', { x: 80, y: 252, size: 9, font: fonts.bold, color: rgb(0.02, 0.06, 0.12) });
}

function decorateHousingDisclosure(page, context, options, fonts) {
  const signature = cleanText(options.signature);
  const signedDate = formatFormDate(firstPresent(options.signedAt, options.signedDate));

  drawLineValue(page, { value: context.agentName, x: 198, y: 552, maxWidth: 180, font: fonts.regular, preferredSize: 10 });
  drawLineValue(page, { value: context.brokerage, x: 77, y: 522, maxWidth: 218, font: fonts.regular, preferredSize: 10 });
  drawLineValue(page, { value: signature, x: 59, y: 477, maxWidth: 520, font: fonts.regular, preferredSize: 10 });
  drawLineValue(page, { value: signature, x: 214, y: 402, maxWidth: 257, font: fonts.signature, preferredSize: 12 });
  drawLineValue(page, { value: signedDate, x: 520, y: 402, maxWidth: 69, font: fonts.regular, preferredSize: 9 });
}

async function appendOfficialForm(pdf, { url, label, signed, decorate, context, options, fonts }) {
  const pages = await appendSourcePdf(pdf, url, label);
  if (signed && pages.length) decorate(pages[pages.length - 1], context, options, fonts);
}

async function buildDisclosurePdf(context, options = {}) {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const boldFont = await pdf.embedFont(StandardFonts.HelveticaBold);
  const signatureFont = await pdf.embedFont(StandardFonts.HelveticaOblique);
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

  const fonts = { regular: font, bold: boldFont, signature: signatureFont };
  await appendOfficialForm(pdf, {
    url: AGENCY_SOURCE_PDF_URL,
    label: 'agency disclosure',
    signed: options.signed,
    decorate: decorateAgencyDisclosure,
    context,
    options,
    fonts
  });
  await appendOfficialForm(pdf, {
    url: SOURCE_PDF_URL,
    label: 'housing and anti-discrimination disclosure',
    signed: options.signed,
    decorate: decorateHousingDisclosure,
    context,
    options,
    fonts
  });
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

function packetIdentity(packet) {
  return [packet?.storage_bucket, packet?.storage_path, packet?.document_sha256]
    .filter(Boolean)
    .join('|');
}

function buildDisclosureMetadata(checkin, signedPdf) {
  const metadata = checkin.metadata || {};
  const disclosure = metadata.ny_discrimination_disclosure || {};
  const previousPacket = disclosure.signed_pdf;
  const history = Array.isArray(disclosure.signed_pdf_history)
    ? disclosure.signed_pdf_history.filter(Boolean)
    : [];
  const previousIdentity = packetIdentity(previousPacket);
  const newIdentity = packetIdentity(signedPdf);
  if (previousIdentity && previousIdentity !== newIdentity
      && !history.some((packet) => packetIdentity(packet) === previousIdentity)) {
    history.push(previousPacket);
  }

  const supersession = previousIdentity && previousIdentity !== newIdentity
    ? {
        supersedes_packet_version: previousPacket.packet_version || '',
        supersedes_storage_path: previousPacket.storage_path || '',
        supersedes_document_sha256: previousPacket.document_sha256 || '',
        legacy_packet_preserved: true
      }
    : {};

  return {
    ...metadata,
    ny_discrimination_disclosure: {
      ...disclosure,
      signed_pdf: { ...signedPdf, ...supersession },
      ...(history.length ? { signed_pdf_history: history } : {})
    }
  };
}

async function patchCheckinMetadata(checkin, signedPdf) {
  const updatedMetadata = buildDisclosureMetadata(checkin, signedPdf);
  const rows = await supabaseRest(`event_checkins?id=eq.${enc(checkin.id)}`, {
    method: 'PATCH',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ metadata: updatedMetadata })
  }, true);
  return one(rows) || { ...checkin, metadata: updatedMetadata };
}

function signedPacketOptions(context) {
  const metadata = context.checkin.metadata || {};
  const disclosure = metadata.ny_discrimination_disclosure || {};
  return {
    signed: true,
    signature: disclosure.e_signature_value || context.checkin.visitor_name,
    signedAt: disclosure.signed_at || context.checkin.created_at,
    signedDate: disclosure.signed_date,
    consumerRole: disclosure.consumer_role || context.checkin.visitor_type || 'Buyer',
    housingReviewedAt: disclosure.reviewed_at || disclosure.signed_at || context.checkin.created_at,
    agency: metadata.nys_agency_disclosure || {},
    courtesy: metadata.rel8tion_courtesy_notice || {}
  };
}

function hasCompletedDisclosure(context) {
  const disclosure = context.checkin.metadata?.ny_discrimination_disclosure || {};
  return disclosure.acknowledged === true && Boolean(disclosure.e_signature_value || context.checkin.visitor_name);
}

function isCurrentStoredPacket(signedPdf) {
  return Boolean(signedPdf?.storage_bucket
    && signedPdf?.storage_path
    && signedPdf?.document_type === DISCLOSURE_PACKET_TYPE
    && signedPdf?.packet_version === DISCLOSURE_PACKET_VERSION);
}

async function generateAndStoreSignedPacket(context) {
  const checkin = context.checkin;
  const bytes = await buildDisclosurePdf(context, signedPacketOptions(context));
  const generatedAt = new Date().toISOString();
  const fileName = buildSignedDisclosureFileName(context, checkin);
  const path = buildSignedDisclosureStoragePath(context, checkin, fileName);
  const signedPdf = {
    generated: true,
    document_type: DISCLOSURE_PACKET_TYPE,
    packet_version: DISCLOSURE_PACKET_VERSION,
    packet_includes: [
      'nys_agency_disclosure',
      'ny_housing_anti_discrimination_disclosure',
      'rel8tion_courtesy_notice'
    ],
    official_forms_completed: true,
    storage_bucket: SIGNED_DISCLOSURE_BUCKET,
    storage_path: path,
    storage_file_name: fileName,
    download_url: `/api/compliance/ny-disclosure?checkin=${encodeURIComponent(checkin.id)}&download=1`,
    generated_at: generatedAt,
    document_sha256: sha256Hex(bytes),
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
  await uploadSignedPdf(path, bytes);
  const updatedCheckin = await patchCheckinMetadata(checkin, signedPdf);
  return { bytes, signedPdf, updatedCheckin };
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
  const signedPdf = disclosure.signed_pdf || {};

  let bytes;
  let filename;
  if (isCurrentStoredPacket(signedPdf)) {
    bytes = await downloadStoredPdf(signedPdf.storage_bucket, signedPdf.storage_path);
    filename = signedPdf.storage_file_name;
  } else {
    if (!hasCompletedDisclosure(context)) {
      return sendJson(res, 400, { ok: false, error: 'Check-in does not contain a completed NYS disclosure acknowledgement.' });
    }
    const regenerated = await generateAndStoreSignedPacket(context);
    bytes = regenerated.bytes;
    filename = regenerated.signedPdf.storage_file_name;
  }

  filename ||= buildSignedDisclosureFileName(context, context.checkin);
  return sendPdf(res, filename, bytes);
}

async function handleGenerateSigned(req, res) {
  const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
  const checkinId = cleanText(body.checkin_id || body.checkinId);
  if (!checkinId) return sendJson(res, 400, { ok: false, error: 'Missing checkin_id.' });

  const context = await loadCheckinContext(checkinId);
  const checkin = context.checkin;
  if (!hasCompletedDisclosure(context)) {
    return sendJson(res, 400, { ok: false, error: 'Check-in does not contain a completed NYS disclosure acknowledgement.' });
  }

  const generated = await generateAndStoreSignedPacket(context);

  return sendJson(res, 200, {
    ok: true,
    signed_pdf: generated.signedPdf,
    checkin: generated.updatedCheckin
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

module.exports.__test = {
  AGENCY_SOURCE_PDF_URL,
  DISCLOSURE_PACKET_TYPE,
  DISCLOSURE_PACKET_VERSION,
  SOURCE_PDF_URL,
  SOURCE_REQUEST_HEADERS,
  buildDisclosureMetadata,
  buildDisclosurePdf,
  buildSignedDisclosureFileName,
  fetchSourcePdf,
  formatFormDate,
  hasCompletedDisclosure,
  isCurrentStoredPacket,
  signedPacketOptions
};
