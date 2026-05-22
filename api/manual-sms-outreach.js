const { adminAuthorized, assertAdminConfig, sendJson, supabaseRest } = require('../lib/admin-auth');

const FALLBACK_PLACEHOLDER =
  'https://rel8tion.me/wp-content/uploads/2026/04/logo150x100trans.png';

const FULL_SELECT = [
  'id',
  'open_house_id',
  'agent_first_name',
  'agent_name',
  'agent_phone',
  'agent_phone_normalized',
  'agent_email',
  'brokerage',
  'address',
  'city',
  'state',
  'zip',
  'price',
  'beds',
  'baths',
  'open_start',
  'open_end',
  'template_key',
  'listing_photo_url',
  'agent_photo_url',
  'mockup_image_url',
  'selected_sms',
  'sms_variant_1',
  'sms_variant_2',
  'sms_variant_3',
  'review_status',
  'send_status',
  'initial_send_status',
  'initial_send_at',
  'initial_sent_at',
  'initial_delivery_status',
  'initial_delivery_error_code',
  'initial_delivery_error_message',
  'last_delivery_status',
  'last_delivery_error_code',
  'last_delivery_error_message',
  'followup_send_status',
  'generation_status',
  'mockup_status',
  'approved_for_send',
  'send_mode',
  'send_error',
  'initial_block_reason',
  'manual_sms_sent',
  'manual_sms_skipped',
  'manual_sms_sent_at',
  'last_outreach_at',
  'channel',
  'sent_at',
  'skipped_at',
  'created_at',
  'updated_at'
];

const BASE_SELECT = FULL_SELECT.filter((column) => ![
  'manual_sms_sent',
  'manual_sms_skipped',
  'manual_sms_sent_at',
  'channel'
].includes(column));

function clean(value) {
  return String(value ?? '').trim();
}

function enc(value) {
  return encodeURIComponent(clean(value));
}

function parseBody(req) {
  if (!req.body) return {};
  if (typeof req.body === 'object') return req.body;
  try {
    return JSON.parse(req.body);
  } catch {
    return {};
  }
}

function one(rows) {
  return Array.isArray(rows) ? rows[0] || null : null;
}

function phoneDigits(value) {
  const digits = clean(value).replace(/\D/g, '');
  return digits.length === 11 && digits.startsWith('1') ? digits.slice(1) : digits;
}

function firstPresent(...values) {
  for (const value of values) {
    if (value !== undefined && value !== null && clean(value) !== '') return value;
  }
  return '';
}

function compactAddress(row) {
  return [
    row.address,
    [row.city, row.state].filter(Boolean).join(', '),
    row.zip
  ].filter(Boolean).join(' ');
}

function fallbackMessage(row) {
  const address = compactAddress(row) || row.address || 'your open house';
  return `Jared with Rel8tion here - I saw your open house at ${address}. I'm offering a free open-house Event Pass setup: paperless check-in, disclosures, and event recap. Want me to send the setup link?`;
}

function messageFor(row) {
  const message = firstPresent(row.selected_sms, row.sms_variant_1, row.sms_variant_2, row.sms_variant_3);
  if (message) {
    const source =
      row.selected_sms ? 'selected_sms' :
      row.sms_variant_1 ? 'sms_variant_1' :
      row.sms_variant_2 ? 'sms_variant_2' :
      'sms_variant_3';
    return { message, source };
  }
  return { message: fallbackMessage(row), source: 'fallback' };
}

function imageFor(row) {
  const listingUrl = firstPresent(row.listing_photo_url, row.image_url, row.property_image, row.image);
  const url = firstPresent(listingUrl, row.mockup_image_url);
  return {
    image_url: url || FALLBACK_PLACEHOLDER,
    listing_image_url: listingUrl || '',
    has_listing_image: Boolean(listingUrl),
    image_source: row.listing_photo_url ? 'listing_photo_url' :
      row.image_url ? 'image_url' :
      row.property_image ? 'property_image' :
      row.image ? 'image' :
      row.mockup_image_url ? 'mockup_image_url' :
      'rel8tion_placeholder'
  };
}

function hasListingImage(row) {
  return Boolean(firstPresent(row.listing_photo_url, row.image_url, row.property_image, row.image));
}

function normalizedStatus(value) {
  return clean(value).toLowerCase();
}

