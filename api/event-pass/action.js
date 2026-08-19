const { sendJson } = require('../../lib/admin-auth');
const { activateNormalEventPass } = require('../../lib/event-pass-registration');

function parseBody(req) {
  if (!req.body) return {};
  if (typeof req.body === 'object') return req.body;
  try {
    return JSON.parse(req.body);
  } catch (_) {
    return {};
  }
}

function membershipRoute(body = {}) {
  const params = new URLSearchParams();
  const values = {
    uid: body.uid,
    agent: body.agent_slug,
    code: body.public_code || body.code,
    sign_id: body.sign_id,
    open_house_id: body.open_house_id || body.open_house?.id,
    supporting_listing_agent: body.supporting_listing_agent === true || body.supporting_listing_agent === 'true' ? 'true' : ''
  };
  Object.entries(values).forEach(([key, value]) => {
    if (value) params.set(key, String(value));
  });
  return `/event-pass-reuse?${params.toString()}`;
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    sendJson(res, 405, { ok: false, error: 'Method not allowed.' });
    return;
  }

  const body = parseBody(req);
  try {
    const result = await activateNormalEventPass(body, req);
    sendJson(res, 200, { ok: true, action: 'activate_event_pass', ...result });
  } catch (error) {
    sendJson(res, error.status || 500, {
      ok: false,
      error: error.message || 'Event Pass activation failed.',
      code: error.code || null,
      event_id: error.event_id || null,
      membership_url: error.status === 402 ? membershipRoute(body) : null
    });
  }
};

module.exports.membershipRoute = membershipRoute;
