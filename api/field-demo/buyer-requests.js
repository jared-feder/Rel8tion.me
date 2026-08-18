const { sendJson, supabaseRest } = require('../../lib/admin-auth');
const { requireSession } = require('../../lib/agent-nfc-session');

function clean(value, max = 400) { return String(value || '').trim().slice(0, max); }
function enc(value) { return encodeURIComponent(clean(value)); }
function one(rows) { return Array.isArray(rows) ? rows[0] || null : null; }
function parseBody(req) {
  if (!req.body) return {};
  if (typeof req.body === 'object') return req.body;
  try { return JSON.parse(req.body); } catch (_) { return {}; }
}

async function authEmail(req) {
  const token = clean(String(req.headers?.authorization || '').replace(/^Bearer\s+/i, ''), 4000);
  const url = clean(process.env.SUPABASE_URL, 1000).replace(/\/$/, '');
  const anonKey = clean(process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY, 4000);
  if (!token || !url || !anonKey) return '';
  const response = await fetch(`${url}/auth/v1/user`, {
    headers: { apikey: anonKey, Authorization: `Bearer ${token}` }
  });
  const user = await response.json().catch(() => ({}));
  return response.ok ? clean(user.email, 320).toLowerCase() : '';
}

async function assertViewer(req, event) {
  const email = await authEmail(req);
  if (email) {
    const assignment = one(await supabaseRest(
      `event_loan_officer_sessions?open_house_event_id=eq.${enc(event.id)}&loan_officer_email=ilike.${enc(email)}&select=id&limit=1`
    ));
    if (assignment) return;
  }
  const session = await requireSession(req, event.host_agent_slug).catch(() => null);
  if (session) return;
  const error = new Error('A signed-in assigned professional or the host agent NFC session is required.');
  error.status = 401;
  throw error;
}

module.exports = async function handler(req, res) {
  try {
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST');
      return sendJson(res, 405, { ok: false, error: 'Method not allowed.' });
    }
    const body = parseBody(req);
    const eventId = clean(body.event_id || body.open_house_event_id, 100);
    if (!eventId) return sendJson(res, 400, { ok: false, error: 'Missing open-house event.' });
    const event = one(await supabaseRest(`open_house_events?id=eq.${enc(eventId)}&select=id,host_agent_slug&limit=1`));
    if (!event) return sendJson(res, 404, { ok: false, error: 'Open-house event not found.' });
    await assertViewer(req, event);
    const checkins = await supabaseRest(
      `event_checkins?open_house_event_id=eq.${enc(event.id)}&select=id,open_house_event_id,buyer_id,visitor_name,visitor_phone,visitor_email,pre_approved,metadata,created_at&order=created_at.desc&limit=50`
    );
    return sendJson(res, 200, { ok: true, checkins: Array.isArray(checkins) ? checkins : [] });
  } catch (error) {
    return sendJson(res, error.status || 500, { ok: false, error: error.message || 'Buyer requests could not be loaded.' });
  }
};
