const { adminAuthorized, assertAdminConfig, sendJson } = require('../../lib/admin-auth');

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

    sendJson(res, 200, {
      ok: true,
      method: auth.method,
      uid: auth.uid || null
    });
  } catch (error) {
    sendJson(res, 500, { ok: false, error: error.message || 'Unable to verify admin access.' });
  }
};
