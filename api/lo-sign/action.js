const { adminAuthorized, assertAdminConfig, sendJson, supabaseRest } = require('../../lib/admin-auth');
const {
  activateLoanOfficerCoverage,
  clean,
  enc,
  endEventLinks,
  httpError,
  isLiveEvent,
  loadEventById,
  loadLoanOfficerSign,
  loadVerifiedProfile,
  publicProfile,
  resolveLoanOfficerSign,
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

function requireAdmin(req) {
  assertAdminConfig();
  const auth = adminAuthorized(req);
  if (!auth.ok) throw httpError(401, auth.error || 'Unauthorized.');
  return auth;
}

function publicCoverageSign(row = null) {
  if (!row) return null;
  return {
    id: row.id || '',
    public_code: row.public_code || '',
    uid: row.uid || '',
    loan_officer_profile_id: row.loan_officer_profile_id || '',
    loan_officer_uid: row.loan_officer_uid || '',
    status: row.status || 'available',
    active_event_id: row.active_event_id || '',
    active_event_pass_inventory_id: row.active_event_pass_inventory_id || '',
    active_smart_sign_id: row.active_smart_sign_id || '',
    last_open_house_id: row.last_open_house_id || '',
    last_agent_slug: row.last_agent_slug || '',
    last_used_at: row.last_used_at || '',
    updated_at: row.updated_at || '',
    metadata: safeMetadata(row.metadata)
  };
}

function publicEvent(row = null) {
  if (!row) return null;
  return {
    id: row.id || '',
    host_agent_slug: row.host_agent_slug || '',
    open_house_source_id: row.open_house_source_id || '',
    status: row.status || '',
    start_time: row.start_time || '',
    end_time: row.end_time || '',
    ended_at: row.ended_at || '',
    setup_context: safeMetadata(row.setup_context)
  };
}

async function resolveResponse({ code = '', uid = '' }) {
  const resolved = await resolveLoanOfficerSign({ publicCode: code, uid });
  return {
    coverage_sign: publicCoverageSign(resolved.sign),
    profile: publicProfile(resolved.profile),
    event: publicEvent(resolved.event),
    live: resolved.live,
    event_url: resolved.live && resolved.event?.id ? `/event?event=${encodeURIComponent(resolved.event.id)}` : '',
    activation_url: resolved.sign?.public_code ? `/lo-sign-activate?code=${encodeURIComponent(resolved.sign.public_code)}${uid ? `&uid=${encodeURIComponent(uid)}` : ''}` : '',
    profile_activation_url: resolved.sign?.uid ? `/nmb-activate?uid=${encodeURIComponent(resolved.sign.uid)}` : (uid ? `/nmb-activate?uid=${encodeURIComponent(uid)}` : '/nmb-activate')
  };
}

async function assignSignToLoanOfficer(body) {
  const publicCode = clean(body.public_code || body.code);
  if (!publicCode) throw httpError(400, 'Missing Loan Officer Coverage Sign public code.');
  const profile = await loadVerifiedProfile({
    profileId: body.loan_officer_profile_id || body.profile_id,
    uid: body.loan_officer_uid || body.uid
  });
  if (!profile || profile.is_active === false) {
    throw httpError(404, 'Active loan officer profile not found.');
  }

  const existing = await loadLoanOfficerSign({ publicCode }).catch(() => null);
  const now = new Date().toISOString();
  const payload = {
    public_code: publicCode,
    uid: clean(body.sign_uid || body.coverage_sign_uid || existing?.uid || ''),
    loan_officer_profile_id: profile.id || profile.uid || null,
    loan_officer_uid: profile.uid || profile.id || null,
    status: existing?.active_event_id ? 'live' : 'assigned',
    updated_at: now,
    metadata: {
      ...safeMetadata(existing?.metadata),
      assigned_at: now,
      assigned_by: 'admin'
    }
  };
  if (!payload.uid) delete payload.uid;

  const rows = existing?.id
    ? await supabaseRest(`loan_officer_coverage_signs?id=eq.${enc(existing.id)}`, {
      method: 'PATCH',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify(payload)
    })
    : await supabaseRest('loan_officer_coverage_signs', {
      method: 'POST',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify(payload)
    });

  return {
    coverage_sign: Array.isArray(rows) ? rows[0] || null : null,
    profile: publicProfile(profile)
  };
}

async function endCoverage(body) {
  const coverageSign = await loadLoanOfficerSign({
    publicCode: body.public_code || body.code,
    uid: body.uid
  });
  if (!coverageSign) throw httpError(404, 'Loan Officer Coverage Sign not found.');
  const eventId = clean(body.event_id || coverageSign.active_event_id);
  if (!eventId) throw httpError(400, 'No active coverage event is linked to this sign.');
  const now = new Date().toISOString();
  const ended = await endEventLinks({ eventId, now });

  await supabaseRest(
    `loan_officer_sign_events?loan_officer_sign_id=eq.${enc(coverageSign.id)}&open_house_event_id=eq.${enc(eventId)}&status=eq.live`,
    {
      method: 'PATCH',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify({
        status: 'ended',
        ended_at: now
      })
    }
  ).catch(() => null);

  const rows = await supabaseRest(`loan_officer_coverage_signs?id=eq.${enc(coverageSign.id)}`, {
    method: 'PATCH',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify({
      status: coverageSign.loan_officer_profile_id || coverageSign.loan_officer_uid ? 'assigned' : 'available',
      active_event_id: null,
      active_event_pass_inventory_id: null,
      active_smart_sign_id: null,
      updated_at: now,
      metadata: {
        ...safeMetadata(coverageSign.metadata),
        last_coverage_ended_at: now,
        last_ended_event_id: eventId
      }
    })
  });

  return {
    coverage_sign: Array.isArray(rows) ? rows[0] || null : null,
    ended
  };
}

async function resetSign(body) {
  if (clean(body.confirmation) !== 'REL8TION') {
    throw httpError(400, 'Type REL8TION to reset this Loan Officer Coverage Sign.');
  }
  const coverageSign = await loadLoanOfficerSign({
    publicCode: body.public_code || body.code,
    uid: body.uid
  });
  if (!coverageSign) throw httpError(404, 'Loan Officer Coverage Sign not found.');

  let ended = null;
  if (coverageSign.active_event_id) {
    const event = await loadEventById(coverageSign.active_event_id);
    if (isLiveEvent(event)) {
      ended = await endCoverage({ ...body, event_id: coverageSign.active_event_id });
    }
  }

  const now = new Date().toISOString();
  const rows = await supabaseRest(`loan_officer_coverage_signs?id=eq.${enc(coverageSign.id)}`, {
    method: 'PATCH',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify({
      status: coverageSign.loan_officer_profile_id || coverageSign.loan_officer_uid ? 'assigned' : 'available',
      active_event_id: null,
      active_event_pass_inventory_id: null,
      active_smart_sign_id: null,
      updated_at: now,
      metadata: {
        ...safeMetadata(coverageSign.metadata),
        reset_at: now,
        reset_reason: body.reason || 'admin_reset'
      }
    })
  });
  return {
    coverage_sign: Array.isArray(rows) ? rows[0] || null : null,
    ended
  };
}

async function moveCoverage(body) {
  if (body.event_id || body.uid || body.public_code || body.code) {
    const sign = await loadLoanOfficerSign({ publicCode: body.public_code || body.code, uid: body.uid });
    if (sign?.active_event_id) await endCoverage({ ...body, event_id: sign.active_event_id });
  }
  return activateLoanOfficerCoverage({
    publicCode: clean(body.public_code || body.code),
    uid: clean(body.uid),
    body
  });
}

module.exports = async function handler(req, res) {
  try {
    if (req.method === 'GET') {
      const code = clean(req.query?.code || '');
      const uid = clean(req.query?.uid || '');
      if (!code && !uid) {
        sendJson(res, 400, { ok: false, error: 'Missing code or uid.' });
        return;
      }
      const payload = await resolveResponse({ code, uid });
      if (!payload.coverage_sign) {
        sendJson(res, 404, { ok: false, error: 'Loan Officer Coverage Sign not found.' });
        return;
      }
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

    if (action === 'activate_event_coverage') {
      result = await activateLoanOfficerCoverage({
        publicCode: clean(body.public_code || body.code || req.query?.code),
        uid: clean(body.uid || req.query?.uid),
        body
      });
    } else {
      requireAdmin(req);
      if (action === 'assign_sign_to_loan_officer') {
        result = await assignSignToLoanOfficer(body);
      } else if (action === 'end_coverage') {
        result = await endCoverage(body);
      } else if (action === 'move_coverage') {
        result = await moveCoverage(body);
      } else if (action === 'reset_sign') {
        result = await resetSign(body);
      } else {
        throw httpError(400, 'Unsupported Loan Officer Coverage Sign action.');
      }
    }

    sendJson(res, 200, { ok: true, action, ...result });
  } catch (error) {
    sendJson(res, error.status || 500, {
      ok: false,
      error: error.message || 'Loan Officer Coverage Sign action failed.',
      details: error.payload || null,
      event_id: error.event_id || null
    });
  }
};
