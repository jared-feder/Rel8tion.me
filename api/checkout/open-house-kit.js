const STRIPE_API_VERSION = '2026-02-25.clover';
const DEFAULT_OPEN_HOUSE_KIT_PRICE_ID = 'price_1TYtd12LIj1DZULXtTeeeYSm';
const DEFAULT_EVENT_PASS_MONTHLY_PRICE_ID = 'price_1TYtd52LIj1DZULX8ipqLz9X';
const DEFAULT_EVENT_PASS_ANNUAL_PRICE_ID = 'price_1TYtd62LIj1DZULXy58hBZ0I';
const SUMMER_OPEN_HOUSE_KIT_PRICE_ID = 'price_1TtDAM2LIj1DZULXov7KGURt';
const SUMMER_EVENT_PASS_MONTHLY_PRICE_ID = 'price_1TtDAW2LIj1DZULXxOIiYamd';
const SUMMER_EVENT_PASS_ANNUAL_PRICE_ID = 'price_1TuYbn2LIj1DZULXhpSPApNX';
const SUMMER_PROMOTION_KEY = 'summer_2026';
const SUMMER_PROMOTION_END = '2026-09-22T23:59:59-04:00';
const SUMMER_MONTHLY_TRIAL_DAYS = 31;
const REL8TION_LOGO_URL = 'https://rel8tion.me/wp-content/uploads/2026/04/logo150x100trans.png';
const FULFILLMENT_MESSAGE = 'Open House Kit fulfillment: expected arrival within 14 days. Summer promotional subscribers keep their selected service rate while the subscription remains active. Future REL8TION software-platform upgrades are included at no added subscription charge; replacement hardware and third-party services are excluded.';
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

function cleanReturnPath(value, fallback = '/open-house-kit') {
  const raw = String(value || '').trim();
  if (!raw || !raw.startsWith('/') || raw.startsWith('//')) return fallback;
  return raw.slice(0, 220);
}

function appendQuery(path, query) {
  return `${path}${path.includes('?') ? '&' : '?'}${query}`;
}

function summerPromotion() {
  const endsAt = process.env.STRIPE_SUMMER_PROMOTION_END || SUMMER_PROMOTION_END;
  const endTime = Date.parse(endsAt);
  return {
    key: SUMMER_PROMOTION_KEY,
    active: Number.isFinite(endTime) && Date.now() <= endTime,
    ends_at: endsAt,
    monthly_trial_days: SUMMER_MONTHLY_TRIAL_DAYS,
    rate_lock: 'while_subscription_remains_active',
    future_platform_upgrades_included: true,
    website_builder_included_with_annual: true,
    exclusions: ['replacement_hardware', 'third_party_services']
  };
}

function configuredPriceIds(promotion = summerPromotion()) {
  if (promotion.active) {
    return {
      kit: firstEnv(['STRIPE_SUMMER_OPEN_HOUSE_KIT_PRICE_ID']) || SUMMER_OPEN_HOUSE_KIT_PRICE_ID,
      monthly: firstEnv(['STRIPE_SUMMER_EVENT_PASS_MONTHLY_PRICE_ID']) || SUMMER_EVENT_PASS_MONTHLY_PRICE_ID,
      annual: firstEnv(['STRIPE_SUMMER_EVENT_PASS_ANNUAL_PRICE_ID']) || SUMMER_EVENT_PASS_ANNUAL_PRICE_ID
    };
  }
  return {
    kit: firstEnv(['STRIPE_OPEN_HOUSE_KIT_PRICE_ID', 'OPEN_HOUSE_KIT_PRICE_ID']) || DEFAULT_OPEN_HOUSE_KIT_PRICE_ID,
    monthly: firstEnv(PLANS.monthly.priceEnv) || PLANS.monthly.defaultPriceId,
    annual: firstEnv(PLANS.annual.priceEnv) || PLANS.annual.defaultPriceId
  };
}

