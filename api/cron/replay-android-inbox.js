const { cronAuthorized, readJsonBody, send } = require('../../lib/outreach-cron-shared');
const { clampHours, parseRoutes, requestAndroidInboxReplay } = require('../../lib/android-inbox-export');

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

    if (process.env.ANDROID_INBOX_REPLAY_ENABLED === 'false') {
      send(res, 200, { ok: true, skipped: true, reason: 'ANDROID_INBOX_REPLAY_ENABLED=false' });
      return;
    }

    const body = req.method === 'POST' ? readJsonBody(req) : {};
    const routeSetting = body.routes || body.route || process.env.ANDROID_INBOX_REPLAY_ROUTES || 'outreach';
    const hours = clampHours(body.hours || process.env.ANDROID_INBOX_REPLAY_HOURS || 3, 3, 24);
    const result = await requestAndroidInboxReplay({
      routes: parseRoutes(routeSetting, 'outreach'),
      hours
    });

    send(res, result.ok ? 200 : 502, {
      ...result,
      stage: 'replay-android-inbox'
    });
  } catch (error) {
    console.error('[cron/replay-android-inbox] failed', error);
    send(res, 500, { ok: false, error: error.message || 'Failed to replay Android inbox.' });
  }
};
