const { sendJson, supabaseRest } = require('../lib/admin-auth');
const { receiptSecret, setReceiptCookie, readReceipt, assertSameOrigin } = require('../lib/disclosure-access');

const VISITOR_TYPES = new Set(['buyer', 'buyer_with_agent', 'buyer_agent']);

function clean(value, max = 500) { return String(value || '').trim().slice(0, max); }
function enc(value) { return encodeURIComponent(clean(value)); }
function one(rows) { return Array.isArray(rows) ? rows[0] || null : null; }
function parseBody(req) {
  if (!req.body) return {};
  if (typeof req.body === 'object') return req.body;
  try { return JSON.parse(req.body); } catch (_) { return {}; }
}
function object(value) { return value && typeof value === 'object' && !Array.isArray(value) ? value : {}; }
function stripArchivePointers(value, depth = 0) {
  if (depth > 10) throw Object.assign(new Error('Check-in metadata is too deeply nested.'), { status: 400 });
  if (!value || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(v => stripArchivePointers(v, depth + 1));
  return Object.fromEntries(Object.entries(value).filter(([key]) => !['signed_pdf', 'signed_pdf_history', '__proto__', 'constructor', 'prototype'].includes(key)).map(([key, v]) => [key, stripArchivePointers(v, depth + 1)]));
}
const LISTING_FIELDS = new Set(['listing_url', 'listing_short_url', 'listing_direct_url', 'listing_sms_url', 'listing_sms_label', 'listing_external_available', 'listing_external_status', 'listing_external_reason', 'listing_link_checked_at']);

function normalizeCheckin(input) {
  const eventId = clean(input.open_house_event_id, 100);
  const visitorType = clean(input.visitor_type, 60);
  if (!eventId || !VISITOR_TYPES.has(visitorType)) {
    const error = new Error('Missing or invalid open-house check-in context.');
    error.status = 400;
    throw error;
  }
  const visitorName = clean(input.visitor_name, 240);
  const visitorPhone = clean(input.visitor_phone, 80);
  if (!visitorName || !visitorPhone) {
    const error = new Error('Name and phone are required to check in.');
    error.status = 400;
    throw error;
  }
  return {
    open_house_event_id: eventId,
    visitor_type: visitorType,
    visitor_name: visitorName,
    visitor_phone: visitorPhone,
    visitor_email: clean(input.visitor_email, 320) || null,
    buyer_agent_name: clean(input.buyer_agent_name, 240) || null,
    buyer_agent_phone: clean(input.buyer_agent_phone, 80) || null,
    buyer_agent_email: clean(input.buyer_agent_email, 320) || null,
    pre_approved: input.pre_approved === true ? true : input.pre_approved === false ? false : null,
    represented_buyer_confirmed: input.represented_buyer_confirmed === true,
    metadata: stripArchivePointers(object(input.metadata))
  };
}

function createHandler({ rest = supabaseRest } = {}) { return async function handler(req, res) {
  try {
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST');
      return sendJson(res, 405, { ok: false, error: 'Method not allowed.' });
    }
    assertSameOrigin(req);
    const body = parseBody(req);
    if (JSON.stringify(body).length > 32000) return sendJson(res, 413, { ok: false, error: 'Check-in request is too large.' });
    const action = clean(body.action || 'create', 60);
    if (action === 'create') {
      const checkin = normalizeCheckin(body.checkin || body);
      receiptSecret(); // Fail before insertion if a secure scoped receipt cannot be issued.
      const live = one(await rest(`open_house_events?id=eq.${enc(checkin.open_house_event_id)}&status=eq.active&ended_at=is.null&select=id,status,ended_at&limit=1`));
      if (!live) throw Object.assign(new Error('This open house is no longer accepting check-ins.'), { status: 409 });
      const created = one(await rest('event_checkins', {
        method: 'POST',
        headers: { Prefer: 'return=representation' },
        body: JSON.stringify(checkin)
      }));
      if (!created?.id) throw Object.assign(new Error('Check-in could not be confirmed.'), { status: 503 });
      setReceiptCookie(req, res, created);
      await rest(`open_house_events?id=eq.${enc(checkin.open_house_event_id)}`, {
        method: 'PATCH',
        body: JSON.stringify({ last_activity_at: new Date().toISOString() })
      }).catch(() => null);
      return sendJson(res, 201, { ok: true, checkin: created });
    }
    if (action === 'update_metadata') {
      const checkinId = clean(body.checkin_id, 100);
      if (!checkinId) return sendJson(res, 400, { ok: false, error: 'Missing check-in id.' });
      const receipt = readReceipt(req, checkinId);
      if (!receipt) return sendJson(res, 401, { ok: false, error: 'Your check-in receipt is required.' });
      const existing = one(await rest(`event_checkins?id=eq.${enc(checkinId)}&select=id,open_house_event_id,metadata&limit=1`));
      if (!existing) return sendJson(res, 404, { ok: false, error: 'Check-in not found.' });
      if (existing.open_house_event_id !== receipt.eventId) return sendJson(res, 403, { ok: false, error: 'Receipt does not match this event.' });
      const updates = Object.fromEntries(Object.entries(object(body.metadata)).filter(([key]) => LISTING_FIELDS.has(key)));
      const updated = one(await rest(`event_checkins?id=eq.${enc(checkinId)}&metadata=eq.${enc(JSON.stringify(existing.metadata || {}))}`, {
        method: 'PATCH',
        headers: { Prefer: 'return=representation' },
        body: JSON.stringify({ metadata: { ...object(existing.metadata), ...updates } })
      }));
      if (!updated) return sendJson(res, 409, { ok: false, error: 'Check-in changed. Reload before retrying; captured disclosures are preserved.' });
      return sendJson(res, 200, { ok: true, checkin: updated });
    }
    return sendJson(res, 400, { ok: false, error: 'Unsupported check-in action.' });
  } catch (error) {
    return sendJson(res, error.status || 500, { ok: false, error: error.status ? error.message : 'Check-in could not be saved.' });
  }
}; }
module.exports = createHandler();
module.exports.createHandler = createHandler;
module.exports.__test = { normalizeCheckin, stripArchivePointers };
