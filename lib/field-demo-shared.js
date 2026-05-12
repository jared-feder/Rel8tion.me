const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const VISIT_STATUSES = new Set(['scheduled', 'confirmed', 'en_route', 'on_site', 'live', 'completed', 'converted', 'cancelled']);
const PARTICIPANT_STATUSES = new Set(['assigned', 'confirmed', 'en_route', 'on_site', 'live', 'completed', 'cancelled']);
const COVERAGE_MODES = new Set(['physical_demo', 'physical_support', 'remote_support']);
const DEMO_TYPES = new Set(['agent_onboarding', 'buyer_financing_support', 'brokerage_demo', 'follow_up_visit']);
const ROLES = new Set(['loan_officer', 'field_sales_rep', 'demo_presenter', 'onboarding_specialist', 'dispatcher', 'admin']);
const RESPONSIBILITIES = new Set(['financing_support', 'product_demo', 'agent_onboarding', 'sign_setup', 'follow_up_owner']);

function send(res, status, payload) {
  res.status(status).json(payload);
}

function requireSupabaseConfig() {
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
    throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.');
  }
}

async function supabaseRest(path, options = {}) {
  requireSupabaseConfig();
  const response = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...options,
    headers: {
      apikey: SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json',
      ...(options.headers || {})
    }
  });

  const raw = await response.text().catch(() => '');
  if (!response.ok) {
    throw new Error(raw || `Supabase request failed: ${response.status}`);
  }
  return raw ? JSON.parse(raw) : null;
}

function enc(value) {
  return encodeURIComponent(String(value || ''));
}

function one(rows) {
  return Array.isArray(rows) && rows.length ? rows[0] : null;
}

function cleanText(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || ''));
}

async function readJsonBody(req) {
  if (!req.body) return {};
  if (typeof req.body === 'object') return req.body;
  return JSON.parse(req.body);
}

function assertMethod(req, res, method = 'POST') {
  if (req.method === method) return true;
  res.setHeader('Allow', method);
  send(res, 405, { ok: false, error: 'Method not allowed.' });
  return false;
}

function assertAllowed(value, allowed, label) {
  if (!allowed.has(value)) {
    throw new Error(`Invalid ${label}: ${value}`);
  }
}

function visitTimestampPatch(status, now = new Date().toISOString()) {
  if (status === 'confirmed') return { confirmed_at: now };
  if (status === 'on_site') return { arrived_at: now };
  if (status === 'live') return { live_started_at: now };
  if (status === 'completed') return { completed_at: now };
  if (status === 'converted') {
    return {
      converted_at: now,
      converted_to_virtual_support: true,
      virtual_support_enabled_at: now
    };
  }
  return {};
}

function participantTimestampPatch(status, now = new Date().toISOString()) {
  if (status === 'confirmed') return { confirmed_at: now };
  if (status === 'on_site') return { arrived_at: now };
  if (status === 'completed') return { completed_at: now };
  return {};
}

function normalizeVisitPayload(input = {}) {
  const status = cleanText(input.status || 'scheduled') || 'scheduled';
  const coverageMode = cleanText(input.coverage_mode || 'physical_demo') || 'physical_demo';
  const demoType = cleanText(input.demo_type || 'agent_onboarding') || 'agent_onboarding';
  assertAllowed(status, VISIT_STATUSES, 'visit status');
  assertAllowed(coverageMode, COVERAGE_MODES, 'coverage mode');
  assertAllowed(demoType, DEMO_TYPES, 'demo type');
  if (!input.scheduled_start || !input.scheduled_end) {
    throw new Error('scheduled_start and scheduled_end are required.');
  }
  return {
    open_house_id: input.open_house_id || null,
    open_house_event_id: input.open_house_event_id || null,
    outreach_queue_id: input.outreach_queue_id || null,
    agent_slug: input.agent_slug || null,
    agent_name: input.agent_name || null,
    agent_phone: input.agent_phone || null,
    agent_email: input.agent_email || null,
    brokerage: input.brokerage || null,
    demo_sign_id: input.demo_sign_id || null,
    demo_public_code: input.demo_public_code || null,
    scheduled_start: input.scheduled_start,
    scheduled_end: input.scheduled_end,
    status,
    coverage_mode: coverageMode,
    demo_type: demoType,
    agent_onboarded: input.agent_onboarded === true,
    agent_keychain_uid: input.agent_keychain_uid || null,
    converted_to_virtual_support: input.converted_to_virtual_support === true,
    virtual_support_enabled_at: input.virtual_support_enabled_at || null,
    source: input.source || 'agent_outreach',
    notes: input.notes || null
  };
}

