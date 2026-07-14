const { supabaseRest } = require('../../lib/admin-auth');
const kit = require('../../lib/open-house-kit');

const STRIPE_API_VERSION = '2026-02-25.clover';

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

function normalizePhone(value) {
  const digits = clean(value, 80).replace(/\D/g, '');
  if (digits.length === 11 && digits.startsWith('1')) return digits.slice(1);
  return digits;
}

function timestampFromSeconds(value) {
  const seconds = Number(value);
  if (!Number.isFinite(seconds) || seconds <= 0) return null;
  return new Date(seconds * 1000).toISOString();
}

function compactAddress(address = {}) {
  return [
    address.line1,
    address.line2,
    [address.city, address.state, address.postal_code].filter(Boolean).join(' '),
    address.country
  ].map((part) => clean(part, 180)).filter(Boolean).join(', ');
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

function buildOrderPayload(session) {
  const metadata = session.metadata || {};
  const customer = session.customer_details || {};
  const shipping = session.shipping_details || {};
  const shippingAddress = shipping.address || {};
  const customerAddress = customer.address || {};
  const address = Object.keys(shippingAddress).length ? shippingAddress : customerAddress;
  const status = session.payment_status === 'no_payment_required' ? 'no_payment_required' : 'paid';
  const email = clean(customer.email || session.customer_email || metadata.email, 320).toLowerCase();
  const phone = clean(customer.phone || metadata.phone, 80);

  return {
    stripe_checkout_session_id: clean(session.id, 160),
    last_stripe_event_type: 'checkout_success_return',
    stripe_subscription_id: clean(session.subscription, 160) || null,
    stripe_customer_id: clean(session.customer, 160) || null,
    stripe_payment_intent_id: clean(session.payment_intent, 160) || null,
    status,
    fulfillment_status: 'needs_review',
    plan: clean(metadata.plan || 'unknown', 80),
    product: clean(metadata.product, 120) || null,
    source: clean(metadata.source, 120) || null,
    flow: clean(metadata.flow, 120) || null,
    uid: clean(metadata.uid, 160) || null,
    agent_id: clean(metadata.agent_id, 160) || null,
    agent_slug: clean(metadata.agent_slug, 160) || null,
    agent_name: clean(metadata.agent, 180) || null,
    brokerage: clean(metadata.brokerage, 180) || null,
    email: email || null,
    phone: phone || null,
    phone_normalized: normalizePhone(phone) || null,
    shipping_name: clean(shipping.name || customer.name, 180) || null,
    shipping_address_line1: clean(address.line1, 240) || null,
    shipping_address_line2: clean(address.line2, 240) || null,
    shipping_city: clean(address.city, 160) || null,
    shipping_state: clean(address.state, 80) || null,
    shipping_postal_code: clean(address.postal_code, 40) || null,
    shipping_country: clean(address.country, 12) || null,
    address_summary: clean(metadata.address || compactAddress(address), 500) || null,
    event_label: clean(metadata.event, 240) || null,
    sign_id: clean(metadata.sign_id, 160) || null,
    sponsor_profile_id: clean(metadata.sponsor_profile_id, 160) || null,
    sponsor_name: clean(metadata.sponsor_name, 180) || null,
    sponsor_company: clean(metadata.sponsor_company, 180) || null,
    notes: clean(metadata.notes, 1000) || null,
    amount_subtotal: Number.isFinite(session.amount_subtotal) ? session.amount_subtotal : null,
    amount_total: Number.isFinite(session.amount_total) ? session.amount_total : null,
    currency: clean(session.currency, 12) || null,
    payment_status: clean(session.payment_status, 80) || null,
    customer_details: customer,
    shipping_details: shipping,
    metadata,
    raw_session: session,
    stripe_created_at: timestampFromSeconds(session.created),
    paid_at: new Date().toISOString()
  };
}

async function upsertOpenHouseKitOrder(session) {
  const rows = await supabaseRest('open_house_kit_orders?on_conflict=stripe_checkout_session_id&select=id,stripe_checkout_session_id,status,fulfillment_status,created_at,updated_at', {
    method: 'POST',
    headers: {
      Prefer: 'resolution=merge-duplicates,return=representation'
    },
    body: JSON.stringify(buildOrderPayload(session))
  });
  return Array.isArray(rows) ? rows[0] || null : null;
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
    if (!kit.isEligibleOpenHouseKitSession(session)) {
      return sendJson(res, 403, { ok: false, error: 'This checkout session is not eligible for a Rel8tion website promo.' });
    }
    if (!kit.isPaidSession(session)) {
      return sendJson(res, 402, { ok: false, error: 'Checkout payment is not complete yet.' });
    }

    const code = kit.websitePromoCodeForSession(session.id);
    const websiteBuilderIncluded = clean(session.metadata?.website_builder_included).toLowerCase() === 'true';
    let stripePromotion = { configured: false };
    try {
      stripePromotion = await maybeCreateStripePromotionCode({ code, session });
    } catch (error) {
      stripePromotion = {
        configured: true,
        error: error.message || 'Stripe promotion code could not be created.'
      };
    }

    let order = null;
    let dashboard = null;
    let welcome = null;
    let orderWarning = '';
    try {
      order = await kit.upsertOpenHouseKitOrder(kit.buildOrderPayloadFromSession(session, {
        eventType: 'checkout_success_return'
      }));
      if (order?.id) {
        const access = await kit.createDashboardAccess(order.id, 'checkout_success', {
          checkout_session_id: session.id
        });
        dashboard = kit.dashboardUrl({
          baseUrl: kit.baseUrlFromReq(req),
          orderId: order.id,
          token: access.token
        });
        welcome = await kit.sendWelcomeNotifications({ order, req });
      }
    } catch (error) {
      orderWarning = error.message || 'Open House Kit order could not be stored.';
    }

    return sendJson(res, 200, {
      ok: true,
      code,
      website_url: kit.websiteBuilderUrlWithCode(code),
      website_builder_included: websiteBuilderIncluded,
      label: websiteBuilderIncluded
        ? 'REL8TION Website Builder included with the Summer 2026 annual bundle'
        : clean(process.env.REL8TION_WEBSITE_PROMO_LABEL || 'Rel8tion website builder bundle rate: $10/month or $100/year', 160),
      order_id: order?.id || null,
      order_fulfillment_status: order?.fulfillment_status || null,
      dashboard_url: dashboard,
      welcome,
      stripe_promotion_code_id: stripePromotion.id || null,
      stripe_promotion_configured: Boolean(stripePromotion.configured),
      stripe_promotion_reused: Boolean(stripePromotion.reused),
      warning: [stripePromotion.error, orderWarning].filter(Boolean).join(' ') || null
    });
  } catch (error) {
    return sendJson(res, error.status || 500, {
      ok: false,
      error: error.message || 'Website promo code could not be prepared.'
    });
  }
};