function publicProduct(product) {
  if (!product || typeof product !== 'object') return null;
  const text = (value, maxLength) => String(value || '').trim().slice(0, maxLength);
  const images = Array.isArray(product.images)
    ? product.images
      .map((value) => text(value, 1000))
      .filter((value) => /^https:\/\//i.test(value))
      .slice(0, 3)
    : [];
  const features = Array.isArray(product.marketing_features)
    ? product.marketing_features
      .map((feature) => text(feature?.name, 160))
      .filter(Boolean)
      .slice(0, 8)
    : [];

  return {
    name: text(product.name, 160),
    description: text(product.description, 1200),
    images,
    features
  };
}

async function fetchStripePrice(priceId, secretKey) {
  const stripeRes = await fetch(`https://api.stripe.com/v1/prices/${encodeURIComponent(priceId)}?expand%5B%5D=product`, {
    headers: {
      Authorization: `Bearer ${secretKey}`,
      'Stripe-Version': STRIPE_API_VERSION
    }
  });
  const data = await stripeRes.json().catch(() => ({}));
  if (!stripeRes.ok || !Number.isInteger(data.unit_amount) || !data.currency) {
    throw new Error('Stripe pricing is unavailable.');
  }
  return {
    amount: data.unit_amount,
    currency: String(data.currency).toLowerCase(),
    type: data.type || (data.recurring ? 'recurring' : 'one_time'),
    interval: data.recurring?.interval || null,
    interval_count: Number(data.recurring?.interval_count || 1),
    product: publicProduct(data.product)
  };
}

async function sendPublicPricing(res) {
  const secretKey = process.env.STRIPE_SECRET_KEY;
  const promotion = summerPromotion();
  const priceIds = configuredPriceIds(promotion);
  if (!secretKey || !priceIds.kit || !priceIds.monthly || !priceIds.annual) {
    return sendJson(res, 503, { ok: false, error: 'Current pricing is temporarily unavailable.' });
  }

  try {
    const [kit, monthly, annual] = await Promise.all([
      fetchStripePrice(priceIds.kit, secretKey),
      fetchStripePrice(priceIds.monthly, secretKey),
      fetchStripePrice(priceIds.annual, secretKey)
    ]);
    const sameCurrency = kit.currency === monthly.currency && kit.currency === annual.currency;
    const expectedCadence = !kit.interval
      && monthly.interval === 'month'
      && monthly.interval_count === 1
      && annual.interval === 'year'
      && annual.interval_count === 1;
    if (!sameCurrency || !expectedCadence) throw new Error('Stripe pricing is inconsistent.');
    res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=3600');
    return sendJson(res, 200, {
      ok: true,
      currency: kit.currency,
      promotion,
      kit,
      monthly: {
        ...monthly,
        due_today: promotion.active ? kit.amount : kit.amount + monthly.amount,
        trial_days: promotion.active ? promotion.monthly_trial_days : 0,
        first_recurring_charge_days: promotion.active ? promotion.monthly_trial_days : 0
      },
      annual: {
        ...annual,
        due_today: kit.amount + annual.amount,
        website_builder_included: promotion.active
      }
    });
  } catch (error) {
    return sendJson(res, 502, { ok: false, error: 'Current pricing is temporarily unavailable.' });
  }
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
  const requestOrigin = String(req.headers.origin || '');
  if (['https://rel8tion.me', 'https://www.rel8tion.me', 'https://getrel8tion.com', 'https://www.getrel8tion.com', 'https://app.rel8tion.me'].includes(requestOrigin)) {
    res.setHeader('Access-Control-Allow-Origin', requestOrigin);
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') {
    res.setHeader('Allow', 'GET, POST, OPTIONS');
    res.statusCode = 204;
    return res.end();
  }

  if (req.method === 'GET') {
    return sendPublicPricing(res);
  }

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST, OPTIONS');
    return sendJson(res, 405, { ok: false, error: 'Method not allowed' });
  }

  const body = await readBody(req);
  const plan = getPlan(body.plan);
  const promotion = summerPromotion();
  const requiresDynamicMetadata = body.source === 'getrel8tion_open_house_kit' || body.uid || body.agent_id || body.agent_slug;
  const paymentLink = promotion.active || requiresDynamicMetadata ? '' : firstEnv(plan.paymentLinkEnv);
  if (paymentLink) {
    return sendJson(res, 200, { ok: true, plan: plan.key, mode: 'payment_link', url: paymentLink });
  }

  const secretKey = process.env.STRIPE_SECRET_KEY;
  const priceIds = configuredPriceIds(promotion);
  const servicePriceId = priceIds[plan.key];
  const kitPriceId = priceIds.kit;

  if (!secretKey || !servicePriceId || !kitPriceId) {
    return sendJson(res, 501, {
      ok: false,
      plan: plan.key,
      error: `${plan.label} checkout is not configured yet.`,
      setup: 'Set STRIPE_SECRET_KEY and verify the active Open House Kit Price configuration.'
    });
  }

  const origin = getOrigin(req);
  const checkoutParams = new URLSearchParams();
  const referenceParts = [cleanMetadataValue(body.agent, 80), cleanMetadataValue(body.event, 80)].filter(Boolean);
  const defaultReturnPath = body.source === 'getrel8tion_open_house_kit' ? '/kit-intake' : '/open-house-kit';
  const returnPath = cleanReturnPath(body.return_path, defaultReturnPath);
  const successQuery = `success=1&plan=${encodeURIComponent(plan.key)}&session_id={CHECKOUT_SESSION_ID}`;
  const cancelQuery = `canceled=1&plan=${encodeURIComponent(plan.key)}`;

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
  checkoutParams.set('success_url', `${origin}${appendQuery(returnPath, successQuery)}`);
  checkoutParams.set('cancel_url', `${origin}${appendQuery(returnPath, cancelQuery)}`);
  checkoutParams.set('metadata[plan]', plan.key);
  checkoutParams.set('metadata[plan_label]', plan.label);
  checkoutParams.set('metadata[source]', cleanMetadataValue(body.source || 'open_house_kit'));
  checkoutParams.set('metadata[flow]', cleanMetadataValue(body.flow, 80));
  checkoutParams.set('metadata[uid]', cleanMetadataValue(body.uid, 120));
  checkoutParams.set('metadata[agent_id]', cleanMetadataValue(body.agent_id, 120));
  checkoutParams.set('metadata[agent_slug]', cleanMetadataValue(body.agent_slug, 120));
  checkoutParams.set('metadata[sponsor_profile_id]', cleanMetadataValue(body.sponsor_profile_id, 120));
  checkoutParams.set('metadata[product]', cleanMetadataValue(body.product || body.selected_product || 'open_house_kit', 120));
  checkoutParams.set('metadata[brokerage]', cleanMetadataValue(body.brokerage, 160));
  checkoutParams.set('metadata[sponsor_name]', cleanMetadataValue(body.sponsor_name, 160));
  checkoutParams.set('metadata[sponsor_company]', cleanMetadataValue(body.sponsor_company, 160));
  checkoutParams.set('metadata[notes]', cleanMetadataValue(body.notes));
  checkoutParams.set('metadata[agent]', cleanMetadataValue(body.agent, 120));
  checkoutParams.set('metadata[event]', cleanMetadataValue(body.event, 120));
  checkoutParams.set('metadata[sign_id]', cleanMetadataValue(body.sign_id, 120));
  checkoutParams.set('metadata[address]', cleanMetadataValue(body.address));
  checkoutParams.set('metadata[email]', cleanMetadataValue(body.email, 120));
  checkoutParams.set('metadata[phone]', cleanMetadataValue(body.phone, 80));
  checkoutParams.set('metadata[promotion]', promotion.active ? promotion.key : 'standard');
  checkoutParams.set('metadata[rate_lock]', promotion.active ? promotion.rate_lock : '');
  checkoutParams.set('metadata[future_platform_upgrades_included]', promotion.active ? 'true' : 'false');
  checkoutParams.set('metadata[website_builder_included]', promotion.active && plan.key === 'annual' ? 'true' : 'false');
  if (plan.mode === 'subscription') {
    if (promotion.active && plan.key === 'monthly') {
      checkoutParams.set('subscription_data[trial_period_days]', String(promotion.monthly_trial_days));
    }
    checkoutParams.set('subscription_data[metadata][plan]', plan.key);
    checkoutParams.set('subscription_data[metadata][source]', cleanMetadataValue(body.source || 'open_house_kit'));
    checkoutParams.set('subscription_data[metadata][flow]', cleanMetadataValue(body.flow, 80));
    checkoutParams.set('subscription_data[metadata][uid]', cleanMetadataValue(body.uid, 120));
    checkoutParams.set('subscription_data[metadata][agent_id]', cleanMetadataValue(body.agent_id, 120));
    checkoutParams.set('subscription_data[metadata][agent_slug]', cleanMetadataValue(body.agent_slug, 120));
    checkoutParams.set('subscription_data[metadata][sponsor_profile_id]', cleanMetadataValue(body.sponsor_profile_id, 120));
    checkoutParams.set('subscription_data[metadata][product]', cleanMetadataValue(body.product || body.selected_product || 'open_house_kit', 120));
    checkoutParams.set('subscription_data[metadata][agent]', cleanMetadataValue(body.agent, 120));
    checkoutParams.set('subscription_data[metadata][event]', cleanMetadataValue(body.event, 120));
    checkoutParams.set('subscription_data[metadata][sign_id]', cleanMetadataValue(body.sign_id, 120));
    checkoutParams.set('subscription_data[metadata][address]', cleanMetadataValue(body.address));
    checkoutParams.set('subscription_data[metadata][promotion]', promotion.active ? promotion.key : 'standard');
    checkoutParams.set('subscription_data[metadata][rate_lock]', promotion.active ? promotion.rate_lock : '');
    checkoutParams.set('subscription_data[metadata][future_platform_upgrades_included]', promotion.active ? 'true' : 'false');
    checkoutParams.set('subscription_data[metadata][website_builder_included]', promotion.active && plan.key === 'annual' ? 'true' : 'false');
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
