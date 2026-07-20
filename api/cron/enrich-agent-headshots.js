const { run } = require('../../onekey-headshot-worker.cjs');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ ok: false, error: 'Method not allowed' });
  const cronSecret = process.env.CRON_SECRET || process.env.CRON_SHARED_SECRET || '';
  if (!cronSecret || req.headers.authorization !== `Bearer ${cronSecret}`) {
    return res.status(401).json({ ok: false, error: 'Unauthorized' });
  }
  try {
    const result = await run({ days: 14, limit: 8 });
    return res.status(200).json({ ok: true, ...result });
  } catch (error) {
    console.error('[onekey-headshots] cron failed:', error);
    return res.status(500).json({ ok: false, error: error.message || 'Headshot enrichment failed' });
  }
};
