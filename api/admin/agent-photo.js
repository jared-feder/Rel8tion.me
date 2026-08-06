const { adminAuthorized, assertAdminConfig, sendJson } = require('../../lib/admin-auth');
const { uploadAndSyncAgentPhoto } = require('../../lib/admin-agent-photo');

function readBody(req) {
  if (!req.body) return {};
  if (typeof req.body === 'object' && !Buffer.isBuffer(req.body)) return req.body;
  try {
    return JSON.parse(Buffer.isBuffer(req.body) ? req.body.toString('utf8') : req.body);
  } catch (_) {
    return {};
  }
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

    const result = await uploadAndSyncAgentPhoto(readBody(req));
    sendJson(res, 200, {
      ok: true,
      public_url: result.publicUrl,
      bucket: result.bucket,
      path: result.path,
      agent_id: result.agentId,
      updated: result.updated
    });
  } catch (error) {
    sendJson(res, error.status || 500, {
      ok: false,
      error: error.message || 'Unable to save the agent photo.'
    });
  }
};
