const { createHmac, timingSafeEqual } = require('crypto');
const { sendJson, supabaseRest } = require('../../lib/admin-auth');
const kit = require('../../lib/open-house-kit');

const SIGNATURE_TOLERANCE_SECONDS = Number(process.env.STRIPE_WEBHOOK_TOLERANCE_SECONDS || 300);
const SUPPORTED_EVENTS = new Set([
  'checkout.session.completed',
  'checkout.session.async_payment_succeeded',
  'checkout.session.async_payment_failed'
]);

function clean(value, max = 500) {
  return String(value || '').trim().slice(0, max);
}

function readHeader(req, name) {
  return req.headers?.[name] || req.headers?.[name.toLowerCase()] || req.headers?.[name.toUpperCase()] || '';
}

function normalizePhone(value) {
  const digits = clean(value, 80).replace(/\D/g, '');
  if (digits.length === 11 && digits.startsWith('1')) return digits.slice(1);
  return digits;
}

async function readRawBody(req) {
  if (Buffer.isBuffer(req.body)) return req.body;
  if (typeof req.body === 'string') return Buffer.from(req.body, 'utf8');
  if (req.body && typeof req.body === 'object') {
    return Buffer.from(JSON.stringify(req.body), 'utf8');
  }

  const chunks = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

function parseStripeSignature(header) {
  const parts = String(header || '').split(',').map((part) => part.trim()).filter(Boolean);
  const parsed = { timestamp: '', signatures: [] };
  for (const part of parts) {
    const index = part.indexOf('=');
    if (index === -1) continue;
    const key = part.slice(0, index);
    const value = part.slice(index + 1);
    if (key === 't') parsed.timestamp = value;
    if (key === 'v1') parsed.signatures.push(value);
  }
  return parsed;
}

function safeHexEqual(leftHex, rightHex) {
  try {
    const left = Buffer.from(leftHex, 'hex');
    const right = Buffer.from(rightHex, 'hex');
    return left.length === right.length && timingSafeEqual(left, right);
  } catch (_) {
    return false;
  }
}

function verifyStripeSignature(rawBody, header) {
  const secret = clean(process.env.STRIPE_WEBHOOK_SECRET || process.env.STRIPE_OPEN_HOUSE_KIT_WEBHOOK_SECRET, 300);
  if (!secret) {
    const error = new Error('Stripe webhook secret is not configured.');
    error.status = 501;
    throw error;
  }

  const parsed = parseStripeSignature(header);
  const timestamp = Number(parsed.timestamp);
  if (!timestamp || !parsed.signatures.length) {
    const error = new Error('Missing Stripe webhook signature.');
    error.status = 400;
    throw error;
  }

  const ageSeconds = Math.abs(Math.floor(Date.now() / 1000) - timestamp);
  if (Number.isFinite(SIGNATURE_TOLERANCE_SECONDS) && SIGNATURE_TOLERANCE_SECONDS > 0 && ageSeconds > SIGNATURE_TOLERANCE_SECONDS) {
    const error = new Error('Stripe webhook signature timestamp is outside tolerance.');
    error.status = 400;
    throw error;
  }

  const hmac = createHmac('sha256', secret);
  hmac.update(`${timestamp}.`);
  hmac.update(rawBody);
  const expected = hmac.digest('hex');
  if (!parsed.signatures.some((signature) => safeHexEqual(expected, signature))) {
    const error = new Error('Invalid Stripe webhook signature.');
    error.status = 400;
    throw error;
  }
}

function parseEvent(rawBody) {
  try {
    return JSON.parse(rawBody.toString('utf8'));
  } catch (_) {
    const error = new Error('Invalid Stripe webhook body.');
    error.status = 400;
    throw error;
  }
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

function statusForEvent(event, session) {
  if (event.type === 'checkout.session.async_payment_failed') return 'payment_failed';
  if (session?.payment_status === 'paid') return 'paid';
  if (session?.payment_status === 'no_payment_required') return 'no_payment_required';
  return 'payment_pending';
}

function fulfillmentStatusFor(status) {
  if (status === 'paid' || status === 'no_payment_required') return 'needs_review';
  if (status === 'payment_failed') return 'payment_failed';
  return 'payment_pending';
}

function buildOrderPayload(event, session) {
  const metadata = session.metadata || {};
  const customer = session.customer_details || {};
  const shipping = session.shipping_details || {};
  const shippingAddress = shipping.address || {};
  const customerAddress = customer.address || {};
  const address = Object.keys(shippingAddress).length ? shippingAddress : customerAddress;
  const status = statusForEvent(event, session);
  const paid = status === 'paid' || status === 'no_payment_required';
  const email = clean(customer.email || session.customer_email || metadata.email, 320).toLowerCase();
  const phone = clean(customer.phone || metadata.phone, 80);

  return {
    stripe_checkout_session_id: clean(session.id, 160),
    stripe_webhook_event_id: clean(event.id, 160) || null,
    last_stripe_event_type: clean(event.type, 120),
    stripe_subscription_id: clean(session.subscription, 160) || null,
    stripe_customer_id: clean(session.customer, 160) || null,
    stripe_payment_intent_id: clean(session.payment_intent, 160) || null,
    status,
    fulfillment_status: fulfillmentStatusFor(status),
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
    paid_at: paid ? timestampFromSeconds(event.created) || new Date().toISOString() : null
  };
}

async function upsertOrder(order) {
  const rows = await supabaseRest('open_house_kit_orders?on_conflict=stripe_checkout_session_id&select=id,stripe_checkout_session_id,status,fulfillment_status,created_at,updated_at', {
    method: 'POST',
    headers: {
      Prefer: 'resolution=merge-duplicates,return=representation'
    },
    body: JSON.stringify(order)
  });
  return Array.isArray(rows) ? rows[0] || null : null;
}

async function handleStripeEvent(event, req) {
  if (!SUPPORTED_EVENTS.has(event.type)) {
    return { ignored: true, reason: 'unsupported_event_type' };
  }

  const session = event?.data?.object || null;
  if (!session?.id || session.object !== 'checkout.session') {
    return { ignored: true, reason: 'not_checkout_session' };
  }

  if (!kit.isEligibleOpenHouseKitSession(session)) {
    return { ignored: true, reason: 'not_open_house_kit_session', session_id: session.id };
  }

  const order = kit.buildOrderPayloadFromSession(session, {
    eventId: event.id,
    eventType: event.type,
    eventCreated: event.created
  });
  if (!order.stripe_checkout_session_id) {
    const error = new Error('Missing Checkout Session id.');
    error.status = 400;
    throw error;
  }

  const row = await kit.upsertOpenHouseKitOrder(order);
  let welcome = null;
  try {
    welcome = await kit.sendWelcomeNotifications({ order: row, req });
  } catch (error) {
    welcome = { ok: false, error: error.message || 'Welcome notifications failed.' };
  }
  return { ignored: false, order: row, welcome };
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return sendJson(res, 405, { ok: false, error: 'Method not allowed.' });
  }

  try {
    const rawBody = await readRawBody(req);
    verifyStripeSignature(rawBody, readHeader(req, 'stripe-signature'));
    const event = parseEvent(rawBody);
    const result = await handleStripeEvent(event, req);
    return sendJson(res, 200, {
      ok: true,
      event_id: clean(event.id, 160) || null,
      event_type: clean(event.type, 120) || null,
      ...result
    });
  } catch (error) {
    console.error('[stripe-webhook] failed', error);
    return sendJson(res, error.status || 500, {
      ok: false,
      error: error.message || 'Stripe webhook failed.'
    });
  }
};

module.exports.config = {
  api: {
    bodyParser: false
  }
};
