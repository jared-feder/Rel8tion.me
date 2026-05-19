const STRIPE_API_VERSION = '2026-02-25.clover';
const DEFAULT_OPEN_HOUSE_KIT_PRICE_ID = 'price_1TYtd12LIj1DZULXtTeeeYSm';
const DEFAULT_EVENT_PASS_MONTHLY_PRICE_ID = 'price_1TYtd52LIj1DZULX8ipqLz9X';
const DEFAULT_EVENT_PASS_ANNUAL_PRICE_ID = 'price_1TYtd62LIj1DZULXy58hBZ0I';
const REL8TION_LOGO_URL = 'https://rel8tion.me/wp-content/uploads/2026/04/logo150x100trans.png';
const FULFILLMENT_MESSAGE = 'Open House Kit fulfillment: expected arrival within 14 days. When local scheduling allows, Moe may personally deliver it sooner and help with the handoff. This is REL8TION Version 1 pricing. More upgrades and improvements are planned, and the selected service rate is intended to lock in this account as pricing rises.';
const PLANS = {
  monthly: {
    key: 'monthly',
    label: 'Open House Kit + Monthly Service',
    mode: 'subscription',
    defaultPriceId: DEFAULT_EVENT_PASS_MONTHLY_PRICE_ID,
    paymentLinkEnv: ['STRIPE_OPEN_HOUSE_KIT_MONTHLY_PAYMENT_LINK'],
    priceEnv: ['STRIPE_EVENT_PASS_MONTHLY_PRICE_ID', 'STRIPE_REL8TION_MONTHLY_PRICE_ID', 'OPEN_HOUSE_MONTHLY_PRICE_ID']
  },
  annual: {
    key: 'annual',
    label: 'Open House Kit + Annual Service',
    mode: 'subscription',
    defaultPriceId: DEFAULT_EVENT_PASS_ANNUAL_PRICE_ID,
    paymentLinkEnv: ['STRIPE_OPEN_HOUSE_KIT_ANNUAL_PAYMENT_LINK', 'STRIPE_OPEN_HOUSE_KIT_YEARLY_PAYMENT_LINK'],
    priceEnv: ['STRIPE_EVENT_PASS_ANNUAL_PRICE_ID', 'STRIPE_EVENT_PASS_YEARLY_PRICE_ID', 'STRIPE_REL8TION_ANNUAL_PRICE_ID', 'OPEN_HOUSE_ANNUAL_PRICE_ID']
  }
};

function sendJson(res, status, payload) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(payload));
}

function getOrigin(req) {
  const proto = req.headers['x-forwarded-proto'] || 'https';
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  return `${proto}://${host}`;
}

function cleanMetadataValue(value, maxLength = 450) {
  return String(value || '').trim().slice(0, maxLength);
}

function firstEnv(names) {
  for (const name of names) {
    if (process.env[name]) return process.env[name];
  }
  return '';
}

function getPlan(planKey) {
  const normalized = String(planKey || '').toLowerCase();
  if (normalized === 'annual' || normalized === 'yearly' || normalized === 'year') return PLANS.annual;
  return PLANS.monthly;
}

