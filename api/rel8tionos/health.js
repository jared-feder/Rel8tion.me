const { supabaseRest } = require('../../lib/admin-auth');
const {
  authorizeOrRespond,
  requestId,
  sendError,
  sendJson
} = require('../../lib/rel8tionos-auth');

module.exports = async function handler(req, res) {
  const id = requestId(req);
  try {
    if (req.method !== 'GET') {
      res.setHeader('Allow', 'GET');
      sendJson(res, 405, { ok: false, error: 'Method not allowed.' }, id);
      return;
    }
    const auth = authorizeOrRespond(req, res, id);
    if (!auth) return;

    await supabaseRest('agent_outreach_inbox?select=thread_key&limit=1');
    sendJson(res, 200, {
      ok: true,
      service: 'rel8tionos-api',
      data_source: 'ready',
      key_id: auth.key_id
    }, id);
  } catch (error) {
    sendError(res, error, id);
  }
};
