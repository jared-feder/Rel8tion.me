const { sendJson } = require('../../lib/admin-auth');
const { loadEventPassReuseOptions } = require('../../lib/event-pass-registration');
const { getProduct, readPricingCatalog } = require('../../lib/pricing-catalog');

function clean(value, max = 500) {
  return String(value || '').trim().slice(0, max);
}

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    sendJson(res, 405, { ok: false, error: 'Method not allowed.' });
    return;
  }

  try {
    const context = await loadEventPassReuseOptions({
      uid: clean(req.query?.uid, 300),
      agentSlug: clean(req.query?.agent || req.query?.agent_slug, 160),
      publicCode: clean(req.query?.code || req.query?.public_code, 300),
      openHouseId: clean(req.query?.open_house_id, 300),
      supportingListingAgent: clean(req.query?.supporting_listing_agent, 20) === 'true'
    });
    const monthly = getProduct(readPricingCatalog(), 'rel8tion_agent_monthly');
    sendJson(res, 200, {
      ok: true,
      ...context,
      plan: {
        code: monthly.code,
        label: `$${(monthly.amount_cents / 100).toFixed(0)}/month`,
        amount_cents: monthly.amount_cents,
        features: monthly.included_features
      }
    });
  } catch (error) {
    sendJson(res, error.status || 500, {
      ok: false,
      error: error.message || 'Event Pass reuse options could not be loaded.'
    });
  }
};
