const {
  assertMethod,
  enc,
  getParticipant,
  getParticipants,
  getVisit,
  one,
  participantTimestampPatch,
  readJsonBody,
  send,
  supabaseRest,
  upsertLoanOfficerSession,
  visitTimestampPatch
} = require('../../lib/field-demo-shared');

function chooseFinancingParticipant(participants, requestedParticipant) {
  if (requestedParticipant?.responsibility === 'financing_support') return requestedParticipant;
  return participants.find((row) => row.responsibility === 'financing_support' && row.status !== 'cancelled' && row.is_primary)
    || participants.find((row) => row.responsibility === 'financing_support' && row.status !== 'cancelled')
    || null;
}

module.exports = async function handler(req, res) {
  try {
    if (!assertMethod(req, res)) return;

    const body = await readJsonBody(req);
    const visitId = body.id || body.visit_id || body.field_demo_visit_id;
    if (!visitId) throw new Error('Missing field demo visit id.');

    const visit = await getVisit(visitId);
    if (!visit?.id) throw new Error('Field demo visit not found.');

    const now = new Date().toISOString();
    const updatedVisit = one(await supabaseRest(`field_demo_visits?id=eq.${enc(visit.id)}`, {
      method: 'PATCH',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify({
        status: 'live',
        ...visitTimestampPatch('live', now)
      })
    }));

    let requestedParticipant = null;
    if (body.participant_id) {
      requestedParticipant = await getParticipant(body.participant_id);
      if (requestedParticipant?.id) {
        requestedParticipant = one(await supabaseRest(`field_demo_visit_participants?id=eq.${enc(requestedParticipant.id)}`, {
          method: 'PATCH',
          headers: { Prefer: 'return=representation' },
          body: JSON.stringify({
            status: 'live',
            ...participantTimestampPatch('on_site', now)
          })
        })) || requestedParticipant;
      }
    }

    const participants = await getParticipants(visit.id);
    const financingParticipant = chooseFinancingParticipant(participants, requestedParticipant);
    let loanOfficerSession = null;
    if (updatedVisit?.open_house_event_id && financingParticipant) {
      loanOfficerSession = await upsertLoanOfficerSession(updatedVisit.open_house_event_id, financingParticipant);
    }

    send(res, 200, {
      ok: true,
      visit: updatedVisit,
      participant: requestedParticipant,
      loanOfficerSession
    });
  } catch (error) {
    console.error('[field-demo/start] failed', error);
    send(res, 500, { ok: false, error: error.message || 'Failed to start field demo.' });
  }
};
