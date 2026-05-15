const { readJsonBody, send, supabaseRest } = require('../../lib/outreach-cron-shared');

function enc(value) {
  return encodeURIComponent(String(value || ''));
}

function addDays(date, days) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

module.exports = async function handler(req, res) {
  try {
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST');
      send(res, 405, { ok: false, error: 'Method not allowed.' });
      return;
    }

    const body = readJsonBody(req);
    const uid = String(body.uid || body.participant_uid || '').trim();
    const slug = String(body.slug || '').trim();
    if (!uid && !slug) throw new Error('Missing verified profile uid or slug.');

    const profileFilter = uid ? `uid=eq.${enc(uid)}` : `slug=eq.${enc(slug)}`;
    const profile = await supabaseRest(`verified_profiles?${profileFilter}&is_active=eq.true&select=uid,slug&limit=1`).catch(() => []);
    if (!Array.isArray(profile) || !profile[0]) {
      send(res, 403, { ok: false, error: 'Verified field profile required.' });
      return;
    }

    const now = new Date();
    const from = new Date(now);
    from.setHours(0, 0, 0, 0);
    const to = addDays(from, Math.max(1, Math.min(Number(body.days || 10), 21)));
    const limit = Math.max(1, Math.min(Number(body.limit || 40), 100));

    const select = [
      'id',
      'open_house_id',
      'agent_name',
      'agent_first_name',
      'agent_phone',
      'agent_email',
      'brokerage',
      'address',
      'zip',
      'selected_sms',
      'open_start',
      'open_end',
      'listing_photo_url',
      'price',
      'beds',
      'baths',
      'enrichment_status',
      'generation_status',
      'mockup_status',
      'initial_send_status',
      'followup_send_status',
      'last_outreach_at'
    ].join(',');

    const rows = await supabaseRest(
      `agent_outreach_queue?open_start=gte.${enc(from.toISOString())}&open_start=lt.${enc(to.toISOString())}&select=${select}&order=open_start.asc&limit=${limit}`
    ).catch(() => []);

    const visitRows = await supabaseRest(
      `field_demo_visits?scheduled_start=gte.${enc(from.toISOString())}&scheduled_start=lt.${enc(to.toISOString())}&select=id,outreach_queue_id,status,scheduled_start&limit=200`
    ).catch(() => []);
    const scheduledByQueue = new Map((Array.isArray(visitRows) ? visitRows : [])
      .filter((row) => row.outreach_queue_id)
      .map((row) => [row.outreach_queue_id, row]));

    const candidates = (Array.isArray(rows) ? rows : [])
      .filter((row) => row.agent_phone && row.open_start)
      .map((row) => ({
        ...row,
        field_visit: scheduledByQueue.get(row.id) || null
      }));

    send(res, 200, { ok: true, candidates });
  } catch (error) {
    console.error('[field-demo/outreach-candidates] failed', error);
    send(res, 500, { ok: false, error: error.message || 'Failed to load outreach candidates.' });
  }
};
