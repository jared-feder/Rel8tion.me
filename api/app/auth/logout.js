const {
  authRequest,
  clearSessionCookies,
  sessionTokens,
  setPrivateResponse
} = require('../../../lib/app-auth');

module.exports = async function handler(req, res) {
  setPrivateResponse(res);
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    res.status(405).json({ ok: false, error: 'Method not allowed.' });
    return;
  }

  const { accessToken } = sessionTokens(req);
  if (accessToken) {
    await authRequest('logout?scope=local', {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}` }
    }).catch(() => null);
  }
  clearSessionCookies(req, res);
  res.status(200).json({ ok: true, authenticated: false });
};
