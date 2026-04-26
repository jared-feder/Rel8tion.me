const { run } = require('../../estately-enrichment-worker.cjs');

module.exports = async function handler(req, res) {
  try {
    const result = await run();
    res.status(200).json({ ok: true, ...result });
  } catch (error) {
    console.error('[estately] cron route failed:', error);
    res.status(500).json({
      ok: false,
      error: error.message || 'Estately enrichment failed'
    });
  }
};
