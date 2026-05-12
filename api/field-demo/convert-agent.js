const {
  assertMethod,
  enc,
  getVisit,
  one,
  readJsonBody,
  send,
  supabaseRest
} = require('../../lib/field-demo-shared');

module.exports = async function handler(req, res) {
  try {
    if (!assertMethod(req, res)) return;

    const body = await readJsonBody(req);
    const visitId = body.id || body.visit_id || body.field_demo_visit_id;
    if (!visitId) throw new Error('Missing field demo visit id.');

    const visit = await getVisit(visitId);
    if (!visit?.id) throw new Error('Field demo visit not found.');

    const now = new Date().toISOString();
    const patch = {
      status: 'converted',
      converted_to_virtual_support: true,
      virtual_support_enabled_at: now,
      converted_at: now
    };

    if (body.agent_onboarded === true || visit.agent_onboarded === true) {
      patch.agent_onboarded = true;
    }
    if (body.agent_keychain_uid || visit.agent_keychain_uid) {
      patch.agent_keychain_uid = body.agent_keychain_uid || visit.agent_keychain_uid;
    }

    const updated = one(await supabaseRest(`field_demo_visits?id=eq.${enc(visit.id)}`, {
      method: 'PATCH',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify(patch)
    }));

    send(res, 200, {
      ok: true,
      visit: updated,
      relationship: {
        created: false,
        todo: 'No agent/loan-officer relationship table is implemented in the current repo. Conversion is recorded on field_demo_visits only.'
      }
    });
  } catch (error) {
    console.error('[field-demo/convert-agent] failed', error);
    send(res, 500, { ok: false, error: error.message || 'Failed to convert agent to virtual support.' });
  }
};
