const { getOffer, getProduct, readPricingCatalog } = require('../../lib/pricing-catalog');
const { supabaseRest } = require('../../lib/admin-auth');
const { requireSession } = require('../../lib/agent-nfc-session');
const publicPricingHandler = require('../public/pricing');

const STRIPE_API_VERSION = '2026-06-24.dahlia';
const REL8TION_LOGO_URL = 'https://rel8tion.me/wp-content/uploads/2026/04/logo150x100trans.png';
const FULFILLMENT_MESSAGE = 'Includes the REL8TION Smart Sign and custom company-branded Rel8tionChips. Branding may be supplied now or after purchase. REL8TION will confirm fulfillment and shipping details before production.';

function sendJson(res, status, payload) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(payload));
}

function getOrigin(req) {
  const proto = req.headers['x-forwarded-proto'] || 'https';
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  return `${proto}://${host}`;
}

function clean(value, maxLength = 450) {
  return String(value || '').trim().slice(0, maxLength);
}

function cleanReturnPath(value, fallback = '/kit-intake') {
  const raw = clean(value, 220);
  if (!raw || !raw.startsWith('/') || raw.startsWith('//')) return fallback;
  return raw;
}

function appendQuery(path, query) {
  return `${path}${path.includes('?') ? '&' : '?'}${query}`;
}

function selectedOfferCode(value) {
  const selected = clean(value, 80).toLowerCase();
  if (['member_hardware', 'hardware', 'open_house_kit_member_hardware'].includes(selected)) return 'open_house_kit_member_hardware';
  return ['annual', 'year', 'yearly', 'open_house_system_annual'].includes(selected)
    ? 'open_house_system_annual'
    : 'open_house_system_monthly';
}

function activeAgentMembership(row = {}) {
  const codes = Array.isArray(row.entitlement_codes) ? row.entitlement_codes : [];
  return row.status === 'active'
    && row.role === 'real_estate_agent'
    && codes.includes('agent_dashboard')
    && codes.includes('digital_card');
}

async function requireMemberHardwareEligibility(req, body) {
  const requestedAgent = clean(body.agent_slug, 160);
  const session = await requireSession(req, requestedAgent);
  const entitlements = await supabaseRest(
    `pricing_entitlements?subject_slug=eq.${encodeURIComponent(session.slug)}&role=eq.real_estate_agent&status=eq.active&select=role,status,entitlement_codes&order=updated_at.desc&limit=10`
  );
  if (!(Array.isArray(entitlements) ? entitlements : []).some(activeAgentMembership)) {
    const error = new Error('The one-time member hardware price requires an active REL8TION Agent membership.');
    error.status = 403;
    throw error;
  }
  body.agent_slug = session.slug;
  body.uid = body.uid || session.uid;
  return session;
}

async function readBody(req) {
  if (req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body)) return req.body;
  if (Buffer.isBuffer(req.body)) return JSON.parse(req.body.toString('utf8') || '{}');
  if (typeof req.body === 'string') return JSON.parse(req.body || '{}');
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
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

function stripePriceMatches(product, price, currency) {
  const expectedInterval = product.billing_interval === 'one_time' ? null : product.billing_interval;
  return price?.active === true
    && price.lookup_key === product.stripe_lookup_key
    && price.currency === currency
    && price.unit_amount === product.amount_cents
    && (price.recurring?.interval || null) === expectedInterval
    && Number(price.recurring?.interval_count || 1) === Number(product.interval_count || 1);
}

async function resolveStripePrices(products, currency, secretKey) {
  const query = new URLSearchParams({ active: 'true', limit: '100' });
  products.forEach((product, index) => query.set(`lookup_keys[${index}]`, product.stripe_lookup_key));
  const result = await stripeRequest(`prices?${query.toString()}`, secretKey);
  const prices = Array.isArray(result.data) ? result.data : [];
  return products.map((product) => {
    const price = prices.find((candidate) => candidate.lookup_key === product.stripe_lookup_key);
    if (!stripePriceMatches(product, price, currency)) {
      const error = new Error(`Stripe pricing is not synchronized for ${product.code}. Run npm run pricing:stripe:dry-run.`);
      error.status = 503;
      throw error;
    }
    return price;
  });
}

