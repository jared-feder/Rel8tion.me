const crypto = require('node:crypto');
const { sendJson, supabaseRest } = require('../lib/admin-auth');

const ACTIONS = {
  home_saved: { event: 'home_saved', label: 'Save This Home' },
  agent_relationship: { event: 'agent_relationship_requested', label: 'I Want This Agent To Help Me' },
  similar_homes: { event: 'similar_homes_requested', label: 'Show Me Similar Homes' },
  off_market: { event: 'off_market_requested', label: 'Off-Market Opportunities' },
  price_alert: { event: 'price_alert_requested', label: 'Price Change Alert' },
  different_area: { event: 'different_area_requested', label: 'Looking Somewhere Else' },
  financing_help: { event: 'financing_requested', label: 'Financing Help' }
};

function clean(value, max = 500) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, max);
}

function normalizeEmail(value) {
  const email = clean(value, 320).toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : '';
}

function normalizePhone(value) {
  const digits = String(value || '').replace(/\D/g, '');
  const national = digits.length === 11 && digits.startsWith('1') ? digits.slice(1) : digits;
  return national.length === 10 ? `+1${national}` : '';
}

function sourceKey(homekeyId, phone, email) {
  return crypto.createHash('sha256').update(`homekey|${homekeyId}|${phone || email}`).digest('hex');
}

function one(rows) {
  return Array.isArray(rows) ? rows[0] || null : null;
}

async function loadContext(code) {
  const homekey = one(await supabaseRest(
    `property_keepsakes?public_code=eq.${encodeURIComponent(code)}&status=eq.active&select=*&limit=1`
  ));
  if (!homekey) return null;
  const [house, profile, listingAgent, loanOfficer] = await Promise.all([
    supabaseRest(`open_houses?id=eq.${encodeURIComponent(homekey.open_house_id)}&select=id,address,price,agent,agent_phone,agent_email,brokerage&limit=1`).then(one).catch(() => null),
    supabaseRest(`open_house_property_profiles?open_house_id=eq.${encodeURIComponent(homekey.open_house_id)}&select=address,price,agent_name,agent_phone,agent_email,brokerage&limit=1`).then(one).catch(() => null),
    homekey.listing_agent_id
      ? supabaseRest(`listing_agents?id=eq.${encodeURIComponent(homekey.listing_agent_id)}&select=*&limit=1`).then(one).catch(() => null)
      : Promise.resolve(null),
    homekey.loan_officer_uid
      ? supabaseRest(`verified_profiles?uid=eq.${encodeURIComponent(homekey.loan_officer_uid)}&select=*&limit=1`).then(one).catch(() => null)
      : Promise.resolve(null)
  ]);
  const agent = {
    ...(listingAgent || {}),
    name: listingAgent?.name || profile?.agent_name || house?.agent || '',
    phone: listingAgent?.phone || profile?.agent_phone || house?.agent_phone || '',
    email: listingAgent?.email || profile?.agent_email || house?.agent_email || '',
    brokerage: listingAgent?.brokerage || profile?.brokerage || house?.brokerage || ''
  };
  return { homekey, house, profile, agent, loanOfficer };
}

async function matchAgentWebsite(agent) {
  if (!agent) return null;
  const rows = await supabaseRest('agent_websites?status=eq.published&select=slug,name,email,phone&order=updated_at.desc&limit=500').catch(() => []);
  const phone = normalizePhone(agent.phone);
  const email = normalizeEmail(agent.email);
  const name = clean(agent.name, 160).toLowerCase();
  return (rows || []).find((row) => (
    (email && normalizeEmail(row.email) === email)
    || (phone && normalizePhone(row.phone) === phone)
    || (name && clean(row.name, 160).toLowerCase() === name)
  )) || null;
}

async function recordAction(homekeyId, eventType, action, detail) {
  await supabaseRest('property_keepsake_events', {
    method: 'POST',
    body: JSON.stringify({
      property_keepsake_id: homekeyId,
      event_type: eventType,
      metadata: { action, detail: clean(detail, 160) }
    })
  });
}

