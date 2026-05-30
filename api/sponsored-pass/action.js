const { adminAuthorized, assertAdminConfig, sendJson, supabaseRest } = require('../../lib/admin-auth');
const {
  activateSponsoredPass,
  clean,
  enc,
  endEventLinks,
  httpError,
  isLiveEvent,
  loadEventById,
  loadInventoryByCode,
  loadVerifiedProfile,
  maybeOne,
  publicProfile,
  resolveSponsoredPass,
  safeMetadata
} = require('../../lib/coverage-workflows');

function parseBody(req) {
  if (!req.body) return {};
  if (typeof req.body === 'object') return req.body;
  try {
    return JSON.parse(req.body);
  } catch (_) {
    return {};
  }
}

function publicInventory(row = null) {
  if (!row) return null;
  return {
    id: row.id || '',
    public_code: row.public_code || '',
    inventory_type: row.inventory_type || '',
    qr_url: row.qr_url || '',
    smart_sign_id: row.smart_sign_id || '',
    sponsor_loan_officer_profile_id: row.sponsor_loan_officer_profile_id || '',
    sponsor_loan_officer_uid: row.sponsor_loan_officer_uid || '',
    assigned_agent_slug: row.assigned_agent_slug || '',
    assigned_agent_phone: row.assigned_agent_phone || '',
    pass_model: row.pass_model || 'single_event',
    sponsor_coverage_required: row.sponsor_coverage_required === true,
    sponsor_coverage_consent_required: row.sponsor_coverage_consent_required !== false,
    reuse_allowed: row.reuse_allowed === true,
    reuse_status: row.reuse_status || 'not_reusable',
    last_activated_at: row.last_activated_at || '',
    claimed_at: row.claimed_at || '',
    metadata: safeMetadata(row.metadata)
  };
}

function publicEvent(row = null) {
  if (!row) return null;
  return {
    id: row.id || '',
    host_agent_slug: row.host_agent_slug || '',
    open_house_source_id: row.open_house_source_id || '',
    smart_sign_id: row.smart_sign_id || '',
    status: row.status || '',
    start_time: row.start_time || '',
    end_time: row.end_time || '',
    ended_at: row.ended_at || '',
    setup_context: safeMetadata(row.setup_context)
  };
}

async function resolveResponse(code) {
  const resolved = await resolveSponsoredPass(code);
  const sponsored = resolved.inventory?.pass_model === 'sponsored_agent_pass';
  return {
    inventory: publicInventory(resolved.inventory),
    sponsor: publicProfile(resolved.sponsor),
    sign: resolved.sign ? {
      id: resolved.sign.id || '',
      public_code: resolved.sign.public_code || '',
      status: resolved.sign.status || '',
      active_event_id: resolved.sign.active_event_id || '',
      owner_agent_slug: resolved.sign.owner_agent_slug || ''
    } : null,
    event: publicEvent(resolved.event),
    live: resolved.live,
    sponsored,
    consent_text: resolved.consent_text || '',
    seeded_context: resolved.seeded_context || null,
    activation_url: `/sponsored-pass-activate?code=${encodeURIComponent(code)}`,
    event_url: resolved.live && resolved.event?.id ? `/event?event=${encodeURIComponent(resolved.event.id)}` : '',
    blocked_reason: sponsored
      && (resolved.inventory.reuse_allowed !== true || resolved.inventory.reuse_status !== 'active')
      && !resolved.live
      ? 'This Sponsored Event Pass is not currently reusable. Contact the sponsor or Rel8tion.'
      : ''
  };
}

function requireAdmin(req) {
  assertAdminConfig();
  const auth = adminAuthorized(req);
  if (!auth.ok) throw httpError(401, auth.error || 'Unauthorized.');
  return auth;
}

async function loadInventoryByIdOrCode({ inventoryId = '', publicCode = '' }) {
  if (inventoryId) {
    return maybeOne(`smart_sign_inventory?id=eq.${enc(inventoryId)}&select=*`).then((row) => {
      if (!row) throw httpError(404, 'Event Pass inventory not found.');
      return row;
    });
  }
  return loadInventoryByCode(publicCode);
}

async function endSponsoredPassEvent(body) {
  if (clean(body.confirmation) !== 'REL8TION') {
    throw httpError(400, 'Type REL8TION to end this Sponsored Event Pass event.');
  }
  const inventory = body.event_id
    ? null
    : await loadInventoryByIdOrCode({
      inventoryId: body.inventory_id,
      publicCode: body.public_code || body.code
    });
  let eventId = clean(body.event_id);

  if (!eventId && inventory?.smart_sign_id) {
    const sign = await maybeOne(`smart_signs?id=eq.${enc(inventory.smart_sign_id)}&select=*`).catch(() => null);
    eventId = sign?.active_event_id || safeMetadata(inventory.metadata).current_event_id || '';
  }
  if (!eventId) throw httpError(400, 'Missing active event to end.');

  const result = await endEventLinks({ eventId });
  if (inventory?.id) {
    const metadata = { ...safeMetadata(inventory.metadata) };
    delete metadata.current_event_id;
    await supabaseRest(`smart_sign_inventory?id=eq.${enc(inventory.id)}`, {
      method: 'PATCH',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify({
        metadata: {
          ...metadata,
          last_event_ended_at: new Date().toISOString(),
          last_ended_event_id: eventId
        }
      })
    }).catch(() => null);
  }
  return result;
}

