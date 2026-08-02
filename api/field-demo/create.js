const {
  assertMethod,
  normalizeParticipantPayload,
  normalizeVisitPayload,
  one,
  readJsonBody,
  send,
  supabaseRest
} = require('../../lib/field-demo-shared');

function enc(value) {
  return encodeURIComponent(String(value || ''));
}

function isSchemaCacheError(error) {
  return /PGRST204|schema cache|column .* does not exist/i.test(String(error?.message || error));
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

async function findExistingVisit(payload) {
  const filters = [];
  if (payload.outreach_queue_id) filters.push(`outreach_queue_id=eq.${enc(payload.outreach_queue_id)}`);
  if (payload.open_house_event_id) filters.push(`open_house_event_id=eq.${enc(payload.open_house_event_id)}`);
  if (!filters.length && payload.open_house_id) {
    filters.push(
      `open_house_id=eq.${enc(payload.open_house_id)}&scheduled_start=eq.${enc(payload.scheduled_start)}&scheduled_end=eq.${enc(payload.scheduled_end)}`
    );
  }
  for (const filter of filters) {
    const existing = one(await supabaseRest(
      `field_demo_visits?${filter}&status=neq.cancelled&select=*&order=created_at.desc&limit=1`
    ).catch(() => []));
    if (existing?.id) return existing;
  }
  return null;
}

async function writeVisit(payload) {
  const existing = await findExistingVisit(payload);
  const nextPayload = existing?.status && !['scheduled', 'confirmed'].includes(existing.status)
    ? { ...payload, status: existing.status }
    : payload;
  const path = existing?.id ? `field_demo_visits?id=eq.${enc(existing.id)}` : 'field_demo_visits';
  const method = existing?.id ? 'PATCH' : 'POST';
  try {
    return one(await supabaseRest(path, {
      method,
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify(nextPayload)
    }));
  } catch (error) {
    if (!isSchemaCacheError(error)) throw error;
    return one(await supabaseRest(path, {
      method,
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify(stripNewVisitFields(nextPayload))
    }));
  }
}

async function findExistingParticipant(payload) {
  const identity = payload.participant_profile_id
    ? `participant_profile_id=eq.${enc(payload.participant_profile_id)}`
    : payload.participant_uid
      ? `participant_uid=eq.${enc(payload.participant_uid)}`
      : '';
  if (!identity) return null;
  return one(await supabaseRest(
    `field_demo_visit_participants?field_demo_visit_id=eq.${enc(payload.field_demo_visit_id)}&${identity}&role=eq.${enc(payload.role)}&responsibility=eq.${enc(payload.responsibility)}&select=*&limit=1`
  ).catch(() => []));
}

async function writeParticipant(payload) {
  const existing = await findExistingParticipant(payload);
  const path = existing?.id ? `field_demo_visit_participants?id=eq.${enc(existing.id)}` : 'field_demo_visit_participants';
  const method = existing?.id ? 'PATCH' : 'POST';
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

module.exports = async function handler(req, res) {
  try {
    if (!assertMethod(req, res)) return;

    const body = await readJsonBody(req);
    const visitPayload = normalizeVisitPayload(body);
    const visit = await writeVisit(visitPayload);

    if (!visit?.id) throw new Error('Field demo visit was not created.');

    const participants = [];
    for (const input of Array.isArray(body.participants) ? body.participants : []) {
      const participantPayload = normalizeParticipantPayload(input, visit.id);
      const created = await writeParticipant(participantPayload);
      if (created) participants.push(created);
    }

    const availabilityIds = participants.map((row) => row.availability_id).filter(Boolean);
    for (const availabilityId of availabilityIds) {
      await supabaseRest(`field_coverage_availability?id=eq.${enc(availabilityId)}`, {
        method: 'PATCH',
        body: JSON.stringify({
          status: 'booked',
          linked_visit_id: visit.id,
          updated_at: new Date().toISOString()
        })
      }).catch((error) => {
        console.log('[field-demo/create] availability booking skipped', availabilityId, error.message || error);
      });
    }

    send(res, 200, { ok: true, visit, participants });
  } catch (error) {
    console.error('[field-demo/create] failed', error);
    send(res, 500, { ok: false, error: error.message || 'Failed to create field demo visit.' });
  }
};
