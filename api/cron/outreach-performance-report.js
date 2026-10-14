const { run } = require('../../outreach-performance-report-worker.cjs');
module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'GET') return res.status(405).json({ ok: false, error: 'Method not allowed' });
  const secret = process.env.CRON_SECRET || process.env.CRON_SHARED_SECRET || '';
  if (!secret || req.headers.authorization !== `Bearer ${secret}`) return res.status(401).json({ ok: false, error: 'Unauthorized' });
  try {
    const result = await run({ force: req.query?.force === '1', dryRun: req.query?.dry_run === '1' });
    const failed = ['not_configured', 'failed', 'unknown'].includes(result.email?.status);
    const status = { week: result.report?.week_start, generation: result.report?.generation_status, email: result.email?.status,
      skipped: result.skipped, busy: result.busy, dryRun: result.dryRun };
    console.log('[outreach-performance-report]', JSON.stringify(status));
    return res.status(failed ? 503 : 200).json({ ok: !failed, ...status });
  } catch (error) {
    console.error('[outreach-performance-report]', error.message);
    return res.status(500).json({ ok: false, error: 'Outreach performance brief failed. Inspect server logs.' });
  }
};