async function resetSponsoredPass(body) {
  if (clean(body.confirmation) !== 'REL8TION') {
    throw httpError(400, 'Type REL8TION to reset this Sponsored Event Pass.');
  }
  const inventory = await loadInventoryByIdOrCode({
    inventoryId: body.inventory_id,
    publicCode: body.public_code || body.code
  });
  const now = new Date().toISOString();
  let endResult = null;

  if (inventory.smart_sign_id) {
    const sign = await maybeOne(`smart_signs?id=eq.${enc(inventory.smart_sign_id)}&select=*`).catch(() => null);
    const eventId = sign?.active_event_id || safeMetadata(inventory.metadata).current_event_id || '';
    if (eventId) {
      const event = await loadEventById(eventId);
      if (isLiveEvent(event)) endResult = await endEventLinks({ eventId, now });
    }
  }

  const metadata = {
    ...safeMetadata(inventory.metadata),
    reset_at: now,
    reset_reason: body.reason || 'admin_reset'
  };
  delete metadata.current_event_id;

  const rows = await supabaseRest(`smart_sign_inventory?id=eq.${enc(inventory.id)}`, {
    method: 'PATCH',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify({
      assigned_agent_slug: null,
      assigned_agent_phone: null,
      metadata
    })
  });
  return { inventory: Array.isArray(rows) ? rows[0] || null : null, ended: endResult };
}

async function assignSponsor(body) {
  const inventory = await loadInventoryByIdOrCode({
    inventoryId: body.inventory_id,
    publicCode: body.public_code || body.code
  });
  const profile = await loadVerifiedProfile({
    profileId: body.sponsor_loan_officer_profile_id || body.profile_id,
    uid: body.sponsor_loan_officer_uid || body.loan_officer_uid
  });
  if (!profile || profile.is_active === false) {
    throw httpError(404, 'Active sponsor loan officer profile not found.');
  }
  const rows = await supabaseRest(`smart_sign_inventory?id=eq.${enc(inventory.id)}`, {
    method: 'PATCH',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify({
      pass_model: 'sponsored_agent_pass',
      sponsor_loan_officer_profile_id: profile.id || profile.uid || null,
      sponsor_loan_officer_uid: profile.uid || profile.id || null,
      sponsor_coverage_required: true,
      sponsor_coverage_consent_required: true,
      reuse_allowed: true,
      reuse_status: body.reuse_status || 'active',
      metadata: {
        ...safeMetadata(inventory.metadata),
        sponsor_assigned_at: new Date().toISOString(),
        sponsor_assigned_by: 'admin'
      }
    })
  });
  return { inventory: Array.isArray(rows) ? rows[0] || null : null, sponsor: publicProfile(profile) };
}

async function assignAgent(body) {
  const inventory = await loadInventoryByIdOrCode({
    inventoryId: body.inventory_id,
    publicCode: body.public_code || body.code
  });
  const rows = await supabaseRest(`smart_sign_inventory?id=eq.${enc(inventory.id)}`, {
    method: 'PATCH',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify({
      assigned_agent_slug: clean(body.agent_slug) || null,
      assigned_agent_phone: clean(body.agent_phone) || null,
      metadata: {
        ...safeMetadata(inventory.metadata),
        agent_assigned_at: new Date().toISOString(),
        agent_assigned_by: 'admin'
      }
    })
  });
  return { inventory: Array.isArray(rows) ? rows[0] || null : null };
}

async function setReuseStatus(body) {
  const inventory = await loadInventoryByIdOrCode({
    inventoryId: body.inventory_id,
    publicCode: body.public_code || body.code
  });
  const status = clean(body.reuse_status || body.status);
  if (!['active', 'inactive', 'paused', 'not_reusable'].includes(status)) {
    throw httpError(400, 'Use reuse_status active, inactive, paused, or not_reusable.');
  }
  const rows = await supabaseRest(`smart_sign_inventory?id=eq.${enc(inventory.id)}`, {
    method: 'PATCH',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify({
      reuse_status: status,
      reuse_allowed: status === 'active',
      metadata: {
        ...safeMetadata(inventory.metadata),
        reuse_status_changed_at: new Date().toISOString(),
        reuse_status_changed_by: 'admin'
      }
    })
  });
  return { inventory: Array.isArray(rows) ? rows[0] || null : null };
}

module.exports = async function handler(req, res) {
  try {
    if (req.method === 'GET') {
      const code = clean(req.query?.code || '');
      if (!code) {
        sendJson(res, 400, { ok: false, error: 'Missing code.' });
        return;
      }
      const payload = await resolveResponse(code);
      sendJson(res, 200, { ok: true, ...payload });
      return;
    }

    if (req.method !== 'POST') {
      res.setHeader('Allow', 'GET, POST');
      sendJson(res, 405, { ok: false, error: 'Method not allowed.' });
      return;
    }

    const body = parseBody(req);
    const action = clean(body.action);
    let result = null;

    if (action === 'activate_sponsored_pass') {
      const publicCode = clean(body.public_code || body.code || req.query?.code);
      if (!publicCode) throw httpError(400, 'Missing Sponsored Event Pass code.');
      result = await activateSponsoredPass({ publicCode, body, req });
    } else {
      requireAdmin(req);
      if (action === 'end_sponsored_pass_event') {
        result = await endSponsoredPassEvent(body);
      } else if (action === 'reset_sponsored_pass') {
        result = await resetSponsoredPass(body);
      } else if (action === 'assign_sponsor') {
        result = await assignSponsor(body);
      } else if (action === 'assign_agent') {
        result = await assignAgent(body);
      } else if (action === 'set_reuse_status') {
        result = await setReuseStatus(body);
      } else {
        throw httpError(400, 'Unsupported Sponsored Event Pass action.');
      }
    }

    sendJson(res, 200, { ok: true, action, ...result });
  } catch (error) {
    sendJson(res, error.status || 500, {
      ok: false,
      error: error.message || 'Sponsored Event Pass action failed.',
      details: error.payload || null,
      event_id: error.event_id || null
    });
  }
};