function isOptedOut(row) {
  const statuses = [
    row.review_status,
    row.send_status,
    row.initial_send_status,
    row.initial_block_reason,
    row.send_error,
    row.initial_delivery_error_message,
    row.last_delivery_error_message
  ].map(normalizedStatus).join(' ');

  return [
    row.opted_out,
    row.sms_opt_out,
    row.opt_out,
    row.stop,
    row.unsubscribed,
    row.do_not_contact,
    row.latest_reply_opt_out,
    row.any_opt_out
  ].some(Boolean) ||
    statuses.includes('opted_out') ||
    statuses.includes('opted out') ||
    statuses.includes('unsubscribe') ||
    statuses.includes('21610') ||
    statuses.includes('stop');
}

function isDeliveryFailure(row) {
  const status = normalizedStatus(firstPresent(row.initial_delivery_status, row.last_delivery_status));
  return ['failed', 'undelivered', 'canceled', 'cancelled'].includes(status);
}

function isAlreadyHandled(row) {
  if (row.manual_sms_sent === true || row.manual_sms_skipped === true) return true;

  const sendStatus = normalizedStatus(row.send_status);
  if (['manual_text_sent', 'manual_sms_sent', 'manual_sms_skipped', 'twilio_sent', 'delivered'].includes(sendStatus)) return true;

  const initial = normalizedStatus(row.initial_send_status);
  if (['manual_text_sent', 'manual_sms_skipped', 'blocked_opted_out', 'blocked_invalid_mobile', 'blocked_duplicate', 'skipped_expired', 'skipped_started'].includes(initial)) return true;

  if (initial === 'sent' && !isDeliveryFailure(row)) return true;
  return false;
}

function isDue(row, now) {
  if (isDeliveryFailure(row)) return true;
  if (normalizedStatus(row.initial_send_status) === 'pending') return true;
  if (!row.initial_send_at) return true;
  const due = new Date(row.initial_send_at);
  return Number.isFinite(due.getTime()) && due <= now;
}

function isExpired(row, now) {
  if (row.template_key === 'missed_open_house') return false;
  if (!row.open_end) return false;
  const end = new Date(row.open_end);
  return Number.isFinite(end.getTime()) && end <= now;
}

function isReady(row, now) {
  if (!phoneDigits(row.agent_phone_normalized || row.agent_phone)) return false;
  if (isOptedOut(row)) return false;
  if (isAlreadyHandled(row)) return false;
  if (isExpired(row, now)) return false;
  if (!isDue(row, now)) return false;
  if (!hasListingImage(row)) return false;
  const { message } = messageFor(row);
  return Boolean(message);
}

function sortCandidates(rows, now) {
  return [...rows].sort((a, b) => {
    const aStart = new Date(a.open_start || 0);
    const bStart = new Date(b.open_start || 0);
    const aFuture = Number.isFinite(aStart.getTime()) && aStart >= now ? 0 : 1;
    const bFuture = Number.isFinite(bStart.getTime()) && bStart >= now ? 0 : 1;
    if (aFuture !== bFuture) return aFuture - bFuture;
    const aTime = Number.isFinite(aStart.getTime()) ? aStart.getTime() : Number.MAX_SAFE_INTEGER;
    const bTime = Number.isFinite(bStart.getTime()) ? bStart.getTime() : Number.MAX_SAFE_INTEGER;
    if (aTime !== bTime) return aTime - bTime;
    return new Date(a.created_at || 0) - new Date(b.created_at || 0);
  });
}

function presentRow(row) {
  if (!row) return null;
  const msg = messageFor(row);
  const img = imageFor(row);
  return {
    ...row,
    property_address: compactAddress(row) || row.address || '',
    phone_normalized: phoneDigits(row.agent_phone_normalized || row.agent_phone),
    outreach_message: msg.message,
    message_source: msg.source,
    ...img,
    is_delivery_failure: isDeliveryFailure(row)
  };
}

async function fetchQueueRows(path) {
  const rows = await supabaseRest(path);
  return Array.isArray(rows) ? rows : [];
}

async function loadQueueRows(selectColumns, mode = 'future') {
  const nowIso = new Date().toISOString();
  const select = selectColumns.join(',');
  if (mode === 'all') {
    return fetchQueueRows(`agent_outreach_queue?select=${select}&order=created_at.desc&limit=1000`);
  }
  return fetchQueueRows(`agent_outreach_queue?open_end=gt.${enc(nowIso)}&select=${select}&order=open_start.asc.nullslast&limit=500`);
}

function readyCandidates(rows) {
  const now = new Date();
  return sortCandidates((rows || []).filter((row) => isReady(row, now)), now);
}