function metadataForOffer(offer, body) {
  const brokerageName = clean(body.brokerage_name || body.brokerage, 160);
  const brandLogoUrl = clean(body.brand_logo_url, 450);
  const preferredColors = clean(body.preferred_company_colors || body.brand_colors, 300);
  const brandNotes = clean(body.brand_notes || body.notes, 450);
  const brandingStatus = brandLogoUrl || preferredColors || brandNotes ? 'provided' : 'pending';
  const values = {
    plan_code: offer.code,
    role: offer.role,
    plan: offer.billing_interval === 'one_time' ? 'member_hardware' : offer.billing_interval === 'year' ? 'annual' : 'monthly',
    product: offer.billing_interval === 'one_time' ? 'open_house_kit_member_hardware' : 'complete_open_house_system',
    source: clean(body.source || 'open_house_kit', 120),
    flow: clean(body.flow, 80),
    uid: clean(body.uid, 120),
    agent_id: clean(body.agent_id, 120),
    agent_slug: clean(body.agent_slug, 120),
    agent: clean(body.agent || body.agent_name, 160),
    email: clean(body.email, 160),
    phone: clean(body.phone, 80),
    brokerage_name: brokerageName,
    brokerage: brokerageName,
    brand_logo_url: brandLogoUrl,
    preferred_company_colors: preferredColors,
    brand_notes: brandNotes,
    branding_status: brandingStatus,
    branded_rel8tionchips: 'true',
    kit_included: 'true',
    website_included: String(offer.website_entitlement === true),
    website_builder_included: String(offer.website_entitlement === true),
    digital_card_included: String(offer.digital_card_entitlement === true),
    content_tools_included: String(offer.content_tools_entitlement === true),
    trial_days: String(offer.trial_days || 0),
    annual_renewal_cents: offer.billing_interval === 'year' ? String(offer.renewal_cents) : '',
    entitlement_codes: offer.entitlement_codes.join(','),
    address: clean(body.address, 450),
    sponsor_profile_id: clean(body.sponsor_profile_id, 120),
    sponsor_name: clean(body.sponsor_name, 160),
    sponsor_company: clean(body.sponsor_company, 160),
    event: clean(body.event, 160),
    sign_id: clean(body.sign_id, 120)
  };
  return Object.fromEntries(Object.entries(values).filter(([, value]) => value !== ''));
}

function addMetadata(params, prefix, metadata) {
  for (const [key, value] of Object.entries(metadata)) params.set(`${prefix}[${key}]`, clean(value));
}

module.exports = async function handler(req, res) {
  if (req.method === 'GET') return publicPricingHandler(req, res);
  if (req.method === 'OPTIONS') {
    res.setHeader('Allow', 'GET, POST, OPTIONS');
    res.statusCode = 204;
    return res.end();
  }
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST, OPTIONS');
    return sendJson(res, 405, { ok: false, error: 'Method not allowed.' });
  }

  try {
    const body = await readBody(req);
    const catalog = readPricingCatalog();
    const offer = getOffer(catalog, selectedOfferCode(body.plan));
    if (offer.code === 'open_house_kit_member_hardware') await requireMemberHardwareEligibility(req, body);
    const products = offer.line_items.map((code) => getProduct(catalog, code));
    const secretKey = process.env.STRIPE_SECRET_KEY;
    if (!secretKey) return sendJson(res, 501, { ok: false, error: 'Stripe Checkout is not configured.' });
    const stripePrices = await resolveStripePrices(products, catalog.currency, secretKey);

    const origin = getOrigin(req);
    const returnPath = cleanReturnPath(body.return_path, '/kit-intake');
    const interval = offer.billing_interval === 'one_time' ? 'member_hardware' : offer.billing_interval === 'year' ? 'annual' : 'monthly';
    const params = new URLSearchParams();
    params.set('mode', offer.checkout_mode);
    stripePrices.forEach((price, index) => {
      params.set(`line_items[${index}][price]`, price.id);
      params.set(`line_items[${index}][quantity]`, '1');
    });
    params.set('branding_settings[display_name]', 'REL8TION Complete Open House System');
    params.set('branding_settings[background_color]', '#eef8ff');
    params.set('branding_settings[button_color]', '#172c76');
    params.set('branding_settings[border_style]', 'pill');
    params.set('branding_settings[logo][type]', 'url');
    params.set('branding_settings[logo][url]', REL8TION_LOGO_URL);
    params.set('custom_text[submit][message]', FULFILLMENT_MESSAGE);
    params.set('custom_text[after_submit][message]', 'After payment, REL8TION will confirm your company branding, shipping, onboarding, and platform access.');
    params.set('success_url', `${origin}${appendQuery(returnPath, `success=1&plan=${interval}&session_id={CHECKOUT_SESSION_ID}`)}`);
    params.set('cancel_url', `${origin}${appendQuery(returnPath, `canceled=1&plan=${interval}`)}`);

    const metadata = metadataForOffer(offer, body);
    addMetadata(params, 'metadata', metadata);
    if (offer.checkout_mode === 'subscription') {
      addMetadata(params, 'subscription_data[metadata]', metadata);
      if (offer.trial_days) params.set('subscription_data[trial_period_days]', String(offer.trial_days));
    }
    if (body.email) params.set('customer_email', clean(body.email, 160));
    const referenceParts = [clean(body.agent, 80), clean(body.event, 80)].filter(Boolean);
    if (referenceParts.length) params.set('client_reference_id', referenceParts.join(':'));

    const session = await stripeRequest('checkout/sessions', secretKey, { method: 'POST', body: params });
    if (!session.url) throw new Error('Stripe did not return a Checkout URL.');
    return sendJson(res, 200, {
      ok: true,
      plan: interval,
      plan_code: offer.code,
      mode: 'checkout_session',
      id: session.id,
      url: session.url
    });
  } catch (error) {
    return sendJson(res, error.status || 502, {
      ok: false,
      error: error.message || 'Stripe Checkout is temporarily unavailable.'
    });
  }
};

module.exports.activeAgentMembership = activeAgentMembership;
module.exports.requireMemberHardwareEligibility = requireMemberHardwareEligibility;
module.exports.selectedOfferCode = selectedOfferCode;
