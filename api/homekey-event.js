const { sendJson, supabaseRest } = require('../lib/admin-auth');

const ALLOWED_EVENTS = new Set(['agent_contact_clicked', 'loan_officer_contact_clicked']);

function clean(value, max = 160) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, max);
}

function one(rows) {
  return Array.isArray(rows) ? rows[0] || null : null;
}

async function handler(req, res) {
  try {
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST');
      return sendJson(res, 405, { ok: false, error: 'Method not allowed.' });
    }
    const code = clean(req.body?.homekey_code, 120);
    const eventType = clean(req.body?.event_type, 80);
    if (!code || !ALLOWED_EVENTS.has(eventType)) {
      return sendJson(res, 400, { ok: false, error: 'Invalid HomeKey event.' });
    }
    const homekey = one(await supabaseRest(
      `property_keepsakes?public_code=eq.${encodeURIComponent(code)}&status=eq.active&select=id&limit=1`
    ));
    if (!homekey) return sendJson(res, 404, { ok: false, error: 'HomeKey not found.' });
    await supabaseRest('property_keepsake_events', {
      method: 'POST',
      body: JSON.stringify({
        property_keepsake_id: homekey.id,
        event_type: eventType,
        metadata: { label: clean(req.body?.metadata?.label, 80) }
      })
    });
    return sendJson(res, 200, { ok: true });
  } catch (error) {
    return sendJson(res, error.status || 500, {
      ok: false,
      error: error.message || 'Unable to record HomeKey activity.'
    });
  }
}

module.exports = handler;
module.exports.__test = { ALLOWED_EVENTS };
