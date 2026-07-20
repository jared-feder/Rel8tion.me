const { run } = require('../../weekly-production-report-worker.cjs');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ ok: false, error: 'Method not allowed' });
  const secret = process.env.CRON_SECRET || process.env.CRON_SHARED_SECRET || '';
  if (!secret || req.headers.authorization !== `Bearer ${secret}`) {
    return res.status(401).json({ ok: false, error: 'Unauthorized' });
  }
  try {
    const force = String(req.query?.force || '') === '1';
    const dryRun = String(req.query?.dry_run || '') === '1';
    const result = await run({ force, dryRun });
    const missingEmail = result.email?.status === 'not_configured';
    return res.status(missingEmail ? 503 : 200).json({ ok: !missingEmail, ...result });
  } catch (error) {
    console.error('[weekly-production-report] failed:', error);
    return res.status(500).json({ ok: false, error: error.message || 'Weekly production report failed' });
  }
};
