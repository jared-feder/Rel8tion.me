const { sendJson, supabaseRest } = require('../lib/admin-auth');
const { requireSession } = require('../lib/agent-nfc-session');

function clean(value, max = 300) { return String(value || '').trim().slice(0, max); }
function enc(value) { return encodeURIComponent(clean(value)); }
function one(rows) { return Array.isArray(rows) ? rows[0] || null : null; }
function rows(value) { return Array.isArray(value) ? value : []; }
function parseBody(req) {
  if (!req.body) return {};
  if (typeof req.body === 'object') return req.body;
  try { return JSON.parse(req.body); } catch (_) { return {}; }
}

async function loadSign(input) {
  if (input.sign_id) return one(await supabaseRest(`smart_signs?id=eq.${enc(input.sign_id)}&select=*&limit=1`));
  if (!input.code) return null;
  const direct = one(await supabaseRest(`smart_signs?public_code=eq.${enc(input.code)}&select=*&limit=1`));
  if (direct) return direct;
  const inventory = one(await supabaseRest(`smart_sign_inventory?public_code=eq.${enc(input.code)}&select=id,public_code,smart_sign_id&limit=1`));
  if (!inventory?.smart_sign_id) return null;
  return one(await supabaseRest(`smart_signs?id=eq.${enc(inventory.smart_sign_id)}&select=*&limit=1`));
}

async function loadEvent(input, sign) {
  if (input.event_id) return one(await supabaseRest(`open_house_events?id=eq.${enc(input.event_id)}&select=*&limit=1`));
  if (sign?.active_event_id) return one(await supabaseRest(`open_house_events?id=eq.${enc(sign.active_event_id)}&select=*&limit=1`));
  if (!sign?.id) return null;
  return one(await supabaseRest(`open_house_events?smart_sign_id=eq.${enc(sign.id)}&ended_at=is.null&select=*&order=created_at.desc&limit=1`));
}

function assertHost(event, session) {
  if (!event?.id) {
    const error = new Error('This NFC device is not attached to an open-house event.');
    error.status = 404;
    throw error;
  }
  if (!event.host_agent_slug || event.host_agent_slug !== session.slug) {
    const error = new Error('This open-house event belongs to a different host agent.');
    error.status = 403;
    throw error;
  }
}

async function snapshot(input, session) {
  const sign = await loadSign(input);
  const event = await loadEvent(input, sign);
  assertHost(event, session);
  if (sign?.id && event.smart_sign_id && sign.id !== event.smart_sign_id) {
    const error = new Error('The requested sign is not attached to this open-house event.');
    error.status = 403;
    throw error;
  }
  const [house, checkins, outreach, loanOfficer] = await Promise.all([
    event.open_house_source_id
      ? supabaseRest(`open_houses?id=eq.${enc(event.open_house_source_id)}&select=*&limit=1`).then(one)
      : null,
    supabaseRest(`event_checkins?open_house_event_id=eq.${enc(event.id)}&select=*&order=created_at.desc&limit=50`).then(rows),
    event.open_house_source_id
      ? supabaseRest(`agent_outreach_queue?open_house_id=eq.${enc(event.open_house_source_id)}&select=*&order=created_at.desc&limit=10`).then(rows).catch(() => [])
      : [],
    supabaseRest(`event_loan_officer_sessions?open_house_event_id=eq.${enc(event.id)}&status=eq.live&select=*&order=signed_in_at.desc&limit=1`).then(one).catch(() => null)
  ]);
  return { sign, event, house, checkins, outreach, loan_officer: loanOfficer };
}

async function agentHomeSnapshot(session) {
  const events = rows(await supabaseRest(
    `open_house_events?host_agent_slug=eq.${enc(session.slug)}&select=*&order=created_at.desc&limit=80`
  ));
  const eventIds = events.map((event) => event.id).filter(Boolean);
  const checkins = eventIds.length
    ? rows(await supabaseRest(`event_checkins?open_house_event_id=in.(${eventIds.map(enc).join(',')})&select=*&order=created_at.desc&limit=300`))
    : [];
  return { events, checkins };
}

async function closeEvent(input, session) {
  const sign = await loadSign(input);
  const event = await loadEvent(input, sign);
  assertHost(event, session);
  if (!sign?.id || event.smart_sign_id !== sign.id || sign.active_event_id !== event.id) {
    const error = new Error('This sign is no longer active for the requested event.');
    error.status = 409;
    throw error;
  }
  const now = new Date().toISOString();
  const updatedEvents = await supabaseRest(`open_house_events?id=eq.${enc(event.id)}&host_agent_slug=eq.${enc(session.slug)}`, {
    method: 'PATCH',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ status: 'ended', ended_at: now, last_activity_at: now })
  });
  if (!rows(updatedEvents).length) {
    const error = new Error('The event could not be closed for this host agent.');
    error.status = 409;
    throw error;
  }
  await Promise.all([
    supabaseRest(`smart_signs?id=eq.${enc(sign.id)}&active_event_id=eq.${enc(event.id)}`, {
      method: 'PATCH', body: JSON.stringify({ active_event_id: null, status: 'inactive', deactivated_at: now })
    }),
    supabaseRest(`event_loan_officer_sessions?open_house_event_id=eq.${enc(event.id)}&status=eq.live`, {
      method: 'PATCH', body: JSON.stringify({ status: 'ended', signed_out_at: now, updated_at: now, last_seen_at: now })
    }).catch(() => null),
    supabaseRest(`loan_officer_coverage_signs?active_event_id=eq.${enc(event.id)}`, {
      method: 'PATCH', body: JSON.stringify({ active_event_id: null, active_event_pass_inventory_id: null, active_smart_sign_id: null, status: 'assigned', updated_at: now })
    }).catch(() => null)
  ]);
  return {
    event: { ...event, status: 'ended', ended_at: now, last_activity_at: now },
    sign: { ...sign, active_event_id: null, status: 'inactive', deactivated_at: now }
  };
}

module.exports = async function handler(req, res) {
  try {
    if (!['GET', 'POST'].includes(req.method)) {
      res.setHeader('Allow', 'GET, POST');
      return sendJson(res, 405, { ok: false, error: 'Method not allowed.' });
    }
    const source = req.method === 'POST' ? parseBody(req) : (req.query || {});
    const input = {
      action: clean(source.action || source.mode || 'snapshot', 60),
      agent_slug: clean(source.agent_slug || source.agent, 160),
      event_id: clean(source.event_id || source.event, 100),
      sign_id: clean(source.sign_id, 100),
      code: clean(source.code, 160)
    };
    const session = await requireSession(req, input.agent_slug);
    if (input.action === 'agent_home') {
      return sendJson(res, 200, { ok: true, ...(await agentHomeSnapshot(session)) });
    }
    if (input.action === 'close_event') {
      if (req.method !== 'POST') return sendJson(res, 405, { ok: false, error: 'Closeout requires POST.' });
      return sendJson(res, 200, { ok: true, ...(await closeEvent(input, session)) });
    }
    return sendJson(res, 200, { ok: true, ...(await snapshot(input, session)) });
  } catch (error) {
    return sendJson(res, error.status || 500, { ok: false, error: error.message || 'Private event dashboard request failed.' });
  }
};