function normalizeParticipantPayload(input = {}, visitId = '') {
  const role = cleanText(input.role);
  const responsibility = cleanText(input.responsibility);
  const status = cleanText(input.status || 'assigned') || 'assigned';
  assertAllowed(role, ROLES, 'participant role');
  assertAllowed(responsibility, RESPONSIBILITIES, 'participant responsibility');
  assertAllowed(status, PARTICIPANT_STATUSES, 'participant status');
  return {
    field_demo_visit_id: input.field_demo_visit_id || visitId,
    participant_profile_id: input.participant_profile_id || null,
    participant_uid: input.participant_uid || null,
    participant_name: input.participant_name || null,
    participant_phone: input.participant_phone || null,
    participant_email: input.participant_email || null,
    participant_company: input.participant_company || null,
    role,
    responsibility,
    status,
    is_primary: input.is_primary === true
  };
}

async function getVisit(visitId) {
  if (!visitId) throw new Error('Missing field demo visit id.');
  return one(await supabaseRest(`field_demo_visits?id=eq.${enc(visitId)}&select=*&limit=1`));
}

async function getParticipants(visitId) {
  if (!visitId) return [];
  const rows = await supabaseRest(`field_demo_visit_participants?field_demo_visit_id=eq.${enc(visitId)}&select=*&order=is_primary.desc,created_at.asc`);
  return Array.isArray(rows) ? rows : [];
}

async function getParticipant(participantId) {
  if (!participantId) throw new Error('Missing participant id.');
  return one(await supabaseRest(`field_demo_visit_participants?id=eq.${enc(participantId)}&select=*&limit=1`));
}

async function getVerifiedProfile(participant) {
  if (!participant) return null;
  if (participant.participant_profile_id) {
    const byProfile = one(await supabaseRest(`verified_profiles?uid=eq.${enc(participant.participant_profile_id)}&select=*&limit=1`).catch(() => []));
    if (byProfile) return byProfile;
  }
  if (isUuid(participant.participant_uid)) {
    const byUid = one(await supabaseRest(`verified_profiles?uid=eq.${enc(participant.participant_uid)}&select=*&limit=1`).catch(() => []));
    if (byUid) return byUid;
  }
  return null;
}

function profileSessionPayload(eventId, participant, profile) {
  return {
    open_house_event_id: eventId,
    verified_profile_uid: profile?.uid || participant.participant_profile_id || null,
    loan_officer_uid: participant.participant_uid || profile?.uid || participant.participant_profile_id || null,
    loan_officer_slug: profile?.slug || '',
    loan_officer_name: participant.participant_name || profile?.full_name || '',
    loan_officer_title: profile?.title || '',
    loan_officer_company: participant.participant_company || profile?.company_name || '',
    loan_officer_phone: participant.participant_phone || profile?.phone || '',
    loan_officer_email: participant.participant_email || profile?.email || '',
    loan_officer_photo_url: profile?.photo_url || '',
    loan_officer_cta_url: profile?.cta_url || '',
    loan_officer_calendar_url: profile?.calendar_url || '',
    status: 'live',
    signed_out_at: null,
    last_seen_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  };
}

async function upsertLoanOfficerSession(eventId, participant) {
  if (!eventId || !participant || participant.responsibility !== 'financing_support') return null;
  const profile = await getVerifiedProfile(participant);
  const payload = profileSessionPayload(eventId, participant, profile);
  const existing = one(await supabaseRest(`event_loan_officer_sessions?open_house_event_id=eq.${enc(eventId)}&status=eq.live&select=*&limit=1`).catch(() => []));

  if (existing?.id) {
    return one(await supabaseRest(`event_loan_officer_sessions?id=eq.${enc(existing.id)}`, {
      method: 'PATCH',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify(payload)
    }));
  }

  return one(await supabaseRest('event_loan_officer_sessions', {
    method: 'POST',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify({
      ...payload,
      signed_in_at: new Date().toISOString()
    })
  }));
}

module.exports = {
  PARTICIPANT_STATUSES,
  RESPONSIBILITIES,
  VISIT_STATUSES,
  assertAllowed,
  assertMethod,
  cleanText,
  enc,
  getParticipant,
  getParticipants,
  getVisit,
  normalizeParticipantPayload,
  normalizeVisitPayload,
  one,
  participantTimestampPatch,
  readJsonBody,
  send,
  supabaseRest,
  upsertLoanOfficerSession,
  visitTimestampPatch
};
