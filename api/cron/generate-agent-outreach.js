const { callSupabaseFunction, cronAuthorized, readJsonBody, send } = require('../../lib/outreach-cron-shared');

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

    const body = req.method === 'POST' ? readJsonBody(req) : {};
    const limit = Math.max(1, Math.min(Number(body.limit || process.env.OUTREACH_GENERATE_LIMIT || 25), 100));
    const payload = await callSupabaseFunction('generate-agent-outreach', { limit }, 'GENERATE_FUNCTION_URL');
    send(res, 200, { ok: true, stage: 'generate-agent-outreach', payload });
  } catch (error) {
    console.error('[cron/generate-agent-outreach] failed', error);
    send(res, 500, { ok: false, error: error.message || 'Failed to generate agent outreach.' });
  }
};
