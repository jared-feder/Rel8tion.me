const {
  authRequest,
  clean,
  loadWorkspaceContext,
  publicUser,
  readJsonBody,
  setPrivateResponse,
  writeSessionCookies
} = require('../../../lib/app-auth');

module.exports = async function handler(req, res) {
  setPrivateResponse(res);
  try {
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST');
      res.status(405).json({ ok: false, error: 'Method not allowed.' });
      return;
    }

    const body = readJsonBody(req);
    const email = clean(body.email, 320).toLowerCase();
    const password = String(body.password || '');
    if (!email || !password) {
      res.status(400).json({ ok: false, error: 'Email and password are required.' });
      return;
    }

    const session = await authRequest('token?grant_type=password', {
      method: 'POST',
      body: JSON.stringify({ email, password })
    });
    if (!session?.access_token || !session?.refresh_token || !session?.user) {
      throw new Error('Supabase did not return a complete application session.');
    }

    writeSessionCookies(req, res, session);
    const context = await loadWorkspaceContext(session.user, req);
    res.status(200).json({
      ok: true,
      authenticated: true,
      user: publicUser(session.user),
      workspaces: context.workspaces,
      active_workspace: context.activeWorkspace,
      permissions: context.permissions,
      source: context.source,
      warnings: context.warnings
    });
  } catch (error) {
    const authFailure = [400, 401, 403].includes(Number(error.status));
    res.status(authFailure ? 401 : Number(error.status) || 500).json({
      ok: false,
      error: authFailure ? 'The email or password was not accepted.' : clean(error.message, 300) || 'Unable to sign in.'
    });
  }
};
