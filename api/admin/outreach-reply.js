const { adminAuthorized, assertAdminConfig, sendJson } = require('../../lib/admin-auth');
const { callSupabaseFunction } = require('../../lib/outreach-cron-shared');

function readJsonBody(req) {
  if (!req.body) return {};
  if (typeof req.body === 'object') return req.body;
  try {
    return JSON.parse(req.body);
  } catch {
    return {};
  }
}

module.exports = async function handler(req, res) {
  try {
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST');
      sendJson(res, 405, { ok: false, error: 'Method not allowed.' });
      return;
    }

    assertAdminConfig();
    const auth = adminAuthorized(req);
    if (!auth.ok) {
      sendJson(res, 401, { ok: false, error: auth.error });
      return;
    }

    const body = readJsonBody(req);
    const id = String(body.id || '').trim();
    const messageBody = String(body.body || '').trim();

    if (!id) {
      sendJson(res, 400, { ok: false, error: 'Missing queue row id.' });
      return;
    }

    if (!messageBody) {
      sendJson(res, 400, { ok: false, error: 'Message body is required.' });
      return;
    }

    const payload = await callSupabaseFunction('send-agent-manual-reply', {
      id,
      body: messageBody
    });

    sendJson(res, 200, {
      ok: true,
      payload
    });
  } catch (error) {
    sendJson(res, error.status || 500, {
      ok: false,
      error: error.message || 'Unable to send outreach reply.',
      details: error.payload || null
    });
  }
};