async function readBody(req) {
  if (req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body)) return req.body;
  if (Buffer.isBuffer(req.body)) {
    try {
      return JSON.parse(req.body.toString('utf8'));
    } catch (error) {
      return {};
    }
  }
  if (typeof req.body === 'string') {
    try {
      return JSON.parse(req.body);
    } catch (error) {
      return {};
    }
  }
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch (error) {
    return {};
  }
}

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    res.setHeader('Allow', 'POST, OPTIONS');
    res.statusCode = 204;
    return res.end();
  }

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST, OPTIONS');
    return sendJson(res, 405, { ok: false, error: 'Method not allowed' });
  }

  const body = await readBody(req);
  const plan = getPlan(body.plan);
  const paymentLink = firstEnv(plan.paymentLinkEnv);
  if (paymentLink) {
    return sendJson(res, 200, { ok: true, plan: plan.key, mode: 'payment_link', url: paymentLink });
  }

  const secretKey = process.env.STRIPE_SECRET_KEY;
  const servicePriceId = firstEnv(plan.priceEnv) || plan.defaultPriceId;
  const kitPriceId = firstEnv(['STRIPE_OPEN_HOUSE_KIT_PRICE_ID', 'OPEN_HOUSE_KIT_PRICE_ID']) || DEFAULT_OPEN_HOUSE_KIT_PRICE_ID;

  if (!secretKey || !servicePriceId || !kitPriceId) {
    return sendJson(res, 501, {
      ok: false,
      plan: plan.key,
      error: `${plan.label} checkout is not configured yet.`,
      setup: plan.key === 'monthly'
        ? 'Set STRIPE_SECRET_KEY. Monthly service defaults to price_1TYtd52LIj1DZULX8ipqLz9X unless STRIPE_EVENT_PASS_MONTHLY_PRICE_ID is set.'
        : 'Set STRIPE_SECRET_KEY. Annual service defaults to price_1TYtd62LIj1DZULXy58hBZ0I unless STRIPE_EVENT_PASS_ANNUAL_PRICE_ID is set.'
    });
  }

  const origin = getOrigin(req);
  const checkoutParams = new URLSearchParams();
  const referenceParts = [cleanMetadataValue(body.agent, 80), cleanMetadataValue(body.event, 80)].filter(Boolean);

  checkoutParams.set('mode', plan.mode);
  checkoutParams.set('line_items[0][price]', kitPriceId);
  checkoutParams.set('line_items[0][quantity]', '1');
  checkoutParams.set('line_items[1][price]', servicePriceId);
  checkoutParams.set('line_items[1][quantity]', '1');
  checkoutParams.set('billing_address_collection', 'auto');
  checkoutParams.set('allow_promotion_codes', 'true');
  checkoutParams.set('phone_number_collection[enabled]', 'true');
  checkoutParams.set('shipping_address_collection[allowed_countries][0]', 'US');
  checkoutParams.set('branding_settings[display_name]', 'REL8TION Open House Kit');
  checkoutParams.set('branding_settings[background_color]', '#eef8ff');
  checkoutParams.set('branding_settings[button_color]', '#172c76');
  checkoutParams.set('branding_settings[border_style]', 'pill');
  checkoutParams.set('branding_settings[logo][type]', 'url');
  checkoutParams.set('branding_settings[logo][url]', REL8TION_LOGO_URL);
  checkoutParams.set('custom_text[submit][message]', FULFILLMENT_MESSAGE);
  checkoutParams.set('custom_text[after_submit][message]', 'After payment, REL8TION will use the contact and shipping details from Checkout to prepare the kit and service handoff.');
  checkoutParams.set('custom_text[shipping_address][message]', 'Use the best delivery address for the Open House Kit. Kits are expected to arrive within 14 days, or sooner when Moe can personally deliver.');
  checkoutParams.set('success_url', `${origin}/open-house-kit?success=1&plan=${encodeURIComponent(plan.key)}&session_id={CHECKOUT_SESSION_ID}`);
  checkoutParams.set('cancel_url', `${origin}/open-house-kit?canceled=1&plan=${encodeURIComponent(plan.key)}`);
  checkoutParams.set('metadata[plan]', plan.key);
  checkoutParams.set('metadata[plan_label]', plan.label);
  checkoutParams.set('metadata[source]', cleanMetadataValue(body.source || 'open_house_kit'));
  checkoutParams.set('metadata[agent]', cleanMetadataValue(body.agent, 120));
  checkoutParams.set('metadata[event]', cleanMetadataValue(body.event, 120));
  checkoutParams.set('metadata[sign_id]', cleanMetadataValue(body.sign_id, 120));
  checkoutParams.set('metadata[address]', cleanMetadataValue(body.address));
  checkoutParams.set('metadata[email]', cleanMetadataValue(body.email, 120));
  checkoutParams.set('metadata[phone]', cleanMetadataValue(body.phone, 80));
  if (plan.mode === 'subscription') {
    checkoutParams.set('subscription_data[metadata][plan]', plan.key);
    checkoutParams.set('subscription_data[metadata][source]', cleanMetadataValue(body.source || 'open_house_kit'));
    checkoutParams.set('subscription_data[metadata][agent]', cleanMetadataValue(body.agent, 120));
    checkoutParams.set('subscription_data[metadata][event]', cleanMetadataValue(body.event, 120));
    checkoutParams.set('subscription_data[metadata][sign_id]', cleanMetadataValue(body.sign_id, 120));
    checkoutParams.set('subscription_data[metadata][address]', cleanMetadataValue(body.address));
  }
  if (referenceParts.length) checkoutParams.set('client_reference_id', referenceParts.join(':'));
  if (body.email) checkoutParams.set('customer_email', cleanMetadataValue(body.email, 120));

  try {
    const stripeRes = await fetch('https://api.stripe.com/v1/checkout/sessions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${secretKey}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        'Stripe-Version': STRIPE_API_VERSION
      },
      body: checkoutParams
    });
    const data = await stripeRes.json().catch(() => ({}));

    if (!stripeRes.ok || !data.url) {
      return sendJson(res, stripeRes.status || 502, {
        ok: false,
        error: data?.error?.message || 'Stripe checkout could not be started.'
      });
    }

    return sendJson(res, 200, { ok: true, plan: plan.key, mode: 'checkout_session', id: data.id, url: data.url });
  } catch (error) {
    return sendJson(res, 502, { ok: false, error: 'Stripe checkout is temporarily unavailable.' });
  }
};