async function loadNext() {
  let rows;
  let warnings = [];
  try {
    rows = await loadQueueRows(FULL_SELECT);
  } catch (error) {
    warnings.push(`Optional manual backup columns are not all present: ${error.message || error}`);
    rows = await loadQueueRows(BASE_SELECT);
  }

  let candidates = readyCandidates(rows);
  if (!candidates.length) {
    try {
      candidates = readyCandidates(await loadQueueRows(FULL_SELECT, 'all'));
    } catch (_) {
      candidates = readyCandidates(await loadQueueRows(BASE_SELECT, 'all'));
    }
  }

  return {
    row: presentRow(candidates[0] || null),
    remaining_estimate: candidates.length,
    loaded_at: new Date().toISOString(),
    warnings
  };
}

async function loadQueueRow(id) {
  const row = one(await supabaseRest(`agent_outreach_queue?id=eq.${enc(id)}&select=*&limit=1`));
  if (!row) {
    const error = new Error('Outreach queue row not found.');
    error.status = 404;
    throw error;
  }
  return row;
}

function putIfColumn(row, payload, key, value) {
  if (Object.prototype.hasOwnProperty.call(row, key)) payload[key] = value;
}

function baseManualPatch(row, action, now) {
  const payload = {};

  if (action === 'mark_sent') {
    putIfColumn(row, payload, 'send_status', 'manual_text_sent');
    putIfColumn(row, payload, 'manual_sms_sent', true);
    putIfColumn(row, payload, 'sent_at', now);
    putIfColumn(row, payload, 'last_outreach_at', now);
    putIfColumn(row, payload, 'channel', 'manual_cell_sms');
    putIfColumn(row, payload, 'manual_sms_sent_at', now);
    putIfColumn(row, payload, 'initial_send_status', 'manual_text_sent');
    putIfColumn(row, payload, 'initial_sent_at', now);
    putIfColumn(row, payload, 'send_mode', 'manual_cell_sms');
    putIfColumn(row, payload, 'send_error', null);
    putIfColumn(row, payload, 'initial_block_reason', null);
    return payload;
  }

  putIfColumn(row, payload, 'send_status', 'manual_sms_skipped');
  putIfColumn(row, payload, 'manual_sms_skipped', true);
  putIfColumn(row, payload, 'skipped', true);
  putIfColumn(row, payload, 'skipped_at', now);
  putIfColumn(row, payload, 'initial_send_status', 'manual_sms_skipped');
  putIfColumn(row, payload, 'initial_block_reason', 'manual_backup_skipped');
  putIfColumn(row, payload, 'send_error', null);
  return payload;
}

async function patchQueue(row, payload) {
  if (!Object.keys(payload).length) return row;
  const updated = one(await supabaseRest(`agent_outreach_queue?id=eq.${enc(row.id)}`, {
    method: 'PATCH',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify(payload)
  }));
  return updated || { ...row, ...payload };
}

module.exports = async function handler(req, res) {
  try {
    assertAdminConfig();
    const auth = adminAuthorized(req);
    if (!auth.ok) {
      sendJson(res, 401, { ok: false, error: auth.error });
      return;
    }

    if (req.method === 'GET') {
      sendJson(res, 200, { ok: true, ...(await loadNext()) });
      return;
    }

    if (req.method !== 'POST') {
      res.setHeader('Allow', 'GET, POST');
      sendJson(res, 405, { ok: false, error: 'Method not allowed.' });
      return;
    }

    const body = parseBody(req);
    const action = clean(body.action);
    const id = clean(body.id || body.queue_row_id);
    if (!id) {
      sendJson(res, 400, { ok: false, error: 'Missing outreach queue row id.' });
      return;
    }
    if (!['mark_sent', 'skip'].includes(action)) {
      sendJson(res, 400, { ok: false, error: 'Unsupported manual outreach action.' });
      return;
    }

    const row = await loadQueueRow(id);
    if (isOptedOut(row)) {
      sendJson(res, 409, { ok: false, error: 'This contact appears opted out. Manual SMS is blocked.' });
      return;
    }

    const now = new Date().toISOString();
    const updated = await patchQueue(row, baseManualPatch(row, action, now));
    sendJson(res, 200, {
      ok: true,
      action,
      row: presentRow(updated),
      next: await loadNext()
    });
  } catch (error) {
    sendJson(res, error.status || 500, {
      ok: false,
      error: error.message || 'Unable to update manual SMS outreach.',
      details: error.payload || null
    });
  }
};