async function handler(req, res) {
  try {
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST');
      return sendJson(res, 405, { ok: false, error: 'Method not allowed.' });
    }
    if (clean(req.body?.website, 200)) return sendJson(res, 200, { ok: true, saved: true });

    const code = clean(req.body?.homekey_code, 120);
    const selectedAction = clean(req.body?.selected_action, 80);
    const action = ACTIONS[selectedAction];
    const requestDetail = clean(req.body?.request_detail, 160);
    const name = clean(req.body?.name, 120);
    const phone = normalizePhone(req.body?.phone);
    const email = normalizeEmail(req.body?.email);
    const consent = req.body?.consent === true;

    if (!code) return sendJson(res, 400, { ok: false, error: 'Missing HomeKey.' });
    if (!action) return sendJson(res, 400, { ok: false, error: 'Choose a valid request.' });
    if (!name) return sendJson(res, 400, { ok: false, error: 'Enter your name.' });
    if (!phone && !email) return sendJson(res, 400, { ok: false, error: 'Enter a valid mobile number or email.' });
    if (!consent) return sendJson(res, 400, { ok: false, error: 'Please confirm permission to follow up.' });

    const context = await loadContext(code);
    if (!context) return sendJson(res, 404, { ok: false, error: 'HomeKey not found.' });
    const website = await matchAgentWebsite(context.agent);
    const candidates = await supabaseRest(
      `leads?chip_uid=eq.${encodeURIComponent(`homekey:${context.homekey.public_code}`)}&source=eq.homekey&select=id,phone,email,source_key,metadata,created_at&limit=100`
    ).catch(() => []);
    const existing = (candidates || []).find((lead) => (
      (phone && normalizePhone(lead.phone) === phone)
      || (email && normalizeEmail(lead.email) === email)
    )) || null;
    const key = existing?.source_key || sourceKey(context.homekey.id, phone, email);
    const now = new Date().toISOString();
    const previousActions = Array.isArray(existing?.metadata?.actions) ? existing.metadata.actions : [];
    const actions = [...new Set([...previousActions, selectedAction])];
    const details = Array.isArray(existing?.metadata?.request_details) ? existing.metadata.request_details : [];
    if (requestDetail && !details.includes(requestDetail)) details.push(requestDetail);
    const address = context.profile?.address || context.house?.address || 'HomeKey property';
    const price = Number(context.profile?.price || context.house?.price) || null;
    const metadata = {
      ...(existing?.metadata && typeof existing.metadata === 'object' ? existing.metadata : {}),
      source: 'homekey',
      homekey_id: context.homekey.id,
      homekey_public_code: context.homekey.public_code,
      open_house_id: context.homekey.open_house_id,
      open_house_event_id: context.homekey.open_house_event_id,
      field_demo_visit_id: context.homekey.field_demo_visit_id,
      listing_agent_id: context.homekey.listing_agent_id,
      listing_agent_name: clean(context.agent?.name, 160),
      loan_officer_uid: context.homekey.loan_officer_uid,
      loan_officer_name: clean(context.loanOfficer?.full_name, 160),
      actions,
      request_details: details.slice(-20),
      consent: {
        granted: true,
        scope: 'selected_homekey_request',
        text: 'The attributed listing agent, loan officer when relevant, and REL8TION may contact me about the request I selected.',
        updated_at: now
      },
      last_submitted_at: now
    };
    const payload = {
      name,
      phone: phone || null,
      email: email || null,
      agent: clean(context.agent?.name, 160) || null,
      agent_slug: clean(website?.slug, 160) || null,
      consent: 'yes',
      notes: `HomeKey requests: ${actions.map((item) => ACTIONS[item]?.label || item).join(', ')}`,
      property_address: clean(address, 300),
      property_price: price,
      chip_uid: `homekey:${context.homekey.public_code}`,
      source: 'homekey',
      source_key: key,
      metadata,
      updated_at: now
    };
    const rows = await supabaseRest('leads?on_conflict=source_key', {
      method: 'POST',
      headers: { Prefer: 'resolution=merge-duplicates,return=representation' },
      body: JSON.stringify(payload)
    });
    await recordAction(context.homekey.id, action.event, selectedAction, requestDetail);

    return sendJson(res, 200, {
      ok: true,
      saved: true,
      updated_existing: Boolean(existing),
      lead_id: one(rows)?.id || existing?.id || null,
      homekey_code: context.homekey.public_code,
      selected_action: selectedAction
    });
  } catch (error) {
    return sendJson(res, error.status || 500, {
      ok: false,
      error: error.message || 'Unable to save your HomeKey request.'
    });
  }
}

module.exports = handler;
module.exports.__test = { ACTIONS, normalizeEmail, normalizePhone, sourceKey };
