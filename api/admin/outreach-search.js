const { adminAuthorized, assertAdminConfig, sendJson, supabaseRest } = require('../../lib/admin-auth');

const CORS_HEADERS = {
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Admin-Uid, X-Admin-Token',
  'Access-Control-Max-Age': '600'
};

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

const OPEN_HOUSE_SELECT = [
  'id',
  'address',
  'price',
  'beds',
  'baths',
  'open_start',
  'open_end',
  'image',
  'agent',
  'agent_phone',
  'agent_email',
  'brokerage',
  'created_at',
  'updated_at'
].join(',');

const LISTING_AGENT_SELECT = [
  'id',
  'open_house_id',
  'name',
  'phone',
  'phone_normalized',
  'email',
  'brokerage',
  'source',
  'is_primary',
  'primary_photo_url',
  'directory_photo_url',
  'profile_url',
  'created_at',
  'scraped_at'
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

function enc(value) {
  return encodeURIComponent(String(value || ''));
}

function inFilter(values) {
  return `(${values.map(enc).join(',')})`;
}

function phoneDigits(value) {
  return String(value || '').replace(/\D/g, '');
}

function compactKey(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function allowCors(req, res) {
  const origin = String(req.headers?.origin || '').trim();
  if (origin) {
    try {
      const host = new URL(origin).hostname.toLowerCase();
      const allowed =
        host === 'app.rel8tion.me' ||
        host === 'getrel8tion.com' ||
        host === 'www.getrel8tion.com' ||
        host.endsWith('.vercel.app') ||
        host === 'localhost' ||
        host === '127.0.0.1';
      if (allowed) {
        res.setHeader('Access-Control-Allow-Origin', origin);
        res.setHeader('Vary', 'Origin');
      }
    } catch (_) {}
  }
  for (const [key, value] of Object.entries(CORS_HEADERS)) {
    res.setHeader(key, value);
  }
}

function addressTokens(query) {
  const stop = new Set([
    'ny',
    'new',
    'york',
    'street',
    'st',
    'avenue',
    'ave',
    'road',
    'rd',
    'drive',
    'dr',
    'lane',
    'ln',
    'court',
    'ct',
    'place',
    'pl',
    'boulevard',
    'blvd',
    'south',
    'north',
    'east',
    'west',
    's',
    'n',
    'e',
    'w'
  ]);

  return query
    .toLowerCase()
    .split(/\s+/)
    .map((part) => part.replace(/[^a-z0-9#-]/g, ''))
    .filter((part) => part.length >= 2 && !stop.has(part))
    .slice(0, 6);
}

function andIlike(column, values) {
  const filters = values.map((value) => ilike(column, value));
  return filters.length ? `and(${filters.join(',')})` : '';
}

function uniqueById(rows) {
  const seen = new Set();
  const out = [];
  for (const row of rows || []) {
    const id = row?.id || '';
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(row);
  }
  return out;
}

async function safeSearch(label, warnings, fn) {
  try {
    const rows = await fn();
    return Array.isArray(rows) ? rows : [];
  } catch (error) {
    warnings.push({
      source: label,
      status: error.status || null,
      error: error.message || 'Search source failed.'
    });
    return [];
  }
}

async function searchQueue(q, limit) {
  const query = cleanSearch(q);
  if (query.length < 2) return [];
  const digits = query.replace(/\D/g, '');
  const tokens = addressTokens(query);
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
  if (tokens.length >= 2) {
    filters.push(andIlike('address', tokens));
  }

  return supabaseRest(
    `agent_outreach_queue?select=${QUEUE_SELECT}&or=(${filters.filter(Boolean).join(',')})&order=created_at.desc&limit=${limit}`
  );
}

async function searchOpenHouses(q, limit) {
  const query = cleanSearch(q);
  if (query.length < 2) return [];
  const tokens = addressTokens(query);
  const filters = [
    ilike('address', query),
    ilike('id', query),
    ilike('agent', query),
    ilike('agent_phone', query),
    ilike('brokerage', query)
  ];
  if (tokens.length >= 2) filters.push(andIlike('address', tokens));

  return supabaseRest(
    `open_houses?select=${OPEN_HOUSE_SELECT}&or=(${filters.filter(Boolean).join(',')})&order=open_start.desc.nullslast&limit=${Math.min(limit, 40)}`
  );
}

async function loadOpenHousesByIds(ids) {
  const uniqueIds = [...new Set((ids || []).filter(Boolean))];
  if (!uniqueIds.length) return [];
  return supabaseRest(
    `open_houses?id=in.${inFilter(uniqueIds)}&select=${OPEN_HOUSE_SELECT}&limit=${uniqueIds.length}`
  );
}

async function loadListingAgentsByOpenHouseIds(ids, limit) {
  const uniqueIds = [...new Set((ids || []).filter(Boolean))];
  if (!uniqueIds.length) return [];
  return supabaseRest(
    `listing_agents?open_house_id=in.${inFilter(uniqueIds)}&select=${LISTING_AGENT_SELECT}&order=is_primary.desc.nullslast,created_at.desc&limit=${Math.max(limit, uniqueIds.length * 4)}`
  );
}

async function searchListingAgents(q, limit) {
  const query = cleanSearch(q);
  if (query.length < 2) return [];
  const digits = query.replace(/\D/g, '');
  const filters = [
    ilike('name', query),
    ilike('phone', query),
    ilike('email', query),
    ilike('brokerage', query),
    ilike('open_house_id', query)
  ];
  if (digits.length >= 4) filters.push(ilike('phone_normalized', digits));

  return supabaseRest(
    `listing_agents?select=${LISTING_AGENT_SELECT}&or=(${filters.filter(Boolean).join(',')})&order=created_at.desc&limit=${Math.min(limit, 40)}`
  );
}

function queueIdentity(row) {
  const phone = phoneDigits(row?.agent_phone_normalized || row?.agent_phone);
  if (phone) return `phone:${phone}`;
  return `name:${compactKey(row?.agent_name)}|house:${row?.open_house_id || ''}`;
}

function listingAgentIdentity(row) {
  const phone = phoneDigits(row?.phone_normalized || row?.phone);
  if (phone) return `phone:${phone}`;
  return `name:${compactKey(row?.name)}|house:${row?.open_house_id || ''}`;
}

function listingAgentToSearchRow(agent, house) {
  return {
    id: `listing-agent:${agent.id}`,
    search_result_type: 'listing_agent',
    listing_agent_id: agent.id,
    open_house_id: agent.open_house_id || house?.id || '',
    outreach_code: '',
    agent_name: agent.name || house?.agent || 'Listing agent',
    agent_phone: agent.phone || house?.agent_phone || '',
    agent_phone_normalized: agent.phone_normalized || phoneDigits(agent.phone || house?.agent_phone),
    agent_email: agent.email || house?.agent_email || '',
    brokerage: agent.brokerage || house?.brokerage || '',
    address: house?.address || '',
    city: '',
    state: '',
    zip: '',
    price: house?.price || null,
    beds: house?.beds || null,
    baths: house?.baths || null,
    open_start: house?.open_start || null,
    open_end: house?.open_end || null,
    template_key: 'listing_feed',
    listing_photo_url: house?.image || '',
    agent_photo_url: agent.primary_photo_url || agent.directory_photo_url || '',
    mockup_image_url: '',
    selected_sms: 'Listing feed match. This agent is connected to the open-house listing, but no outreach queue row was found for them yet.',
    followup_sms: '',
    review_status: 'listing_feed',
    report_note: '',
    report_note_updated_at: null,
    initial_send_status: 'not_queued',
    initial_sent_at: null,
    initial_delivery_status: null,
    followup_send_status: '',
    followup_send_at: null,
    followup_sent_at: null,
    send_mode: 'listing_feed',
    last_outreach_at: null,
    created_at: agent.created_at || house?.created_at || null
  };
}

async function searchAll(q, limit) {
  const warnings = [];
  const [queueRows, directOpenHouses, directListingAgents] = await Promise.all([
    safeSearch('agent_outreach_queue', warnings, () => searchQueue(q, limit)),
    safeSearch('open_houses', warnings, () => searchOpenHouses(q, limit)),
    safeSearch('listing_agents_direct', warnings, () => searchListingAgents(q, limit))
  ]);

  const openHouseIds = [
    ...(queueRows || []).map((row) => row.open_house_id),
    ...(directOpenHouses || []).map((row) => row.id),
    ...(directListingAgents || []).map((row) => row.open_house_id)
  ].filter(Boolean);

  const [linkedOpenHouses, linkedListingAgents] = await Promise.all([
    safeSearch('open_houses_by_id', warnings, () => loadOpenHousesByIds(openHouseIds)),
    safeSearch('listing_agents_by_open_house', warnings, () => loadListingAgentsByOpenHouseIds(openHouseIds, limit))
  ]);

  const houses = new Map(
    uniqueById([...(directOpenHouses || []), ...(linkedOpenHouses || [])]).map((row) => [row.id, row])
  );

  const listingAgents = uniqueById([...(directListingAgents || []), ...(linkedListingAgents || [])]);
  const seen = new Set();
  const merged = [];
  for (const row of queueRows || []) {
    const identity = queueIdentity(row);
    if (identity) seen.add(`${row.open_house_id || ''}|${identity}`);
    merged.push(row);
  }

  for (const agent of listingAgents) {
    const identity = listingAgentIdentity(agent);
    const identityKey = `${agent.open_house_id || ''}|${identity}`;
    if (identity && seen.has(identityKey)) continue;
    if (identity) seen.add(identityKey);
    merged.push(listingAgentToSearchRow(agent, houses.get(agent.open_house_id)));
  }

  return {
    rows: merged.slice(0, limit),
    warnings
  };
}

module.exports = async function handler(req, res) {
  try {
    allowCors(req, res);
    if (req.method === 'OPTIONS') {
      res.status(204).end();
      return;
    }

    if (req.method !== 'GET') {
      res.setHeader('Allow', 'GET, OPTIONS');
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
    const result = await searchAll(q, limit);
    sendJson(res, 200, {
      ok: true,
      query: cleanSearch(q),
      rows: Array.isArray(result.rows) ? result.rows : [],
      warnings: result.warnings || [],
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
