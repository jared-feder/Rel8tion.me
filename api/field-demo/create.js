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

module.exports = async function handler(req, res) {
  try {
    if (!assertMethod(req, res)) return;

    const body = await readJsonBody(req);
    const visitPayload = normalizeVisitPayload(body);
    let visit = null;
    try {
      visit = one(await supabaseRest('field_demo_visits', {
        method: 'POST',
        headers: { Prefer: 'return=representation' },
        body: JSON.stringify(visitPayload)
      }));
    } catch (error) {
      if (!isSchemaCacheError(error)) throw error;
      visit = one(await supabaseRest('field_demo_visits', {
        method: 'POST',
        headers: { Prefer: 'return=representation' },
        body: JSON.stringify(stripNewVisitFields(visitPayload))
      }));
    }

    if (!visit?.id) throw new Error('Field demo visit was not created.');

    const participants = [];
    for (const input of Array.isArray(body.participants) ? body.participants : []) {
      const participantPayload = normalizeParticipantPayload(input, visit.id);
      let created = null;
      try {
        created = one(await supabaseRest('field_demo_visit_participants', {
          method: 'POST',
          headers: { Prefer: 'return=representation' },
          body: JSON.stringify(participantPayload)
        }));
      } catch (error) {
        if (!isSchemaCacheError(error)) throw error;
        created = one(await supabaseRest('field_demo_visit_participants', {
          method: 'POST',
          headers: { Prefer: 'return=representation' },
          body: JSON.stringify(stripNewParticipantFields(participantPayload))
        }));
      }
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
