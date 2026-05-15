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

function one(rows) {
  return Array.isArray(rows) ? rows[0] || null : null;
}

function isSchemaCacheError(error) {
  return /PGRST204|schema cache|column .* does not exist/i.test(String(error?.message || error));
}

function fallbackEnd(start) {
  const date = new Date(start || Date.now());
  if (!Number.isFinite(date.getTime())) return new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();
  return new Date(date.getTime() + 2 * 60 * 60 * 1000).toISOString();
}

function cleanPhone(value) {
  return String(value || '').replace(/\D/g, '');
}

async function loadQueueRow(rowId) {
  const row = one(await supabaseRest(`agent_outreach_queue?id=eq.${enc(rowId)}&select=*&limit=1`));
  if (!row) {
    const error = new Error('Outreach queue row not found.');
    error.status = 404;
    throw error;
  }
  return row;
}

async function loadLoanOfficer(uid) {
  if (!uid) return null;
  const row = one(await supabaseRest(`verified_profiles?uid=eq.${enc(uid)}&is_active=eq.true&select=*&limit=1`));
  if (!row) {
    const error = new Error('Active loan officer not found.');
    error.status = 404;
    throw error;
  }
  return row;
}

async function loadMatchingEvent(queue) {
  if (!queue.open_house_id) return null;
  return one(await supabaseRest(
    `open_house_events?open_house_source_id=eq.${enc(queue.open_house_id)}&status=eq.active&select=*&order=created_at.desc&limit=1`
  ).catch(() => []));
}

async function patchQueue(rowId, payload) {
  return one(await supabaseRest(`agent_outreach_queue?id=eq.${enc(rowId)}`, {
    method: 'PATCH',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify(payload)
  }));
}

async function markInterested(rowId, status = 'interested') {
  return patchQueue(rowId, {
    review_status: status,
    send_error: null
  });
}

function stripNewVisitFields(payload) {
  const clone = { ...payload };
  delete clone.property_zip;
  delete clone.assignment_source;
  delete clone.assigned_by_availability_id;
  return clone;
}

function stripNewParticipantFields(payload) {
  const clone = { ...payload };
  delete clone.availability_id;
  delete clone.assignment_score;
  delete clone.assignment_reason;
  return clone;
}

async function writeVisit(path, payload, method = 'POST') {
  try {
    return one(await supabaseRest(path, {
      method,
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify(payload)
    }));
  } catch (error) {
    if (!isSchemaCacheError(error)) throw error;
    return one(await supabaseRest(path, {
      method,
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify(stripNewVisitFields(payload))
    }));
  }
}

async function writeParticipant(path, payload, method = 'POST') {
  try {
    return one(await supabaseRest(path, {
      method,
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify(payload)
    }));
  } catch (error) {
    if (!isSchemaCacheError(error)) throw error;
    return one(await supabaseRest(path, {
      method,
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify(stripNewParticipantFields(payload))
    }));
  }
}

