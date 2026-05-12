const {
  assertMethod,
  normalizeParticipantPayload,
  normalizeVisitPayload,
  one,
  readJsonBody,
  send,
  supabaseRest
} = require('../../lib/field-demo-shared');

module.exports = async function handler(req, res) {
  try {
    if (!assertMethod(req, res)) return;

    const body = await readJsonBody(req);
    const visitPayload = normalizeVisitPayload(body);
    const visit = one(await supabaseRest('field_demo_visits', {
      method: 'POST',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify(visitPayload)
    }));

    if (!visit?.id) throw new Error('Field demo visit was not created.');

    const participants = [];
    for (const input of Array.isArray(body.participants) ? body.participants : []) {
      const participantPayload = normalizeParticipantPayload(input, visit.id);
      const created = one(await supabaseRest('field_demo_visit_participants', {
        method: 'POST',
        headers: { Prefer: 'return=representation' },
        body: JSON.stringify(participantPayload)
      }));
      if (created) participants.push(created);
    }

    send(res, 200, { ok: true, visit, participants });
  } catch (error) {
    console.error('[field-demo/create] failed', error);
    send(res, 500, { ok: false, error: error.message || 'Failed to create field demo visit.' });
  }
};
