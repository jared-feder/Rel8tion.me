const { sendJson, supabaseRest } = require('../../lib/admin-auth');
const stripeWebhook = require('./stripe-webhook');

const STRIPE_API_VERSION = '2026-06-24.dahlia';
const AGENT_PLANS = new Set(['rel8tion_agent_monthly', 'rel8tion_agent_annual']);

function clean(value, max = 500) {
  return String(value || '').trim().slice(0, max);
}

function enc(value) {
  return encodeURIComponent(clean(value));
}

function redirect(res, location) {
  res.statusCode = 303;
  res.setHeader('Location', location);
  res.setHeader('Cache-Control', 'no-store');
  return res.end();
}

function localReturnPath(value, fallback) {
  const candidate = clean(value, 700);
  return candidate.startsWith('/') && !candidate.startsWith('//') ? candidate : fallback;
}

function withNotice(path, key, value) {
  const joiner = path.includes('?') ? '&' : '?';
  return `${path}${joiner}${encodeURIComponent(key)}=${encodeURIComponent(value)}`;
}

async function loadCheckoutSession(sessionId, secretKey) {
  const response = await fetch(`https://api.stripe.com/v1/checkout/sessions/${encodeURIComponent(sessionId)}`, {
    headers: {
      Authorization: `Bearer ${secretKey}`,
      'Stripe-Version': STRIPE_API_VERSION
    }
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(payload?.error?.message || `Stripe session lookup failed: ${response.status}`);
    error.status = response.status;
    throw error;
  }
  return payload;
}

async function verifyClaimSubject(metadata = {}) {
  const uid = clean(metadata.uid, 200);
  const agentSlug = clean(metadata.agent_slug, 160);
  if (!uid || !agentSlug) throw Object.assign(new Error('Checkout is missing the claimed NFC identity.'), { status: 409 });
  const rows = await supabaseRest(
    `keys?uid=eq.${enc(uid)}&agent_slug=eq.${enc(agentSlug)}&claimed=eq.true&select=uid,agent_slug,device_role&limit=1`
  );
  if (!Array.isArray(rows) || !rows[0]) throw Object.assign(new Error('The paid checkout does not match a claimed agent NFC device.'), { status: 403 });
  return { uid, agentSlug };
}

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return sendJson(res, 405, { ok: false, error: 'Method not allowed.' });
  }

  let subject = null;
  let returnPath = '';
  try {
    const sessionId = clean(req.query?.session_id, 200);
    const secretKey = clean(process.env.STRIPE_SECRET_KEY, 1000);
    if (!sessionId || !secretKey) throw Object.assign(new Error('Membership checkout verification is not configured.'), { status: 501 });

    const session = await loadCheckoutSession(sessionId, secretKey);
    const metadata = session.metadata || {};
    returnPath = localReturnPath(metadata.return_path, '');
    if (session.object !== 'checkout.session'
      || session.mode !== 'subscription'
      || !['paid', 'no_payment_required'].includes(clean(session.payment_status, 80))
      || clean(metadata.role, 80) !== 'real_estate_agent'
      || !AGENT_PLANS.has(clean(metadata.plan_code, 100))) {
      throw Object.assign(new Error('This Checkout Session does not grant a REL8TION Agent membership.'), { status: 409 });
    }

    subject = await verifyClaimSubject(metadata);
    const event = {
      id: `browser_return_${session.id}`,
      type: 'checkout.session.completed',
      created: session.created,
      data: { object: session }
    };
    const entitlement = stripeWebhook.pricingEntitlementPayload(event, session);
    if (!entitlement) throw Object.assign(new Error('Stripe did not return the required membership entitlement.'), { status: 409 });
    await stripeWebhook.upsertPricingEntitlement(entitlement);

    const destination = returnPath || `/agent-home?agent=${encodeURIComponent(subject.agentSlug)}&uid=${encodeURIComponent(subject.uid)}`;
    return redirect(res, withNotice(destination, 'membership', 'active'));
  } catch (error) {
    const agentSlug = subject?.agentSlug || clean(req.query?.agent, 160);
    const uid = subject?.uid || clean(req.query?.uid, 200);
    if (agentSlug && uid) {
      const destination = returnPath || `/agent-home?agent=${encodeURIComponent(agentSlug)}&uid=${encodeURIComponent(uid)}`;
      return redirect(res, withNotice(destination, 'membership_error', error.message || 'Checkout verification failed.'));
    }
    return sendJson(res, error.status || 500, { ok: false, error: error.message || 'Membership checkout could not be verified.' });
  }
};

module.exports.loadCheckoutSession = loadCheckoutSession;
module.exports.localReturnPath = localReturnPath;
module.exports.verifyClaimSubject = verifyClaimSubject;
module.exports.withNotice = withNotice;
