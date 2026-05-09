const { run } = require('../../onekey-freshness-worker.cjs');

module.exports = async function handler(req, res) {
  try {
    if (req.method && req.method !== 'GET' && req.method !== 'POST') {
      res.status(405).json({ ok: false, error: 'Method not allowed' });
      return;
    }

    const result = await run();
    res.status(200).json({ ok: true, ...result });
  } catch (error) {
    console.error('[onekey-freshness] cron failed:', error.message || error);
    res.status(500).json({
      ok: false,
      error: error.message || 'OneKey freshness check failed'
    });
  }
};
