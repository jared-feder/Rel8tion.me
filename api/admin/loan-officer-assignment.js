const { adminAuthorized, assertAdminConfig, sendJson, supabaseRest } = require('../../lib/admin-auth');

function parseBody(req) {
  if (!req.body) return {};
  if (typeof req.body === 'object') return req.body;
  try {
    return JSON.parse(req.body);
  } catch (_) {
    return {};
  }
}

function enc(value) {
  return encodeURIComponent(String(value || '').trim());
}

function firstPresent(...values) {
  return values.find((value) => value !== undefined && value !== null && String(value).trim() !== '') || '';
}

async function loadOne(path, label) {
  const rows = await supabaseRest(`${path}&limit=1`);
  const row = Array.isArray(rows) ? rows[0] || null : null;
  if (!row) {
    const error = new Error(`${label} not found.`);
    error.status = 404;
    throw error;
  }
  return row;
}

async function loadEvent(eventId) {
  return loadOne(
    `open_house_events?id=eq.${enc(eventId)}&select=id,host_agent_slug,smart_sign_id,open_house_source_id,status,start_time,end_time,ended_at,setup_context,created_at`,
    'Open house event'
  );
}

async function loadLoanOfficer(uid) {
  return loadOne(
    `verified_profiles?uid=eq.${enc(uid)}&is_active=eq.true&select=*`,
    'Active loan officer'
  );
}

function sessionPayload(event, profile) {
  const now = new Date().toISOString();
  return {
    open_house_event_id: event.id,
    verified_profile_uid: profile.uid,
    loan_officer_uid: profile.uid,
    loan_officer_slug: profile.slug || '',
    loan_officer_name: profile.full_name || profile.name || '',
    loan_officer_title: profile.title || '',
    loan_officer_company: profile.company_name || profile.company || '',
    loan_officer_phone: profile.phone || '',
    loan_officer_email: profile.email || '',
    loan_officer_photo_url: firstPresent(profile.photo_url, profile.image_url, profile.avatar_url),
    loan_officer_cta_url: firstPresent(profile.cta_url, profile.website, profile.url),
    loan_officer_calendar_url: profile.calendar_url || '',
    status: 'live',
    signed_in_at: now,
    last_seen_at: now,
    updated_at: now
  };
}

async function endLiveCoverage(eventId) {
  const now = new Date().toISOString();
  const rows = await supabaseRest(
    `event_loan_officer_sessions?open_house_event_id=eq.${enc(eventId)}&status=eq.live`,
    {
      method: 'PATCH',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify({
        status: 'ended',
        signed_out_at: now,
        updated_at: now
      })
    }
  );
  return Array.isArray(rows) ? rows : [];
}

async function insertLiveCoverage(event, profile) {
  const rows = await supabaseRest('event_loan_officer_sessions', {
    method: 'POST',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify(sessionPayload(event, profile))
  });
  return Array.isArray(rows) ? rows[0] || null : null;
}

function eventContext(event) {
  return event?.setup_context && typeof event.setup_context === 'object' ? event.setup_context : {};
}

function fallbackEnd(start) {
  const date = new Date(start || Date.now());
  if (!Number.isFinite(date.getTime())) return new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();
  return new Date(date.getTime() + 2 * 60 * 60 * 1000).toISOString();
}

