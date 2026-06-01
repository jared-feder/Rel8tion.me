const { createHash } = require('crypto');

const STRIPE_API_VERSION = '2026-02-25.clover';
const DEFAULT_WEBSITE_BUILDER_URL = 'https://my.rel8tion.me';

function sendJson(res, status, payload) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(payload));
}

async function readBody(req) {
  if (req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body)) return req.body;
  if (Buffer.isBuffer(req.body)) return JSON.parse(req.body.toString('utf8') || '{}');
  if (typeof req.body === 'string') return JSON.parse(req.body || '{}');
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
}

function clean(value, max = 500) {
  return String(value || '').trim().slice(0, max);
}

function promoCodeForSession(sessionId) {
  const prefix = clean(process.env.REL8TION_WEBSITE_PROMO_PREFIX || 'R8WEB', 18)
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '') || 'R8WEB';
  const digest = createHash('sha256')
    .update(`${sessionId}:${process.env.REL8TION_WEBSITE_PROMO_SALT || 'rel8tion-open-house-kit'}`)
    .digest('hex')
    .slice(0, 8)
    .toUpperCase();
  return `${prefix}-${digest}`;
}

function websiteUrlWithCode(code) {
  const base = clean(process.env.REL8TION_WEBSITE_BUILDER_URL || DEFAULT_WEBSITE_BUILDER_URL);
  const url = new URL(base);
  url.searchParams.set('promo', code);
  url.searchParams.set('source', 'open_house_kit');
  return url.toString();
}

async function stripeRequest(path, { method = 'GET', body = null } = {}) {
  const secretKey = process.env.STRIPE_SECRET_KEY;
  if (!secretKey) {
    const error = new Error('Stripe is not configured.');
    error.status = 501;
    throw error;
  }
  const response = await fetch(`https://api.stripe.com/v1/${path.replace(/^\/+/, '')}`, {
    method,
    headers: {
      Authorization: `Bearer ${secretKey}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      'Stripe-Version': STRIPE_API_VERSION
    },
    body
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data?.error?.message || `Stripe request failed: ${response.status}`);
    error.status = response.status;
    error.payload = data;
    throw error;
  }
  return data;
}

function isEligibleOpenHouseKitSession(session) {
  const metadata = session?.metadata || {};
  const source = clean(metadata.source).toLowerCase();
  const product = clean(metadata.product).toLowerCase();
  const plan = clean(metadata.plan).toLowerCase();
  return Boolean(
    source.includes('open_house_kit') ||
    product.includes('open_house_kit') ||
    ['monthly', 'annual'].includes(plan)
  );
}

function isPaidSession(session) {
  return session?.payment_status === 'paid' || session?.payment_status === 'no_payment_required';
}

async function maybeCreateStripePromotionCode({ code, session }) {
  const couponId = clean(process.env.STRIPE_WEBSITE_PROMO_COUPON_ID, 120);
  if (!couponId) return { configured: false };

  const existing = await stripeRequest(`promotion_codes?code=${encodeURIComponent(code)}&limit=1`);
  if (Array.isArray(existing.data) && existing.data[0]) {
    return {
      configured: true,
      id: existing.data[0].id,
      reused: true
    };
  }

  const params = new URLSearchParams();
  params.set('coupon', couponId);
  params.set('code', code);
  params.set('active', 'true');
  params.set('max_redemptions', '1');
  params.set('metadata[source]', 'open_house_kit_checkout');
  params.set('metadata[checkout_session_id]', session.id);
  params.set('metadata[agent_slug]', clean(session.metadata?.agent_slug, 120));
  params.set('metadata[email]', clean(session.customer_details?.email || session.customer_email || session.metadata?.email, 120));

  const created = await stripeRequest('promotion_codes', {
    method: 'POST',
    body: params
  });

  return {
    configured: true,
    id: created.id,
    reused: false
  };
}

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    res.setHeader('Allow', 'POST, OPTIONS');
    res.statusCode = 204;
    return res.end();
  }

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST, OPTIONS');
    return sendJson(res, 405, { ok: false, error: 'Method not allowed.' });
  }

  try {
    const body = await readBody(req);
    const sessionId = clean(body.session_id || body.sessionId, 160);
    if (!/^cs_(test|live)_[A-Za-z0-9]+/.test(sessionId)) {
      return sendJson(res, 400, { ok: false, error: 'Missing or invalid Checkout Session id.' });
    }

    const session = await stripeRequest(`checkout/sessions/${encodeURIComponent(sessionId)}`);
    if (!isEligibleOpenHouseKitSession(session)) {
      return sendJson(res, 403, { ok: false, error: 'This checkout session is not eligible for a Rel8tion website promo.' });
    }
    if (!isPaidSession(session)) {
      return sendJson(res, 402, { ok: false, error: 'Checkout payment is not complete yet.' });
    }

    const code = promoCodeForSession(session.id);
    let stripePromotion = { configured: false };
    try {
      stripePromotion = await maybeCreateStripePromotionCode({ code, session });
    } catch (error) {
      stripePromotion = {
        configured: true,
        error: error.message || 'Stripe promotion code could not be created.'
      };
    }

    return sendJson(res, 200, {
      ok: true,
      code,
      website_url: websiteUrlWithCode(code),
      label: clean(process.env.REL8TION_WEBSITE_PROMO_LABEL || 'Rel8tion website builder bundle rate: $10/month or $100/year', 160),
      stripe_promotion_code_id: stripePromotion.id || null,
      stripe_promotion_configured: Boolean(stripePromotion.configured),
      stripe_promotion_reused: Boolean(stripePromotion.reused),
      warning: stripePromotion.error || null
    });
  } catch (error) {
    return sendJson(res, error.status || 500, {
      ok: false,
      error: error.message || 'Website promo code could not be prepared.'
    });
  }
};
