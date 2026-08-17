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

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    sendJson(res, 405, { ok: false, error: 'Method not allowed.' });
    return;
  }

  try {
    const result = await activateNormalEventPass(parseBody(req));
    sendJson(res, 200, { ok: true, action: 'activate_event_pass', ...result });
  } catch (error) {
    sendJson(res, error.status || 500, {
      ok: false,
      error: error.message || 'Event Pass activation failed.',
      event_id: error.event_id || null
    });
  }
};
