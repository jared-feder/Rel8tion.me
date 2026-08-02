const { publicPricingCatalog, readPricingCatalog } = require('../../lib/pricing-catalog');

const ALLOWED_ORIGINS = new Set([
  'https://rel8tion.me',
  'https://www.rel8tion.me',
  'https://app.rel8tion.me',
  'https://getrel8tion.com',
  'https://www.getrel8tion.com',
  'https://my.rel8tion.me'
]);

function sendJson(res, status, payload) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(payload));
}

module.exports = function handler(req, res) {
  const origin = String(req.headers.origin || '');
  if (ALLOWED_ORIGINS.has(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Accept, Content-Type');

  if (req.method === 'OPTIONS') {
    res.setHeader('Allow', 'GET, OPTIONS');
    res.statusCode = 204;
    return res.end();
  }
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET, OPTIONS');
    return sendJson(res, 405, { ok: false, error: 'Method not allowed.' });
  }

  try {
    res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=3600');
    return sendJson(res, 200, publicPricingCatalog(readPricingCatalog()));
  } catch (error) {
    console.error('[public-pricing] catalog unavailable', error.message);
    return sendJson(res, 503, {
      ok: false,
      error: 'Pricing is temporarily unavailable. Please try again shortly.'
    });
  }
};
