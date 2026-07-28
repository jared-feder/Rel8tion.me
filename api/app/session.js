const {
  publicUser,
  resolveSession,
  setPrivateResponse
} = require('../../lib/app-auth');

module.exports = async function handler(req, res) {
  setPrivateResponse(res);
  try {
    if (req.method !== 'GET') {
      res.setHeader('Allow', 'GET');
      res.status(405).json({ ok: false, error: 'Method not allowed.' });
      return;
    }
    const context = await resolveSession(req, res);
    if (!context) {
      res.status(200).json({ ok: true, authenticated: false });
      return;
    }
    res.status(200).json({
      ok: true,
      authenticated: true,
      user: publicUser(context.user),
      workspaces: context.workspaces,
      active_workspace: context.activeWorkspace,
      permissions: context.permissions,
      source: context.source,
      warnings: context.warnings
    });
  } catch (error) {
    res.status(Number(error.status) || 500).json({
      ok: false,
      authenticated: false,
      error: error.message || 'Unable to load the application session.'
    });
  }
};
