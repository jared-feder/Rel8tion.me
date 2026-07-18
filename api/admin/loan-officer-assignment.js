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

async function loadLoanOfficerProfile(uid) {
  return loadOne(
    `verified_profiles?uid=eq.${enc(uid)}&select=*`,
    'Loan officer profile'
  );
}

function clean(value, max = 2000) {
  return String(value || '').trim().slice(0, max);
}

function htmlEscape(value) {
  return clean(value, 4000).replace(/[&<>"']/g, (char) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[char]));
}

function normalizePhone(value) {
  const digits = clean(value, 80).replace(/\D/g, '');
  const ten = digits.length === 11 && digits.startsWith('1') ? digits.slice(1) : digits;
  return ten.length === 10 ? `+1${ten}` : '';
}

function assignmentAddress(visit) {
  const direct = clean(visit?.address || visit?.setup_context?.address, 300);
  if (direct) return direct;
  const match = clean(visit?.notes, 2000).match(/Open house:\s*([^\n]+?)(?:\.\s*Agent phone:|$)/i);
  return clean(match?.[1] || visit?.open_house_id || 'the open house', 300);
}

function assignmentLinks(visit) {
  const start = new Date(visit?.scheduled_start || visit?.start_time || Date.now());
  const end = new Date(visit?.scheduled_end || visit?.end_time || start.getTime() + 2 * 60 * 60 * 1000);
  const stamp = (date) => date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
  const address = assignmentAddress(visit);
  const calendar = new URL('https://calendar.google.com/calendar/render');
  calendar.searchParams.set('action', 'TEMPLATE');
  calendar.searchParams.set('text', `REL8TION Open House Coverage - ${address}`);
  calendar.searchParams.set('dates', `${stamp(start)}/${stamp(end)}`);
  calendar.searchParams.set('location', address);
  calendar.searchParams.set('details', 'Loan officer coverage assigned through REL8TION.');
  return { address, calendar:calendar.toString(), dashboard:'https://app.rel8tion.me/loan-officer' };
}

async function sendAssignmentSms(to, name, message, metadata) {
  const phone = normalizePhone(to);
  const url = clean(process.env.SUPABASE_URL, 500).replace(/\/$/, '');
  const key = clean(process.env.SUPABASE_SERVICE_ROLE_KEY, 2000);
  if (!phone || !url || !key) return { status:'skipped' };
  const response = await fetch(`${url}/functions/v1/send-lead-sms`, { method:'POST', headers:{ apikey:key, Authorization:`Bearer ${key}`, 'Content-Type':'application/json' }, body:JSON.stringify({ agent_phone:phone, buyer_phone:phone, buyer_name:name || 'Open house contact', category:'event_transactional', message, metadata }) });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload?.error) throw new Error(payload?.error || `Assignment SMS failed: ${response.status}`);
  return { status:'sent', id:payload.sid || payload.id || null };
}

async function sendAssignmentEmail(to, subject, html) {
  const apiKey = clean(process.env.RESEND_API_KEY, 1000);
  if (!to || !apiKey) return { status:'skipped', warning:'Email provider is not configured.' };
  const response = await fetch('https://api.resend.com/emails', { method:'POST', headers:{ Authorization:`Bearer ${apiKey}`, 'Content-Type':'application/json' }, body:JSON.stringify({ from:clean(process.env.REL8TION_FROM_EMAIL || process.env.RESEND_FROM_EMAIL || 'REL8TION <onboarding@resend.dev>', 320), to:[to], subject, html }) });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload?.message || `Assignment email failed: ${response.status}`);
  return { status:'sent', id:payload.id || null };
}

async function notifyConfirmedAssignment(visit, profile) {
  const links = assignmentLinks(visit);
  const when = new Date(visit.scheduled_start).toLocaleString('en-US', { timeZone:'America/New_York', weekday:'short', month:'short', day:'numeric', hour:'numeric', minute:'2-digit', timeZoneName:'short' });
  const loMessage = `REL8TION assignment confirmed: ${links.address}, ${when}. Hosting agent: ${visit.agent_name || 'Agent'}${visit.agent_phone ? `, ${visit.agent_phone}` : ''}. Dashboard: ${links.dashboard} Add to calendar: ${links.calendar}`;
  const agentMessage = `REL8TION coverage confirmed for ${links.address}, ${when}. Your assigned loan officer is ${profile.full_name || 'your REL8TION loan officer'}${profile.phone ? `, ${profile.phone}` : ''}.`;
  const results = await Promise.allSettled([
    sendAssignmentSms(profile.phone, profile.full_name, loMessage, { mode:'loan_officer_assignment', visit_id:visit.id, recipient_role:'loan_officer' }),
    sendAssignmentSms(visit.agent_phone, visit.agent_name, agentMessage, { mode:'loan_officer_assignment', visit_id:visit.id, recipient_role:'agent' }),
    sendAssignmentEmail(profile.email, `REL8TION open house assignment - ${links.address}`, `<p>${htmlEscape(loMessage)}</p>`),
    sendAssignmentEmail(visit.agent_email, 'Your REL8TION loan officer coverage is confirmed', `<p>${htmlEscape(agentMessage)}</p>`)
  ]);
  return results.map((result) => result.status === 'fulfilled' ? result.value : { status:'warning', warning:result.reason?.message || String(result.reason) });
}

