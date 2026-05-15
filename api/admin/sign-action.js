const { adminAuthorized, assertAdminConfig, sendJson, supabaseRest } = require('../../lib/admin-auth');

function parseBody(req) {
  if (!req.body) return {};
  if (typeof req.body === 'object') return req.body;
  try {
    return JSON.parse(req.body);
  } catch (_) {
    return {};
  }
}

function enc(value) {
  return encodeURIComponent(String(value || '').trim());
}

function httpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

async function list(path) {
  const rows = await supabaseRest(path);
  return Array.isArray(rows) ? rows : [];
}

async function one(path, label) {
  const rows = await list(`${path}&limit=1`);
  const row = rows[0] || null;
  if (!row) throw httpError(404, `${label} not found.`);
  return row;
}

async function loadSign(signId) {
  return one(
    `smart_signs?id=eq.${enc(signId)}&select=id,public_code,status,owner_agent_slug,assigned_agent_slug,assigned_slot,active_event_id,uid_primary,uid_secondary,primary_device_type,secondary_device_type,deactivated_at,updated_at`,
    'Smart sign'
  );
}

function uniqueById(rows) {
  const seen = new Set();
  return rows.filter((row) => {
    if (!row?.id || seen.has(row.id)) return false;
    seen.add(row.id);
    return true;
  });
}

async function loadEventsForSign(sign) {
  const eventSelect = 'id,host_agent_slug,smart_sign_id,open_house_source_id,status,start_time,end_time,ended_at,last_activity_at,setup_context,created_at';
  const rows = [];

  if (sign.active_event_id) {
    rows.push(...await list(`open_house_events?id=eq.${enc(sign.active_event_id)}&select=${eventSelect}`));
  }

  rows.push(...await list(`open_house_events?smart_sign_id=eq.${enc(sign.id)}&status=eq.active&select=${eventSelect}&limit=25`));
  return uniqueById(rows);
}

async function endLoanOfficerCoverage(eventId, now) {
  return supabaseRest(
    `event_loan_officer_sessions?open_house_event_id=eq.${enc(eventId)}&status=eq.live`,
    {
      method: 'PATCH',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify({
        status: 'ended',
        signed_out_at: now,
        updated_at: now
      })
    }
  ).catch((error) => ({ warning: error.message || String(error) }));
}

async function endEvent(event, now) {
  if (event.status === 'ended' && event.ended_at) return event;

  const rows = await supabaseRest(`open_house_events?id=eq.${enc(event.id)}`, {
    method: 'PATCH',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify({
      status: 'ended',
      ended_at: event.ended_at || now,
      last_activity_at: now
    })
  });

  return Array.isArray(rows) ? rows[0] || event : event;
}

async function cancelPendingActivationSessions(sign, now) {
  const filters = [`sign_id.eq.${enc(sign.id)}`];
  if (sign.public_code) filters.push(`public_code.eq.${enc(sign.public_code)}`);

  return supabaseRest(
    `smart_sign_activation_sessions?or=(${filters.join(',')})&status=eq.pending`,
    {
      method: 'PATCH',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify({
        status: 'cancelled',
        stage: 'cancelled',
        updated_at: now,
        expires_at: now
      })
    }
  ).catch((error) => ({ warning: error.message || String(error) }));
}

async function detachSign(signId, confirmation) {
  if (String(confirmation || '').trim() !== 'REL8TION') {
    throw httpError(400, 'Type REL8TION to detach this sign.');
  }

  const sign = await loadSign(signId);
  const now = new Date().toISOString();
  const events = await loadEventsForSign(sign);
  const endedEvents = [];
  const loanOfficerCoverage = [];

  for (const event of events) {
    const ended = await endEvent(event, now);
    endedEvents.push(ended);
    loanOfficerCoverage.push({
      event_id: event.id,
      result: await endLoanOfficerCoverage(event.id, now)
    });
  }

  const signRows = await supabaseRest(`smart_signs?id=eq.${enc(sign.id)}`, {
    method: 'PATCH',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify({
      active_event_id: null,
      status: 'inactive',
      owner_agent_slug: null,
      assigned_agent_slug: null,
      assigned_slot: null,
      deactivated_at: now,
      updated_at: now
    })
  });

  const sessionCleanup = await cancelPendingActivationSessions(sign, now);

  return {
    sign_before: sign,
    sign: Array.isArray(signRows) ? signRows[0] || null : null,
    ended_events: endedEvents,
    loan_officer_coverage: loanOfficerCoverage,
    session_cleanup: sessionCleanup
  };
}

module.exports = async function handler(req, res) {
  try {
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST');
      sendJson(res, 405, { ok: false, error: 'Method not allowed.' });
      return;
    }

    assertAdminConfig();
    const auth = adminAuthorized(req);
    if (!auth.ok) {
      sendJson(res, 401, { ok: false, error: auth.error });
      return;
    }

    const body = parseBody(req);
    const action = String(body.action || '').trim();
    if (action !== 'detach_sign') {
      sendJson(res, 400, { ok: false, error: 'Unsupported sign action.' });
      return;
    }
    if (!body.sign_id) {
      sendJson(res, 400, { ok: false, error: 'Missing sign_id.' });
      return;
    }

    const result = await detachSign(body.sign_id, body.confirmation);
    sendJson(res, 200, { ok: true, action, ...result });
  } catch (error) {
    sendJson(res, error.status || 500, {
      ok: false,
      error: error.message || 'Unable to update smart sign.',
      details: error.payload || null
    });
  }
};
