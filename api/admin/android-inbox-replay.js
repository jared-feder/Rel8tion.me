const { adminAuthorized, assertAdminConfig, sendJson } = require('../../lib/admin-auth');
const { clampHours, parseRoutes, requestAndroidInboxReplay } = require('../../lib/android-inbox-export');

function clean(value) {
  return String(value ?? '').trim();
}

function parseBody(req) {
  if (req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body)) return req.body;
  if (typeof req.body === 'string') {
    try {
      return JSON.parse(req.body);
    } catch {
      return {};
    }
  }
  return {};
}

function queryParam(req, name) {
  const value = req.query?.[name];
  if (Array.isArray(value)) return value[0] || '';
  if (value) return value;
  try {
    return new URL(req.url || '', 'https://app.rel8tion.me').searchParams.get(name) || '';
  } catch {
    return '';
  }
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    sendJson(res, 405, { ok: false, error: 'Method not allowed.' });
    return;
  }

  try {
    assertAdminConfig();
    const auth = adminAuthorized(req);
    if (!auth.ok) {
      sendJson(res, 401, { ok: false, error: auth.error });
      return;
    }

    const body = parseBody(req);
    const route = clean(body.route || queryParam(req, 'route') || 'outreach').toLowerCase();
    const hours = clampHours(body.hours || queryParam(req, 'hours'), 36, 168);
    const until = new Date().toISOString();
    const result = await requestAndroidInboxReplay({ routes: parseRoutes(route), hours, until });
    sendJson(res, result.ok ? 200 : 502, result);
  } catch (error) {
    console.error('[admin/android-inbox-replay] failed', error);
    sendJson(res, 500, { ok: false, error: error.message || 'Unable to request Android inbox replay.' });
  }
};
