const {
  PARTICIPANT_STATUSES,
  assertAllowed,
  assertMethod,
  enc,
  one,
  participantTimestampPatch,
  readJsonBody,
  send,
  supabaseRest
} = require('../../lib/field-demo-shared');

module.exports = async function handler(req, res) {
  try {
    if (!assertMethod(req, res)) return;

    const body = await readJsonBody(req);
    const participantId = body.id || body.participant_id;
    const status = String(body.status || '').trim();
    if (!participantId) throw new Error('Missing participant id.');
    assertAllowed(status, PARTICIPANT_STATUSES, 'participant status');

    const participant = one(await supabaseRest(`field_demo_visit_participants?id=eq.${enc(participantId)}`, {
      method: 'PATCH',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify({
        status,
        ...participantTimestampPatch(status)
      })
    }));

    send(res, 200, { ok: true, participant });
  } catch (error) {
    console.error('[field-demo/update-participant-status] failed', error);
    send(res, 500, { ok: false, error: error.message || 'Failed to update field demo participant.' });
  }
};
