const { sendJson, supabaseRest } = require('../lib/admin-auth');
const { getProduct, readPricingCatalog } = require('../lib/pricing-catalog');

function clean(value, max = 300) {
  return String(value || '').trim().slice(0, max);
}

function enc(value) {
  return encodeURIComponent(clean(value));
}

function one(rows) {
  return Array.isArray(rows) ? rows[0] || null : null;
}

function isAgentMembership(row = {}) {
  const codes = Array.isArray(row.entitlement_codes) ? row.entitlement_codes : [];
  return row.status === 'active'
    && row.role === 'real_estate_agent'
    && codes.includes('agent_dashboard')
    && codes.includes('digital_card');
}

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return sendJson(res, 405, { ok: false, error: 'Method not allowed.' });
  }

  try {
    const agentSlug = clean(req.query?.agent_slug || req.query?.agent, 160);
    const uid = clean(req.query?.uid, 200);
    if (!agentSlug || !uid) return sendJson(res, 400, { ok: false, error: 'Missing agent or NFC UID.' });

    const key = one(await supabaseRest(
      `keys?uid=eq.${enc(uid)}&agent_slug=eq.${enc(agentSlug)}&claimed=eq.true&select=uid,agent_slug,device_role&limit=1`
    ));
    if (!key) return sendJson(res, 403, { ok: false, error: 'This NFC device is not claimed by this agent.' });

    const rows = await supabaseRest(
      `pricing_entitlements?subject_slug=eq.${enc(agentSlug)}&role=eq.real_estate_agent&status=eq.active&select=plan_code,role,status,entitlement_codes,digital_card_included,updated_at&order=updated_at.desc&limit=10`
    );
    const entitlement = (Array.isArray(rows) ? rows : []).find(isAgentMembership) || null;
    const deviceRole = clean(key.device_role, 80).toLowerCase();
    const monthlyPlan = getProduct(readPricingCatalog(), 'rel8tion_agent_monthly');
    let eventPassCode = null;
    if (deviceRole === 'event_pass_keychain') {
      const signs = await supabaseRest(
        `smart_signs?activation_uid_primary=eq.${enc(uid)}&activation_method=eq.event_pass_keychain&select=public_code&order=created_at.desc&limit=1`
      ).catch(() => []);
      eventPassCode = clean(one(signs)?.public_code, 160) || null;
    }

    return sendJson(res, 200, {
      ok: true,
      active: Boolean(entitlement),
      checkout_required: !entitlement,
      event_pass_device: deviceRole === 'event_pass_keychain',
      event_pass_code: eventPassCode,
      checkout_plan_code: monthlyPlan.code,
      checkout_label: `$${(monthlyPlan.amount_cents / 100).toFixed(0)}/month`,
      plan_code: entitlement?.plan_code || null
    });
  } catch (error) {
    return sendJson(res, error.status || 500, { ok: false, error: error.message || 'Membership status could not be verified.' });
  }
};

module.exports.isAgentMembership = isAgentMembership;