async function blockConfirmedAvailability(visit, profile) {
  const start = new Date(visit?.scheduled_start || visit?.start_time || '');
  const end = new Date(visit?.scheduled_end || visit?.end_time || '');
  if (!visit?.id || !profile?.uid || !Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || end <= start) {
    return { status:'skipped', warning:'Assignment window was not valid for an availability block.' };
  }
  await supabaseRest(`field_coverage_availability?linked_visit_id=eq.${enc(visit.id)}&notes=eq.${enc('Automatic assignment block')}&status=neq.cancelled`, {
    method:'PATCH', body:JSON.stringify({ status:'cancelled', updated_at:new Date().toISOString() })
  }).catch(() => null);
  const zip = clean(visit.property_zip || assignmentAddress(visit).match(/\b\d{5}\b/)?.[0] || '00000', 5);
  const rows = await supabaseRest('field_coverage_availability', {
    method:'POST', headers:{ Prefer:'return=representation' }, body:JSON.stringify({
      participant_profile_id:profile.uid, participant_uid:profile.uid, participant_slug:profile.slug || null,
      participant_name:profile.full_name || profile.slug || null, participant_phone:profile.phone || null,
      participant_email:profile.email || null, participant_company:profile.company_name || null,
      role:'loan_officer', responsibility:'financing_support', available_start:start.toISOString(),
      available_end:end.toISOString(), service_zip:zip, service_radius_miles:1, status:'unavailable',
      linked_visit_id:visit.id, notes:'Automatic assignment block', updated_at:new Date().toISOString()
    })
  });
  return { status:'unavailable', row:Array.isArray(rows) ? rows[0] || null : null };
}

