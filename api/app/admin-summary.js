const {
  publicUser,
  resolveSession,
  setPrivateResponse
} = require('../../lib/app-auth');
const { buildAdminSummary } = require('../../lib/app-data');

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
      res.status(401).json({ ok: false, error: 'Sign in is required.' });
      return;
    }
    const summary = await buildAdminSummary(context);
    res.status(200).json({
      ok: true,
      user: publicUser(context.user),
      workspace: context.activeWorkspace,
      ...summary
    });
  } catch (error) {
    res.status(Number(error.status) || 500).json({
      ok: false,
      error: error.message || 'Unable to load platform administration.'
    });
  }
};
