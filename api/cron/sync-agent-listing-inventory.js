const { run } = require('../../agent-listing-inventory-worker.cjs');

function cronAuthorized(req) {
  const secret = String(process.env.CRON_SECRET || '').trim();
  if (!secret) return false;
  return String(req.headers?.authorization || '').trim() === `Bearer ${secret}`;
}

module.exports = async function handler(req, res) {
  try {
    if (req.method && req.method !== 'GET' && req.method !== 'POST') {
      res.status(405).json({ ok: false, error: 'Method not allowed' });
      return;
    }
    if (!String(process.env.CRON_SECRET || '').trim()) {
      res.status(503).json({ ok: false, error: 'Missing CRON_SECRET' });
      return;
    }
    if (!cronAuthorized(req)) {
      res.status(401).json({ ok: false, error: 'Unauthorized' });
      return;
    }
    if (process.env.AGENT_LISTING_INVENTORY_ENABLED !== 'true') {
      res.status(200).json({
        ok: true,
        disabled: true,
        reason: 'AGENT_LISTING_INVENTORY_ENABLED is not true'
      });
      return;
    }
    const result = await run();
    res.status(200).json(result);
  } catch (error) {
    console.error('[agent-listing-inventory] cron failed:', error.message || error);
    res.status(500).json({
      ok: false,
      error: error.message || 'Agent listing inventory sync failed'
    });
  }
};
