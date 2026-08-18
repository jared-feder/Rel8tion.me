const { sendJson, supabaseRest } = require('../lib/admin-auth');

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

async function requireLiveEvent(eventId) {
  const event = one(await supabaseRest(
    `open_house_events?id=eq.${enc(eventId)}&status=eq.active&ended_at=is.null&select=id,status,ended_at&limit=1`
  ));
  if (!event) {
    const error = new Error('This open house is no longer accepting check-ins.');
    error.status = 409;
    throw error;
  }
  return event;
}

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
    metadata: object(input.metadata)
  };
}

module.exports = async function handler(req, res) {
  try {
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST');
      return sendJson(res, 405, { ok: false, error: 'Method not allowed.' });
    }
    const body = parseBody(req);
    const action = clean(body.action || 'create', 60);
    if (action === 'create') {
      const checkin = normalizeCheckin(body.checkin || body);
      await requireLiveEvent(checkin.open_house_event_id);
      const created = one(await supabaseRest('event_checkins', {
        method: 'POST',
        headers: { Prefer: 'return=representation' },
        body: JSON.stringify(checkin)
      }));
      await supabaseRest(`open_house_events?id=eq.${enc(checkin.open_house_event_id)}`, {
        method: 'PATCH',
        body: JSON.stringify({ last_activity_at: new Date().toISOString() })
      }).catch(() => null);
      return sendJson(res, 201, { ok: true, checkin: created });
    }
    if (action === 'update_metadata') {
      const checkinId = clean(body.checkin_id, 100);
      if (!checkinId) return sendJson(res, 400, { ok: false, error: 'Missing check-in id.' });
      const existing = one(await supabaseRest(`event_checkins?id=eq.${enc(checkinId)}&select=id,open_house_event_id&limit=1`));
      if (!existing) return sendJson(res, 404, { ok: false, error: 'Check-in not found.' });
      const updated = one(await supabaseRest(`event_checkins?id=eq.${enc(checkinId)}`, {
        method: 'PATCH',
        headers: { Prefer: 'return=representation' },
        body: JSON.stringify({ metadata: object(body.metadata) })
      }));
      return sendJson(res, 200, { ok: true, checkin: updated });
    }
    return sendJson(res, 400, { ok: false, error: 'Unsupported check-in action.' });
  } catch (error) {
    return sendJson(res, error.status || 500, { ok: false, error: error.message || 'Check-in could not be saved.' });
  }
};
