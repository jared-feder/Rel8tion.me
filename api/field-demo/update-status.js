const {
  VISIT_STATUSES,
  assertAllowed,
  assertMethod,
  enc,
  one,
  readJsonBody,
  send,
  supabaseRest,
  visitTimestampPatch
} = require('../../lib/field-demo-shared');

module.exports = async function handler(req, res) {
  try {
    if (!assertMethod(req, res)) return;

    const body = await readJsonBody(req);
    const visitId = body.id || body.visit_id || body.field_demo_visit_id;
    const status = String(body.status || '').trim();
    if (!visitId) throw new Error('Missing field demo visit id.');
    assertAllowed(status, VISIT_STATUSES, 'visit status');

    const patch = {
      status,
      ...visitTimestampPatch(status)
    };
    if (Object.prototype.hasOwnProperty.call(body, 'notes')) patch.notes = body.notes || null;

    const visit = one(await supabaseRest(`field_demo_visits?id=eq.${enc(visitId)}`, {
      method: 'PATCH',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify(patch)
    }));

    send(res, 200, { ok: true, visit });
  } catch (error) {
    console.error('[field-demo/update-status] failed', error);
    send(res, 500, { ok: false, error: error.message || 'Failed to update field demo visit.' });
  }
};