async function updateAuthEmail(oldEmail, newEmail) {
  if (!oldEmail || !newEmail || oldEmail.toLowerCase() === newEmail.toLowerCase()) return { changed:false };
  const url = clean(process.env.SUPABASE_URL, 500).replace(/\/$/, '');
  const key = clean(process.env.SUPABASE_SERVICE_ROLE_KEY, 2000);
  const listResponse = await fetch(`${url}/auth/v1/admin/users?page=1&per_page=1000`, { headers:{ apikey:key, Authorization:`Bearer ${key}` } });
  const listPayload = await listResponse.json().catch(() => ({}));
  if (!listResponse.ok) throw new Error(listPayload?.message || 'Unable to find the loan officer login account.');
  const users = Array.isArray(listPayload?.users) ? listPayload.users : Array.isArray(listPayload) ? listPayload : [];
  const user = users.find((item) => clean(item.email, 320).toLowerCase() === clean(oldEmail, 320).toLowerCase());
  if (!user?.id) return { changed:false, warning:'No Auth login existed for the old email; the verified profile was updated.' };
  const response = await fetch(`${url}/auth/v1/admin/users/${encodeURIComponent(user.id)}`, {
    method:'PUT', headers:{ apikey:key, Authorization:`Bearer ${key}`, 'Content-Type':'application/json' },
    body:JSON.stringify({ email:newEmail, email_confirm:true })
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload?.message || payload?.msg || 'Unable to update the login email.');
  const redirectTo = `${clean(process.env.PUBLIC_APP_URL || process.env.REL8TION_APP_URL || 'https://app.rel8tion.me', 500).replace(/\/$/, '')}/loan-officer?mode=setup`;
  const recovery = await fetch(`${url}/auth/v1/recover?redirect_to=${encodeURIComponent(redirectTo)}`, {
    method:'POST', headers:{ apikey:key, Authorization:`Bearer ${key}`, 'Content-Type':'application/json' }, body:JSON.stringify({ email:newEmail })
  });
  return { changed:true, user_id:user.id, recovery_sent:recovery.ok };
}

async function updateLoanOfficerProfile(body) {
  const profile = await loadLoanOfficerProfile(body.loan_officer_uid);
  const email = clean(body.email || profile.email, 320).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw Object.assign(new Error('Enter a valid email address.'), { status:400 });
  const auth = await updateAuthEmail(profile.email, email);
  const rows = await supabaseRest(`verified_profiles?uid=eq.${enc(profile.uid)}`, {
    method:'PATCH', headers:{ Prefer:'return=representation' },
    body:JSON.stringify({
      full_name:clean(body.full_name || profile.full_name, 160), email,
      phone:clean(body.phone || profile.phone, 80), company_name:clean(body.company_name || profile.company_name, 180),
      title:clean(body.title || profile.title || 'Loan Officer', 160), updated_at:new Date().toISOString()
    })
  });
  return { loan_officer:Array.isArray(rows) ? rows[0] || profile : profile, auth };
}

async function loadFieldVisit(id) {
  return loadOne(`field_demo_visits?id=eq.${enc(id)}&select=*`, 'Confirmed open house');
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

async function endLiveCoverageForLoanOfficer(uid, now = new Date().toISOString()) {
  const rows = await supabaseRest(
    `event_loan_officer_sessions?status=eq.live&or=(loan_officer_uid.eq.${enc(uid)},verified_profile_uid.eq.${enc(uid)})`,
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

async function cancelFieldAssignmentsForLoanOfficer(uid) {
  return supabaseRest(
    `field_demo_visit_participants?role=eq.loan_officer&responsibility=eq.financing_support&status=in.(assigned,confirmed,en_route,on_site,live)&or=(participant_uid.eq.${enc(uid)},participant_profile_id.eq.${enc(uid)})`,
    {
      method: 'PATCH',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify({
        status: 'cancelled',
        is_primary: false
      })
    }
  ).then((rows) => (Array.isArray(rows) ? rows : [])).catch((error) => ({
    warning: error.message || String(error)
  }));
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

    const availability_block = await blockConfirmedAvailability(visit, profile);
    return { visit, participant, availability_block };
  } catch (error) {
    return { visit: null, participant: null, warning: error.message || String(error) };
  }
}

async function assignConfirmedVisit(visitId, loanOfficerUid) {
  const [visit, profile] = await Promise.all([loadFieldVisit(visitId), loadLoanOfficer(loanOfficerUid)]);
  if (visit.status === 'cancelled') {
    const error = new Error('This confirmed open house is cancelled.');
    error.status = 409;
    throw error;
  }
  await supabaseRest(`field_demo_visit_participants?field_demo_visit_id=eq.${enc(visit.id)}&responsibility=eq.financing_support&is_primary=eq.true`, {
    method: 'PATCH',
    body: JSON.stringify({ is_primary: false })
  }).catch(() => null);
  const existing = await supabaseRest(`field_demo_visit_participants?field_demo_visit_id=eq.${enc(visit.id)}&participant_profile_id=eq.${enc(profile.uid)}&responsibility=eq.financing_support&select=*&limit=1`)
    .then((rows) => Array.isArray(rows) ? rows[0] || null : null).catch(() => null);
  const payload = {
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
    assignment_reason: 'Admin assigned confirmed open house appointment'
  };
  const participant = existing?.id
    ? await supabaseRest(`field_demo_visit_participants?id=eq.${enc(existing.id)}`, { method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify(payload) }).then((rows) => rows?.[0] || null)
    : await supabaseRest('field_demo_visit_participants', { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify(payload) }).then((rows) => rows?.[0] || null);
  let live_coverage = null;
  if (visit.open_house_event_id) {
    const event = await loadEvent(visit.open_house_event_id);
    await endLiveCoverage(event.id);
    live_coverage = await insertLiveCoverage(event, profile);
  }
  const availability_block = await blockConfirmedAvailability(visit, profile);
  const notifications = await notifyConfirmedAssignment(visit, profile);
  return { visit, loan_officer: profile, participant, live_coverage, availability_block, notifications, calendar_url:assignmentLinks(visit).calendar };
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

async function removeLoanOfficerProfile(loanOfficerUid) {
  const profile = await loadLoanOfficerProfile(loanOfficerUid);
  const now = new Date().toISOString();
  const ended = await endLiveCoverageForLoanOfficer(profile.uid, now);
  const field_assignments = await cancelFieldAssignmentsForLoanOfficer(profile.uid);

  const rows = await supabaseRest(`verified_profiles?uid=eq.${enc(profile.uid)}`, {
    method: 'PATCH',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify({
      is_active: false,
      updated_at: now
    })
  });

  return {
    loan_officer_before: profile,
    loan_officer: Array.isArray(rows) ? rows[0] || null : null,
    ended,
    field_assignments
  };
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

async function handler(req, res) {
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

    if (action === 'assign_visit') {
      if (!body.visit_id || !body.loan_officer_uid) {
        sendJson(res, 400, { ok: false, error: 'Missing visit_id or loan_officer_uid.' });
        return;
      }
      const result = await assignConfirmedVisit(body.visit_id, body.loan_officer_uid);
      sendJson(res, 200, { ok: true, action, ...result });
      return;
    }

    if (action === 'remove_profile') {
      if (!body.loan_officer_uid) {
        sendJson(res, 400, { ok: false, error: 'Missing loan_officer_uid.' });
        return;
      }
      const result = await removeLoanOfficerProfile(body.loan_officer_uid);
      sendJson(res, 200, { ok: true, action, ...result });
      return;
    }

    if (action === 'update_profile') {
      if (!body.loan_officer_uid) {
        sendJson(res, 400, { ok:false, error:'Missing loan_officer_uid.' });
        return;
      }
      const result = await updateLoanOfficerProfile(body);
      sendJson(res, 200, { ok:true, action, ...result });
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
}

module.exports = handler;
module.exports.assignLiveCoverage = assignLiveCoverage;
module.exports.notifyConfirmedAssignment = notifyConfirmedAssignment;
module.exports.blockConfirmedAvailability = blockConfirmedAvailability;
