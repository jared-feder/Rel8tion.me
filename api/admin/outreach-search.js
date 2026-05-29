const { adminAuthorized, assertAdminConfig, sendJson, supabaseRest } = require('../../lib/admin-auth');

const QUEUE_SELECT = [
  'id',
  'open_house_id',
  'outreach_code',
  'agent_name',
  'agent_phone',
  'agent_phone_normalized',
  'agent_email',
  'brokerage',
  'address',
  'city',
  'state',
  'zip',
  'price',
  'beds',
  'baths',
  'open_start',
  'open_end',
  'template_key',
  'listing_photo_url',
  'agent_photo_url',
  'mockup_image_url',
  'selected_sms',
  'followup_sms',
  'review_status',
  'report_note',
  'report_note_updated_at',
  'initial_send_status',
  'initial_sent_at',
  'initial_delivery_status',
  'followup_send_status',
  'followup_send_at',
  'followup_sent_at',
  'send_mode',
  'last_outreach_at',
  'created_at'
].join(',');

function readQuery(req, name) {
  const value = req.query?.[name];
  if (Array.isArray(value)) return value[0] || '';
  return value || '';
}

function cleanSearch(value) {
  return String(value || '')
    .replace(/[,*()]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function clampLimit(value) {
  const parsed = Number(value || 40);
  if (!Number.isFinite(parsed)) return 40;
  return Math.max(1, Math.min(parsed, 80));
}

function ilike(column, value) {
  return `${column}.ilike.*${encodeURIComponent(value)}*`;
}

async function searchQueue(q, limit) {
  const query = cleanSearch(q);
  if (query.length < 2) return [];
  const digits = query.replace(/\D/g, '');
  const filters = [
    ilike('agent_name', query),
    ilike('brokerage', query),
    ilike('address', query),
    ilike('city', query),
    ilike('state', query),
    ilike('zip', query),
    ilike('agent_phone', query),
    ilike('agent_email', query),
    ilike('open_house_id', query),
    ilike('outreach_code', query),
    ilike('report_note', query)
  ];

  if (digits.length >= 4) filters.push(ilike('agent_phone_normalized', digits));

  return supabaseRest(
    `agent_outreach_queue?select=${QUEUE_SELECT}&or=(${filters.join(',')})&order=created_at.desc&limit=${limit}`
  );
}

module.exports = async function handler(req, res) {
  try {
    if (req.method !== 'GET') {
      res.setHeader('Allow', 'GET');
      sendJson(res, 405, { ok: false, error: 'Method not allowed.' });
      return;
    }

    assertAdminConfig();
    const auth = adminAuthorized(req);
    if (!auth.ok) {
      sendJson(res, 401, { ok: false, error: auth.error });
      return;
    }

    const q = readQuery(req, 'q');
    const limit = clampLimit(readQuery(req, 'limit'));
    const rows = await searchQueue(q, limit);
    sendJson(res, 200, {
      ok: true,
      query: cleanSearch(q),
      rows: Array.isArray(rows) ? rows : [],
      loaded_at: new Date().toISOString()
    });
  } catch (error) {
    sendJson(res, error.status || 500, {
      ok: false,
      error: error.message || 'Unable to search outreach.',
      details: error.payload || null
    });
  }
};
