const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ADMIN_TOKEN = process.env.ADMIN_DASHBOARD_TOKEN || process.env.KEY_RESET_ADMIN_TOKEN;

function send(res, status, payload) {
  res.status(status).json(payload);
}

function readBody(req) {
  if (!req.body) return {};
  if (typeof req.body === 'object') return req.body;
  try {
    return JSON.parse(req.body);
  } catch {
    return {};
  }
}

function authOk(req, body = {}) {
  if (!ADMIN_TOKEN) return false;
  const headerToken = req.headers['x-admin-token'];
  const bearer = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  return headerToken === ADMIN_TOKEN || bearer === ADMIN_TOKEN || body.admin_token === ADMIN_TOKEN;
}

function assertConfig() {
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.');
  if (!ADMIN_TOKEN) throw new Error('Missing ADMIN_DASHBOARD_TOKEN or KEY_RESET_ADMIN_TOKEN.');
}

function enc(value) {
  return encodeURIComponent(String(value || ''));
}

function one(rows) {
  return Array.isArray(rows) && rows.length ? rows[0] : null;
}

function addDays(date, days) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function extractZip(...values) {
  for (const value of values) {
    const match = String(value || '').match(/\b(\d{5})(?:-\d{4})?\b/);
    if (match) return match[1];
  }
  return '';
}

async function supabaseRequest(path, options = {}) {
  assertConfig();
  const response = await fetch(`${SUPABASE_URL.replace(/\/$/, '')}/rest/v1/${path}`, {
    ...options,
    headers: {
      apikey: SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json',
      ...(options.headers || {})
    }
  });
  const raw = await response.text().catch(() => '');
  if (!response.ok) throw new Error(raw || `Supabase request failed: ${response.status}`);
  return raw ? JSON.parse(raw) : null;
}

function profileName(profile) {
  return profile?.full_name || profile?.slug || 'Loan officer';
}

async function listFieldOps(body = {}) {
  const now = new Date();
  const from = body.from ? new Date(body.from) : new Date(now);
  from.setHours(0, 0, 0, 0);
  const to = body.to ? new Date(body.to) : addDays(from, Math.max(1, Math.min(Number(body.days || 14), 45)));
  const nowIso = now.toISOString();

  const [
    profiles,
    availability,
    visits,
    outreach
  ] = await Promise.all([
    supabaseRequest('verified_profiles?is_active=eq.true&select=uid,slug,industry,full_name,title,company_name,phone,email,photo_url,areas&order=full_name.asc&limit=250').catch(() => []),
    supabaseRequest(`field_coverage_availability?available_end=gte.${enc(nowIso)}&available_start=lt.${enc(to.toISOString())}&select=*&order=available_start.asc&limit=300`).catch(() => []),
    supabaseRequest(`field_demo_visits?scheduled_end=gte.${enc(from.toISOString())}&scheduled_start=lt.${enc(to.toISOString())}&select=*,field_demo_visit_participants(*)&order=scheduled_start.asc&limit=250`).catch(() => []),
    supabaseRequest([
      `agent_outreach_queue?open_start=gte.${enc(from.toISOString())}`,
      `open_start=lt.${enc(to.toISOString())}`,
      'select=id,open_house_id,agent_name,agent_first_name,agent_phone,agent_email,brokerage,address,zip,open_start,open_end,listing_photo_url,price,beds,baths,enrichment_status,generation_status,mockup_status,initial_send_status,followup_send_status,last_outreach_at',
      'order=open_start.asc',
      'limit=250'
    ].join('&')).catch(() => [])
  ]);

  const scheduledByOutreach = new Map((Array.isArray(visits) ? visits : [])
    .filter((visit) => visit.outreach_queue_id)
    .map((visit) => [visit.outreach_queue_id, visit]));

  const openAvailability = (Array.isArray(availability) ? availability : []).filter((slot) => slot.status === 'open');
  const onNow = openAvailability.filter((slot) => slot.available_start <= nowIso && slot.available_end >= nowIso);

  return {
    ok: true,
    range: { from: from.toISOString(), to: to.toISOString() },
    stats: {
      profiles: Array.isArray(profiles) ? profiles.length : 0,
      availability_open: openAvailability.length,
      on_now: onNow.length,
      visits: Array.isArray(visits) ? visits.length : 0,
      outreach: Array.isArray(outreach) ? outreach.length : 0,
      outreach_unscheduled: (Array.isArray(outreach) ? outreach : []).filter((row) => !scheduledByOutreach.has(row.id)).length
    },
    profiles: profiles || [],
    availability: availability || [],
    visits: visits || [],
    outreach: (outreach || []).map((row) => ({
      ...row,
      property_zip: row.zip || extractZip(row.address),
      field_visit: scheduledByOutreach.get(row.id) || null
    }))
  };
}

async function saveAvailability(body = {}) {
  const profile = one(await supabaseRequest(`verified_profiles?uid=eq.${enc(body.participant_uid || body.uid)}&is_active=eq.true&select=*&limit=1`));
  if (!profile?.uid) throw new Error('Verified profile not found.');

  const serviceZip = extractZip(body.service_zip || body.zip);
  if (!serviceZip) throw new Error('Service ZIP is required.');
  if (!body.available_start || !body.available_end) throw new Error('Availability start and end are required.');
  if (new Date(body.available_end) <= new Date(body.available_start)) throw new Error('Availability end must be after start.');

  const payload = {
    participant_profile_id: profile.uid,
    participant_uid: profile.uid,
    participant_slug: profile.slug || null,
    participant_name: profileName(profile),
    participant_phone: profile.phone || null,
    participant_email: profile.email || null,
    participant_company: profile.company_name || null,
    role: body.role || 'loan_officer',
    responsibility: body.responsibility || 'financing_support',
    available_start: body.available_start,
    available_end: body.available_end,
    service_zip: serviceZip,
    service_radius_miles: Math.max(1, Math.min(Number(body.service_radius_miles || 15), 250)),
    status: body.status || 'open',
    notes: body.notes || null,
    updated_at: new Date().toISOString()
  };

  const row = one(await supabaseRequest('field_coverage_availability', {
    method: 'POST',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify(payload)
  }));

  return { ok: true, availability: row };
}