async function upsertFieldVisit(queue, options = {}) {
  const event = await loadMatchingEvent(queue);
  const now = new Date().toISOString();
  const scheduledStart = queue.open_start || new Date(Date.now() + 60 * 60 * 1000).toISOString();
  const scheduledEnd = queue.open_end || fallbackEnd(scheduledStart);
  const address = [queue.address, queue.city, queue.state, queue.zip].filter(Boolean).join(', ');
  const existing = one(await supabaseRest(
    `field_demo_visits?outreach_queue_id=eq.${enc(queue.id)}&status=neq.cancelled&select=*&order=created_at.desc&limit=1`
  ).catch(() => []));

  const payload = {
    open_house_id: queue.open_house_id || null,
    open_house_event_id: event?.id || existing?.open_house_event_id || null,
    outreach_queue_id: queue.id,
    agent_slug: existing?.agent_slug || null,
    agent_name: queue.agent_name || null,
    agent_phone: queue.agent_phone || null,
    agent_email: queue.agent_email || null,
    brokerage: queue.brokerage || null,
    demo_sign_id: event?.smart_sign_id || existing?.demo_sign_id || null,
    demo_public_code: existing?.demo_public_code || null,
    property_zip: queue.zip || null,
    scheduled_start: scheduledStart,
    scheduled_end: scheduledEnd,
    status: existing?.status && existing.status !== 'scheduled' ? existing.status : 'confirmed',
    coverage_mode: 'physical_support',
    demo_type: 'buyer_financing_support',
    source: options.source || 'admin_interested_reply',
    assignment_source: options.assignment_source || 'accepted_outreach',
    notes: [
      `${options.note_prefix || 'Accepted from REL8TION COMMAND outreach reply'} on ${now}.`,
      address ? `Open house: ${address}.` : '',
      queue.agent_phone ? `Agent phone: ${queue.agent_phone}.` : ''
    ].filter(Boolean).join(' ')
  };

  if (payload.status === 'confirmed') payload.confirmed_at = existing?.confirmed_at || now;

  return existing?.id
    ? writeVisit(`field_demo_visits?id=eq.${enc(existing.id)}`, payload, 'PATCH')
    : writeVisit('field_demo_visits', payload, 'POST');
}

async function upsertVisitParticipant(visit, profile) {
  if (!visit?.id || !profile?.uid) return null;

  await supabaseRest(
    `field_demo_visit_participants?field_demo_visit_id=eq.${enc(visit.id)}&responsibility=eq.financing_support&is_primary=eq.true`,
    {
      method: 'PATCH',
      body: JSON.stringify({ is_primary: false })
    }
  ).catch(() => null);

  const existing = one(await supabaseRest(
    `field_demo_visit_participants?field_demo_visit_id=eq.${enc(visit.id)}&participant_profile_id=eq.${enc(profile.uid)}&responsibility=eq.financing_support&select=*&limit=1`
  ).catch(() => []));

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
    assignment_reason: 'Accepted open house from admin outreach reply'
  };

  return existing?.id
    ? writeParticipant(`field_demo_visit_participants?id=eq.${enc(existing.id)}`, payload, 'PATCH')
    : writeParticipant('field_demo_visit_participants', payload, 'POST');
}

function sessionPayload(eventId, profile) {
  const now = new Date().toISOString();
  return {
    open_house_event_id: eventId,
    verified_profile_uid: profile.uid,
    loan_officer_uid: profile.uid,
    loan_officer_slug: profile.slug || '',
    loan_officer_name: profile.full_name || profile.name || '',
    loan_officer_title: profile.title || '',
    loan_officer_company: profile.company_name || profile.company || '',
    loan_officer_phone: profile.phone || '',
    loan_officer_email: profile.email || '',
    loan_officer_photo_url: profile.photo_url || profile.image_url || profile.avatar_url || '',
    loan_officer_cta_url: profile.cta_url || profile.website || profile.url || '',
    loan_officer_calendar_url: profile.calendar_url || '',
    status: 'live',
    signed_in_at: now,
    last_seen_at: now,
    updated_at: now
  };
}

async function upsertLiveCoverageIfEventLinked(visit, profile) {
  if (!visit?.open_house_event_id || !profile?.uid) return null;

  await supabaseRest(
    `event_loan_officer_sessions?open_house_event_id=eq.${enc(visit.open_house_event_id)}&status=eq.live`,
    {
      method: 'PATCH',
      body: JSON.stringify({
        status: 'ended',
        signed_out_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      })
    }
  ).catch(() => null);

  return one(await supabaseRest('event_loan_officer_sessions', {
    method: 'POST',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify(sessionPayload(visit.open_house_event_id, profile))
  }).catch(() => []));
}

