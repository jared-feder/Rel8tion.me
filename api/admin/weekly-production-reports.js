const { adminAuthorized, assertAdminConfig, sendJson } = require('../../lib/admin-auth');
const archive = require('../../lib/weekly-report-archive');

module.exports = async function handler(req, res) {
  if (!['GET', 'POST'].includes(req.method)) {
    res.setHeader('Allow', 'GET, POST');
    return sendJson(res, 405, { ok: false, error: 'Method not allowed.' });
  }
  try {
    assertAdminConfig();
    const auth = adminAuthorized(req);
    if (!auth.ok) return sendJson(res, 401, { ok: false, error: auth.error });
    if (req.method === 'GET') {
      if (req.query?.week) {
        const window = archive.windowForWeek(String(req.query.week));
        const report = await archive.getReport(window.key);
        return sendJson(res, report ? 200 : 404, { ok: Boolean(report), report, error: report ? undefined : 'No saved report for this week.' });
      }
      return sendJson(res, 200, { ok: true, ...await archive.listReports() });
    }
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body || {};
    if (!['generate', 'email'].includes(body.action)) return sendJson(res, 400, { ok: false, error: 'Choose Generate report or Email report.' });
    const window = archive.windowForWeek(String(body.week || ''));
    // COMMAND generation only saves a snapshot. It never closes events or sends messages.
    const result = await archive.processReport({ window, emailOnly: body.action === 'email' });
    return sendJson(res, result.busy ? 409 : 200, { ok: !result.busy, ...result, error: result.busy ? 'This report is being generated. Refresh shortly.' : undefined });
  } catch (error) {
    console.error('[weekly-production-reports]', error.message);
    return sendJson(res, error.status === 400 ? 400 : 503, { ok: false,
      error: error.status === 400 ? error.message : 'Weekly reports are unavailable. Check archive storage and server configuration, then retry.' });
  }
};
