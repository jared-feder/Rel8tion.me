const { adminAuthorized, assertAdminConfig, sendJson } = require('../../lib/admin-auth');
const { cleanLookup, loadAgentProfiles } = require('../../lib/admin-agent-profile');

function readQuery(req, name) {
  const value = req.query?.[name];
  if (Array.isArray(value)) return value[0] || '';
  return value || '';
}

module.exports = async function handler(req, res) {
  try {
    if (req.method !== 'GET') {
      res.setHeader('Allow', 'GET');
      sendJson(res, 405, { ok: false, error: 'Method not allowed.' });
      return;
    }

    assertAdminConfig();
    const auth = adminAuthorized(req);
    if (!auth.ok) {
      sendJson(res, 401, { ok: false, error: auth.error });
      return;
    }

    const agent = cleanLookup(readQuery(req, 'agent') || readQuery(req, 'q'));
    const result = await loadAgentProfiles(agent);
    sendJson(res, 200, {
      ok: true,
      agent,
      profiles: result.profiles || [],
      warnings: result.warnings || [],
      loaded_at: new Date().toISOString()
    });
  } catch (error) {
    sendJson(res, error.status || 500, {
      ok: false,
      error: error.message || 'Unable to load the full agent profile.'
    });
  }
};
