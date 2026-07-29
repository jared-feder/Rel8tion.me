const { adminAuthorized } = require('../../lib/admin-auth');
const {
  hasPermission,
  resolveSession,
  setPrivateResponse
} = require('../../lib/app-auth');

function cleanQueryValue(value) {
  return String(Array.isArray(value) ? value[0] || '' : value || '').trim();
}

function redirect(res, destination) {
  res.setHeader('Location', destination);
  res.status(302).end();
}

module.exports = async function handler(req, res) {
  setPrivateResponse(res);
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    res.status(405).json({ ok: false, error: 'Method not allowed.' });
    return;
  }

  const legacy = adminAuthorized(req);
  if (legacy.ok) {
    const params = new URLSearchParams();
    const uid = cleanQueryValue(req.query?.uid || req.query?.admin_uid);
    const token = cleanQueryValue(req.query?.token || req.query?.admin_token);
    if (uid) params.set('uid', uid);
    if (token) params.set('token', token);
    redirect(res, `/command${params.toString() ? `?${params.toString()}` : ''}`);
    return;
  }

  try {
    const context = await resolveSession(req, res);
    if (!context) {
      // Preserve the existing same-origin COMMAND login. Its browser-stored
      // UID/token is not visible to this server entry route, while every
      // privileged COMMAND request still verifies those credentials server-side.
      redirect(res, '/command?entry=admin');
      return;
    }
    if (!hasPermission(context, 'platform.admin')) {
      redirect(res, '/?notice=admin-access-denied');
      return;
    }
    redirect(res, `/platform-admin?workspace=${encodeURIComponent(context.activeWorkspace.id)}`);
  } catch {
    redirect(res, '/?notice=admin-access-denied');
  }
};
