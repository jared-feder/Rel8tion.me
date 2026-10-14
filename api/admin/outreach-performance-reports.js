const { adminAuthorized, assertAdminConfig, sendJson } = require('../../lib/admin-auth');
const archive = require('../../lib/outreach-report-archive');

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
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
        const report = await archive.getReport(window.key, req.query.version);
        if (!report) return sendJson(res, 404, { ok: false, error: 'No saved brief for this week.' });
        if (req.query.format === 'pdf') {
          if (report.generation_status !== 'ready') return sendJson(res, 409, { ok: false, error: 'Generate this brief before downloading.' });
          const pdf = await require('../../lib/outreach-report-pdf').renderPdf(report.summary);
          res.setHeader('Content-Type', 'application/pdf');
          res.setHeader('Content-Disposition', `attachment; filename="rel8tion-outreach-performance-brief-${window.key}-v${report.report_version || 1}.pdf"`);
          return res.status(200).send(Buffer.from(pdf));
        }
        // Internal hashed outcome references support history preservation, not browser display.
        const { confirmationLedger, ...summary } = report.summary || {};
        return sendJson(res, 200, { ok: true, report: { ...report, summary: report.summary ? summary : null } });
      }
      return sendJson(res, 200, { ok: true, ...await archive.listReports() });
    }
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body || {};
    if (!['generate', 'email'].includes(body.action)) return sendJson(res, 400, { ok: false, error: 'Choose Generate brief or Email brief.' });
    const window = archive.windowForWeek(String(body.week || ''));
    const result = await archive.processReport({ window, emailOnly: body.action === 'email' });
    return sendJson(res, result.busy ? 409 : 200, { ok: !result.busy, busy: Boolean(result.busy), email: result.email,
      error: result.busy ? 'This brief is being generated. Refresh shortly.' : undefined });
  } catch (error) {
    console.error('[outreach-performance-reports]', error.message);
    return sendJson(res, error.status === 400 ? 400 : 503, { ok: false,
      error: error.status === 400 ? error.message : 'Outreach briefs are unavailable. Check archive storage and server configuration, then retry.' });
  }
};