async function upsertFieldVisitAssignment(event, profile, source = 'manual_admin') {
  try {
    const context = eventContext(event);
    const scheduledStart = event.start_time || context.open_start || context.start_time || new Date().toISOString();
    const scheduledEnd = event.end_time || context.open_end || context.end_time || fallbackEnd(scheduledStart);
    const existingVisit = await supabaseRest(
      `field_demo_visits?open_house_event_id=eq.${enc(event.id)}&status=neq.cancelled&select=*&order=created_at.desc&limit=1`
    ).then((rows) => (Array.isArray(rows) ? rows[0] || null : null));

    const visitPayload = {
      open_house_event_id: event.id,
      open_house_id: event.open_house_source_id || context.open_house_id || null,
      agent_slug: event.host_agent_slug || context.agent_slug || null,
      agent_name: context.agent_name || null,
      agent_phone: context.agent_phone || null,
      agent_email: context.agent_email || null,
      brokerage: context.brokerage || null,
      property_zip: context.zip || context.property_zip || null,
      scheduled_start: scheduledStart,
      scheduled_end: scheduledEnd,
      status: existingVisit?.status || 'scheduled',
      coverage_mode: 'remote_support',
      demo_type: 'buyer_financing_support',
      source: 'admin_lo_assignment',
      assignment_source: source,
      notes: `Admin assigned ${profile.full_name || profile.slug || 'loan officer'} to this open house.`
    };

    const visit = existingVisit?.id
      ? await supabaseRest(`field_demo_visits?id=eq.${enc(existingVisit.id)}`, {
          method: 'PATCH',
          headers: { Prefer: 'return=representation' },
          body: JSON.stringify(visitPayload)
        }).then((rows) => (Array.isArray(rows) ? rows[0] || null : null))
      : await supabaseRest('field_demo_visits', {
          method: 'POST',
          headers: { Prefer: 'return=representation' },
          body: JSON.stringify(visitPayload)
        }).then((rows) => (Array.isArray(rows) ? rows[0] || null : null));

    if (!visit?.id) return { visit: null, participant: null };

    await supabaseRest(
      `field_demo_visit_participants?field_demo_visit_id=eq.${enc(visit.id)}&responsibility=eq.financing_support&is_primary=eq.true`,
      {
        method: 'PATCH',
        body: JSON.stringify({ is_primary: false })
      }
    ).catch(() => null);

    const existingParticipant = await supabaseRest(
      `field_demo_visit_participants?field_demo_visit_id=eq.${enc(visit.id)}&participant_profile_id=eq.${enc(profile.uid)}&responsibility=eq.financing_support&select=*&limit=1`
    ).then((rows) => (Array.isArray(rows) ? rows[0] || null : null));

    const participantPayload = {
      field_demo_visit_id: visit.id,
      participant_profile_id: profile.uid,
      participant_uid: profile.uid,
      participant_name: profile.full_name || profile.slug || null,
      participant_phone: profile.phone || null,
      participant_email: profile.email || null,
      participant_company: profile.company_name || null,
      role: 'loan_officer',
      responsibility: 'financing_support',
      status: 'assigned',
      is_primary: true,
      assignment_reason: 'Admin LO assignment'
    };

    const participant = existingParticipant?.id
      ? await supabaseRest(`field_demo_visit_participants?id=eq.${enc(existingParticipant.id)}`, {
          method: 'PATCH',
          headers: { Prefer: 'return=representation' },
          body: JSON.stringify(participantPayload)
        }).then((rows) => (Array.isArray(rows) ? rows[0] || null : null))
      : await supabaseRest('field_demo_visit_participants', {
          method: 'POST',
          headers: { Prefer: 'return=representation' },
          body: JSON.stringify(participantPayload)
        }).then((rows) => (Array.isArray(rows) ? rows[0] || null : null));

    return { visit, participant };
  } catch (error) {
    return { visit: null, participant: null, warning: error.message || String(error) };
  }
}

async function assignLiveCoverage(eventId, loanOfficerUid) {
  const [event, profile] = await Promise.all([
    loadEvent(eventId),
    loadLoanOfficer(loanOfficerUid)
  ]);

  if (event.ended_at || event.status === 'ended') {
    const error = new Error('This open house event is already ended.');
    error.status = 409;
    throw error;
  }

  const ended = await endLiveCoverage(event.id);
  const assigned = await insertLiveCoverage(event, profile);
  const field_assignment = await upsertFieldVisitAssignment(event, profile, 'manual_admin');

  return { event, loan_officer: profile, ended, assigned, field_assignment };
}

