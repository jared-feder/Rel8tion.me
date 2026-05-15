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

async function one(path, label) {
  const rows = await supabaseRest(`${path}&limit=1`);
  const row = Array.isArray(rows) ? rows[0] || null : null;
  if (!row) {
    const error = new Error(`${label} not found.`);
    error.status = 404;
    throw error;
  }
  return row;
}

async function loadEvent(eventId) {
  return one(
    `open_house_events?id=eq.${enc(eventId)}&select=id,host_agent_slug,smart_sign_id,open_house_source_id,status,start_time,end_time,ended_at,last_activity_at,setup_context,created_at`,
    'Open house event'
  );
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

async function endEvent(eventId) {
  const event = await loadEvent(eventId);
  const now = new Date().toISOString();

  const eventRows = await supabaseRest(`open_house_events?id=eq.${enc(event.id)}`, {
    method: 'PATCH',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify({
      status: 'ended',
      ended_at: event.ended_at || now,
      last_activity_at: now
    })
  });
  const updatedEvent = Array.isArray(eventRows) ? eventRows[0] || null : null;

  let sign = null;
  if (event.smart_sign_id) {
    const signRows = await supabaseRest(
      `smart_signs?id=eq.${enc(event.smart_sign_id)}&active_event_id=eq.${enc(event.id)}`,
      {
        method: 'PATCH',
        headers: { Prefer: 'return=representation' },
        body: JSON.stringify({
          active_event_id: null,
          status: 'inactive',
          deactivated_at: now
        })
      }
    );
    sign = Array.isArray(signRows) ? signRows[0] || null : null;
  }

  const loan_officer_coverage = await endLoanOfficerCoverage(event.id, now);
  return { event: updatedEvent || event, sign, loan_officer_coverage };
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
    if (action !== 'end_event') {
      sendJson(res, 400, { ok: false, error: 'Unsupported event action.' });
      return;
    }
    if (!body.event_id) {
      sendJson(res, 400, { ok: false, error: 'Missing event_id.' });
      return;
    }

    const result = await endEvent(body.event_id);
    sendJson(res, 200, { ok: true, action, ...result });
  } catch (error) {
    sendJson(res, error.status || 500, {
      ok: false,
      error: error.message || 'Unable to update open house event.',
      details: error.payload || null
    });
  }
};
