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
    const maxPerRun = Math.max(1, Math.min(Number(process.env.OUTREACH_SEND_MAX_PER_RUN || 3), 50));
    const requestedLimit = Number(body.limit || process.env.OUTREACH_SEND_LIMIT || maxPerRun);
    const limit = Math.max(1, Math.min(Number.isFinite(requestedLimit) ? requestedLimit : maxPerRun, maxPerRun));
    const requestedMode = String(body.mode || '').trim();
    const mode = req.method === 'POST' && ['dry_run', 'diagnostic_no_send'].includes(requestedMode)
      ? requestedMode
      : 'automatic';
    const payload = await callSupabaseFunction(
      'send-agent-outreach',
      { limit, mode, dry_run: mode !== 'automatic' },
      'TWILIO_SEND_FUNCTION_URL'
    );
    send(res, 200, { ok: true, stage: 'send-agent-outreach', payload });
  } catch (error) {
    console.error('[cron/send-agent-outreach] failed', error);
    send(res, 500, { ok: false, error: error.message || 'Failed to send agent outreach.' });
  }
};