async function acceptOpenHouse(body) {
  const queue = await loadQueueRow(body.queue_row_id);
  if (queue.review_status === 'opted_out') {
    const error = new Error('This contact is opted out.');
    error.status = 409;
    throw error;
  }

  const profile = body.loan_officer_uid ? await loadLoanOfficer(body.loan_officer_uid) : null;
  const visit = await upsertFieldVisit(queue);
  const participant = profile ? await upsertVisitParticipant(visit, profile) : null;
  const live_coverage = profile ? await upsertLiveCoverageIfEventLinked(visit, profile) : null;
  const updated_queue = await markInterested(queue.id, 'accepted_open_house');

  return { queue: updated_queue || queue, visit, participant, live_coverage, loan_officer: profile };
}

async function confirmOpenHouse(body) {
  const queue = await loadQueueRow(body.queue_row_id);
  if (queue.review_status === 'opted_out') {
    const error = new Error('This contact is opted out.');
    error.status = 409;
    throw error;
  }

  const visit = await upsertFieldVisit(queue, {
    source: 'admin_confirmed_open_house',
    assignment_source: 'confirmed_outreach',
    note_prefix: 'Confirmed as a true open house from REL8TION COMMAND outreach'
  });
  const updated_queue = await markInterested(queue.id, 'confirmed_open_house');

  return { queue: updated_queue || queue, visit };
}

async function scheduleDrip(body) {
  const queue = await loadQueueRow(body.queue_row_id);
  const text = String(body.body || '').replace(/\s+\n/g, '\n').trim();
  const sendAt = new Date(body.send_at || '');

  if (queue.review_status === 'opted_out') {
    const error = new Error('This contact is opted out.');
    error.status = 409;
    throw error;
  }
  if (!text) {
    const error = new Error('Drip message body is required.');
    error.status = 400;
    throw error;
  }
  if (!Number.isFinite(sendAt.getTime())) {
    const error = new Error('A valid drip send date/time is required.');
    error.status = 400;
    throw error;
  }
  if (sendAt.getTime() < Date.now() - 5 * 60 * 1000) {
    const error = new Error('Drip send time must be in the future.');
    error.status = 400;
    throw error;
  }
  if (queue.initial_send_status !== 'sent' || !queue.initial_sent_at) {
    const error = new Error('Cannot schedule a drip until the initial outreach has been sent.');
    error.status = 409;
    throw error;
  }
  if (!cleanPhone(queue.agent_phone_normalized || queue.agent_phone)) {
    const error = new Error('Cannot schedule a drip without a valid agent phone.');
    error.status = 409;
    throw error;
  }

  const updated = await patchQueue(queue.id, {
    followup_sms: text,
    followup_send_at: sendAt.toISOString(),
    followup_send_status: 'pending',
    followup_block_reason: null,
    approved_for_send: true,
    send_mode: 'automatic',
    review_status: 'drip_scheduled',
    send_error: null
  });

  return { queue: updated || queue };
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
    const action = String(body.action || '').trim();
    if (!body.queue_row_id) {
      sendJson(res, 400, { ok: false, error: 'Missing queue_row_id.' });
      return;
    }

    if (action === 'mark_interested') {
      const queue = await markInterested(body.queue_row_id);
      sendJson(res, 200, { ok: true, action, queue });
      return;
    }

    if (action === 'accept_open_house') {
      const result = await acceptOpenHouse(body);
      sendJson(res, 200, { ok: true, action, ...result });
      return;
    }

    if (action === 'confirm_open_house') {
      const result = await confirmOpenHouse(body);
      sendJson(res, 200, { ok: true, action, ...result });
      return;
    }

    if (action === 'schedule_drip') {
      const result = await scheduleDrip(body);
      sendJson(res, 200, { ok: true, action, ...result });
      return;
    }

    sendJson(res, 400, { ok: false, error: 'Unsupported outreach action.' });
  } catch (error) {
    sendJson(res, error.status || 500, {
      ok: false,
      error: error.message || 'Unable to update outreach workflow.',
      details: error.payload || null
    });
  }
};
