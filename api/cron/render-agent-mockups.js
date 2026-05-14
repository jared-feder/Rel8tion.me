const { cronAuthorized, readJsonBody, send } = require('../../lib/outreach-cron-shared');

module.exports = async function handler(req, res) {
  try {
    if (req.method !== 'GET' && req.method !== 'POST') {
      res.setHeader('Allow', 'GET, POST');
      send(res, 405, { ok: false, error: 'Method not allowed.' });
      return;
    }

    const auth = cronAuthorized(req);
    if (!auth.ok) {
      send(res, auth.error === 'Unauthorized.' ? 401 : 500, { ok: false, error: auth.error });
      return;
    }

    const sharedSecret = process.env.CRON_SHARED_SECRET;
    if (!sharedSecret) throw new Error('Missing CRON_SHARED_SECRET.');

    const body = req.method === 'POST' ? readJsonBody(req) : {};
    const limit = Math.max(1, Math.min(Number(body.limit || process.env.OUTREACH_RENDER_LIMIT || 10), 50));
    const base = (process.env.RENDERER_BASE_URL || 'https://mockup-renderer-psi.vercel.app').replace(/\/$/, '');
    const response = await fetch(`${base}/api/render-agent-mockup`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-cron-secret': sharedSecret,
        Authorization: req.headers.authorization || ''
      },
      body: JSON.stringify({ limit })
    });

    const raw = await response.text().catch(() => '');
    let payload = null;
    try {
      payload = raw ? JSON.parse(raw) : null;
    } catch {
      payload = { raw };
    }
    if (!response.ok) throw new Error(payload?.error || raw || `Mockup render failed: ${response.status}`);
    send(res, 200, { ok: true, stage: 'render-agent-mockups', payload });
  } catch (error) {
    console.error('[cron/render-agent-mockups] failed', error);
    send(res, 500, { ok: false, error: error.message || 'Failed to render agent mockups.' });
  }
};
