const STRIPE_API_VERSION = '2026-02-25.clover';

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

  const paymentLink = process.env.STRIPE_OPEN_HOUSE_KIT_PAYMENT_LINK || process.env.OPEN_HOUSE_KIT_PAYMENT_LINK;
  if (paymentLink) {
    return sendJson(res, 200, { ok: true, mode: 'payment_link', url: paymentLink });
  }

  const secretKey = process.env.STRIPE_SECRET_KEY;
  const priceId = process.env.STRIPE_OPEN_HOUSE_KIT_PRICE_ID || process.env.OPEN_HOUSE_KIT_PRICE_ID;

  if (!secretKey || !priceId) {
    return sendJson(res, 501, {
      ok: false,
      error: 'Open House Kit checkout is not configured yet.',
      setup: 'Set STRIPE_OPEN_HOUSE_KIT_PAYMENT_LINK, or set STRIPE_SECRET_KEY and STRIPE_OPEN_HOUSE_KIT_PRICE_ID.'
    });
  }

  const body = await readBody(req);
  const origin = getOrigin(req);
  const checkoutParams = new URLSearchParams();
  const referenceParts = [cleanMetadataValue(body.agent, 80), cleanMetadataValue(body.event, 80)].filter(Boolean);

  checkoutParams.set('mode', 'payment');
  checkoutParams.set('line_items[0][price]', priceId);
  checkoutParams.set('line_items[0][quantity]', '1');
  checkoutParams.set('billing_address_collection', 'auto');
  checkoutParams.set('allow_promotion_codes', 'true');
  checkoutParams.set('success_url', `${origin}/open-house-kit?success=1&session_id={CHECKOUT_SESSION_ID}`);
  checkoutParams.set('cancel_url', `${origin}/open-house-kit?canceled=1`);
  checkoutParams.set('metadata[source]', cleanMetadataValue(body.source || 'open_house_kit'));
  checkoutParams.set('metadata[agent]', cleanMetadataValue(body.agent, 120));
  checkoutParams.set('metadata[event]', cleanMetadataValue(body.event, 120));
  checkoutParams.set('metadata[sign_id]', cleanMetadataValue(body.sign_id, 120));
  checkoutParams.set('metadata[address]', cleanMetadataValue(body.address));
  checkoutParams.set('metadata[email]', cleanMetadataValue(body.email, 120));
  checkoutParams.set('metadata[phone]', cleanMetadataValue(body.phone, 80));
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

    return sendJson(res, 200, { ok: true, mode: 'checkout_session', id: data.id, url: data.url });
  } catch (error) {
    return sendJson(res, 502, { ok: false, error: 'Stripe checkout is temporarily unavailable.' });
  }
};