function recentWindowStart() {
  return new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
}

async function autoAssignLiveCoverage() {
  const [events, profiles, sessions] = await Promise.all([
    supabaseRest(
      `open_house_events?status=eq.active&ended_at=is.null&start_time=gte.${enc(recentWindowStart())}&select=id,host_agent_slug,smart_sign_id,open_house_source_id,status,start_time,end_time,ended_at,setup_context,created_at&order=start_time.asc.nullslast,created_at.asc&limit=100`
    ),
    supabaseRest('verified_profiles?is_active=eq.true&select=*&order=full_name.asc.nullslast,created_at.asc&limit=100'),
    supabaseRest('event_loan_officer_sessions?status=eq.live&select=open_house_event_id,loan_officer_uid')
  ]);

  const activeEvents = Array.isArray(events) ? events : [];
  const activeProfiles = (Array.isArray(profiles) ? profiles : []).filter((profile) => profile.uid);
  const liveSessions = Array.isArray(sessions) ? sessions : [];

  if (!activeProfiles.length) {
    const error = new Error('No active loan officers are available to assign.');
    error.status = 409;
    throw error;
  }

  const coveredEvents = new Set(liveSessions.map((row) => row.open_house_event_id).filter(Boolean));
  const loadByUid = {};
  for (const profile of activeProfiles) loadByUid[profile.uid] = 0;
  for (const session of liveSessions) {
    if (session.loan_officer_uid && loadByUid[session.loan_officer_uid] !== undefined) {
      loadByUid[session.loan_officer_uid] += 1;
    }
  }

  const assignments = [];
  for (const event of activeEvents) {
    if (coveredEvents.has(event.id)) continue;

    const profile = [...activeProfiles].sort((a, b) => {
      const loadDelta = (loadByUid[a.uid] || 0) - (loadByUid[b.uid] || 0);
      if (loadDelta) return loadDelta;
      return String(a.full_name || a.slug || '').localeCompare(String(b.full_name || b.slug || ''));
    })[0];

    const assigned = await insertLiveCoverage(event, profile);
    const field_assignment = await upsertFieldVisitAssignment(event, profile, 'auto_admin');
    assignments.push({ event, loan_officer: profile, assigned, field_assignment });
    coveredEvents.add(event.id);
    loadByUid[profile.uid] = (loadByUid[profile.uid] || 0) + 1;
  }

  return { assignments, available_loan_officers: activeProfiles.length, considered_events: activeEvents.length };
}

module.exports = async function handler(req, res) {
  try {
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST');
      sendJson(res, 405, { ok: false, error: 'Method not allowed.' });
      return;
    }

    assertAdminConfig();
    const auth = adminAuthorized(req);
    if (!auth.ok) {
      sendJson(res, 401, { ok: false, error: auth.error });
      return;
    }

    const body = parseBody(req);
    const action = String(body.action || 'assign').trim();

    if (action === 'end') {
      if (!body.event_id) {
        sendJson(res, 400, { ok: false, error: 'Missing event_id.' });
        return;
      }
      const ended = await endLiveCoverage(body.event_id);
      sendJson(res, 200, { ok: true, action, ended });
      return;
    }

    if (action === 'auto_assign') {
      const result = await autoAssignLiveCoverage();
      sendJson(res, 200, { ok: true, action, ...result });
      return;
    }

    if (!body.event_id || !body.loan_officer_uid) {
      sendJson(res, 400, { ok: false, error: 'Missing event_id or loan_officer_uid.' });
      return;
    }

    const result = await assignLiveCoverage(body.event_id, body.loan_officer_uid);
    sendJson(res, 200, { ok: true, action: 'assign', ...result });
  } catch (error) {
    sendJson(res, error.status || 500, {
      ok: false,
      error: error.message || 'Unable to update loan officer assignment.',
      details: error.payload || null
    });
  }
};
