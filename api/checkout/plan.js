const crypto = require('crypto');
const { getProduct, readPricingCatalog } = require('../../lib/pricing-catalog');
const { supabaseRest } = require('../../lib/admin-auth');

const STRIPE_API_VERSION = '2026-06-24.dahlia';
const PUBLIC_PLAN_CODES = new Set(['rel8tion_agent_monthly', 'rel8tion_agent_annual']);

function sendJson(res, status, payload) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(payload));
}

function clean(value, max = 450) {
  return String(value || '').trim().slice(0, max);
}

function localReturnPath(value, fallback = '/pricing') {
  const candidate = clean(value, 700);
  return candidate.startsWith('/') && !candidate.startsWith('//') ? candidate : fallback;
}

function integrationIdentifier() {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz';
  const bytes = crypto.randomBytes(8);
  const suffix = Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join('');
  return `rel8tion_agent_${suffix}`;
}

async function verifyClaimedCheckoutSubject(agentSlug, uid) {
  if (!agentSlug || !uid) return false;
  const rows = await supabaseRest(
    `keys?uid=eq.${encodeURIComponent(uid)}&agent_slug=eq.${encodeURIComponent(agentSlug)}&claimed=eq.true&select=uid&limit=1`
  );
  return Boolean(Array.isArray(rows) && rows[0]?.uid);
}

async function stripeRequest(path, secretKey, options = {}) {
  const response = await fetch(`https://api.stripe.com/v1/${path.replace(/^\/+/, '')}`, {
    method: options.method || 'GET',
    headers: {
      Authorization: `Bearer ${secretKey}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      'Stripe-Version': STRIPE_API_VERSION
    },
    body: options.body || undefined
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data?.error?.message || `Stripe request failed: ${response.status}`);
    error.status = response.status;
    throw error;
  }
  return data;
}

async function resolvePrice(product, currency, secretKey) {
  const query = new URLSearchParams({ active: 'true', limit: '10' });
  query.set('lookup_keys[0]', product.stripe_lookup_key);
  const result = await stripeRequest(`prices?${query.toString()}`, secretKey);
  const price = (result.data || []).find((candidate) => candidate.lookup_key === product.stripe_lookup_key);
  if (!price
    || price.unit_amount !== product.amount_cents
    || price.currency !== currency
    || price.recurring?.interval !== product.billing_interval
    || Number(price.recurring?.interval_count || 1) !== Number(product.interval_count || 1)) {
    const error = new Error(`Stripe pricing is not synchronized for ${product.code}.`);
    error.status = 503;
    throw error;
  }
  return price;
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return sendJson(res, 405, { ok: false, error: 'Method not allowed.' });
  }
  try {
    const body = req.body && typeof req.body === 'object' ? req.body : JSON.parse(String(req.body || '{}'));
    const planCode = clean(body.plan_code, 100);
    if (!PUBLIC_PLAN_CODES.has(planCode)) return sendJson(res, 400, { ok: false, error: 'This plan is not available for public checkout.' });
    const catalog = readPricingCatalog();
    const product = getProduct(catalog, planCode);
    const secretKey = process.env.STRIPE_SECRET_KEY;
    if (!secretKey) return sendJson(res, 501, { ok: false, error: 'Stripe Checkout is not configured.' });
    const price = await resolvePrice(product, catalog.currency, secretKey);
    const proto = req.headers['x-forwarded-proto'] || 'https';
    const host = req.headers['x-forwarded-host'] || req.headers.host;
    const origin = `${proto}://${host}`;
    const agentSlug = clean(body.agent_slug, 120);
    const uid = clean(body.uid, 200);
    const eventPassMembership = clean(body.source, 120) === 'event_pass_rel8tionchip';
    if (eventPassMembership && !(await verifyClaimedCheckoutSubject(agentSlug, uid))) {
      return sendJson(res, 403, { ok: false, error: 'Tap the claimed Event Pass NFC before starting membership checkout.' });
    }
    const metadata = {
      plan_code: product.code,
      role: product.role,
      website_included: String(product.website_entitlement),
      digital_card_included: String(product.digital_card_entitlement),
      content_tools_included: String(product.content_tools_entitlement),
      entitlement_codes: product.entitlement_codes.join(','),
      source: clean(body.source || 'pricing_page', 120),
      agent_slug: agentSlug,
      uid
    };
    const returnPath = localReturnPath(
      body.return_path,
      agentSlug && uid
        ? `/agent-home?agent=${encodeURIComponent(agentSlug)}&uid=${encodeURIComponent(uid)}`
        : '/pricing'
    );
    const successUrl = eventPassMembership
      ? `${origin}/api/checkout/agent-membership-return?session_id={CHECKOUT_SESSION_ID}&agent=${encodeURIComponent(agentSlug)}&uid=${encodeURIComponent(uid)}`
      : `${origin}/pricing?success=1&plan=${encodeURIComponent(planCode)}&session_id={CHECKOUT_SESSION_ID}`;
    const cancelJoiner = returnPath.includes('?') ? '&' : '?';
    const params = new URLSearchParams({
      mode: 'subscription',
      'line_items[0][price]': price.id,
      'line_items[0][quantity]': '1',
      integration_identifier: integrationIdentifier(),
      success_url: successUrl,
      cancel_url: `${origin}${returnPath}${cancelJoiner}membership=canceled`
    });
    for (const [key, value] of Object.entries(metadata)) {
      params.set(`metadata[${key}]`, value);
      params.set(`subscription_data[metadata][${key}]`, value);
    }
    if (body.email) params.set('customer_email', clean(body.email, 160));
    const session = await stripeRequest('checkout/sessions', secretKey, { method: 'POST', body: params });
    if (!session.url) throw new Error('Stripe did not return a Checkout URL.');
    return sendJson(res, 200, { ok: true, plan_code: planCode, id: session.id, url: session.url });
  } catch (error) {
    return sendJson(res, error.status || 502, { ok: false, error: error.message || 'Stripe Checkout is temporarily unavailable.' });
  }
};

module.exports.localReturnPath = localReturnPath;
module.exports.integrationIdentifier = integrationIdentifier;
module.exports.verifyClaimedCheckoutSubject = verifyClaimedCheckoutSubject;