async function assignVisit(body = {}) {
  const queueId = body.outreach_queue_id;
  const participantUid = body.participant_uid || body.uid;
  if (!queueId) throw new Error('Missing outreach_queue_id.');
  if (!participantUid) throw new Error('Missing participant_uid.');

  const queue = one(await supabaseRequest(`agent_outreach_queue?id=eq.${enc(queueId)}&select=*&limit=1`));
  if (!queue?.id) throw new Error('Outreach row not found.');
  const profile = one(await supabaseRequest(`verified_profiles?uid=eq.${enc(participantUid)}&is_active=eq.true&select=*&limit=1`));
  if (!profile?.uid) throw new Error('Verified loan officer profile not found.');

  const scheduledStart = queue.open_start || body.scheduled_start;
  const scheduledEnd = queue.open_end || body.scheduled_end;
  if (!scheduledStart || !scheduledEnd) throw new Error('The outreach row needs open_start/open_end before assignment.');

  const propertyZip = body.property_zip || queue.zip || extractZip(queue.address);
  let visit = one(await supabaseRequest(`field_demo_visits?outreach_queue_id=eq.${enc(queue.id)}&status=neq.cancelled&select=*&order=created_at.desc&limit=1`).catch(() => []));

  if (!visit?.id) {
    visit = one(await supabaseRequest('field_demo_visits', {
      method: 'POST',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify({
        outreach_queue_id: queue.id,
        open_house_id: queue.open_house_id || null,
        agent_name: queue.agent_name || queue.agent_first_name || null,
        agent_phone: queue.agent_phone || null,
        agent_email: queue.agent_email || null,
        brokerage: queue.brokerage || null,
        property_zip: propertyZip || null,
        scheduled_start: scheduledStart,
        scheduled_end: scheduledEnd,
        status: 'scheduled',
        coverage_mode: body.coverage_mode || 'physical_support',
        demo_type: body.demo_type || 'buyer_financing_support',
        source: 'admin_field_ops',
        assignment_source: 'manual_admin',
        assigned_by_availability_id: body.availability_id || null,
        notes: body.notes || `Admin assigned ${profileName(profile)} to ${queue.address || queue.open_house_id || 'open house'}.`
      })
    }));
  }

  const responsibility = body.responsibility || 'financing_support';
  const role = body.role || 'loan_officer';
  const existingParticipant = one(await supabaseRequest(
    `field_demo_visit_participants?field_demo_visit_id=eq.${enc(visit.id)}&participant_uid=eq.${enc(profile.uid)}&responsibility=eq.${enc(responsibility)}&select=*&limit=1`
  ).catch(() => []));

  const participantPayload = {
    field_demo_visit_id: visit.id,
    participant_profile_id: profile.uid,
    participant_uid: profile.uid,
    participant_name: profileName(profile),
    participant_phone: profile.phone || null,
    participant_email: profile.email || null,
    participant_company: profile.company_name || null,
    role,
    responsibility,
    status: 'assigned',
    is_primary: true,
    availability_id: body.availability_id || null,
    assignment_score: body.assignment_score || null,
    assignment_reason: body.assignment_reason || 'Manual admin assignment'
  };

  await supabaseRequest(
    `field_demo_visit_participants?field_demo_visit_id=eq.${enc(visit.id)}&responsibility=eq.${enc(responsibility)}&is_primary=eq.true`,
    {
      method: 'PATCH',
      body: JSON.stringify({ is_primary: false })
    }
  ).catch(() => null);

  const participant = existingParticipant?.id
    ? one(await supabaseRequest(`field_demo_visit_participants?id=eq.${enc(existingParticipant.id)}`, {
        method: 'PATCH',
        headers: { Prefer: 'return=representation' },
        body: JSON.stringify(participantPayload)
      }))
    : one(await supabaseRequest('field_demo_visit_participants', {
        method: 'POST',
        headers: { Prefer: 'return=representation' },
        body: JSON.stringify(participantPayload)
      }));

  if (body.availability_id) {
    await supabaseRequest(`field_coverage_availability?id=eq.${enc(body.availability_id)}`, {
      method: 'PATCH',
      body: JSON.stringify({
        status: 'booked',
        linked_visit_id: visit.id,
        updated_at: new Date().toISOString()
      })
    }).catch(() => null);
  }

  return { ok: true, visit, participant, queue };
}

module.exports = async function handler(req, res) {
  try {
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST');
      send(res, 405, { ok: false, error: 'Method not allowed.' });
      return;
    }

    const body = readBody(req);
    if (!authOk(req, body)) {
      send(res, 401, { ok: false, error: 'Unauthorized.' });
      return;
    }

    const action = String(body.action || 'list').trim();
    if (action === 'list') {
      send(res, 200, await listFieldOps(body));
      return;
    }
    if (action === 'save_availability') {
      send(res, 200, await saveAvailability(body));
      return;
    }
    if (action === 'assign_visit') {
      send(res, 200, await assignVisit(body));
      return;
    }

    throw new Error(`Unknown action: ${action}`);
  } catch (error) {
    console.error('[admin/field-ops] failed', error);
    send(res, 500, { ok: false, error: error.message || 'Field ops admin request failed.' });
  }
};
