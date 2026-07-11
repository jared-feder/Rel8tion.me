const { adminAuthorized, assertAdminConfig, sendJson, supabaseRest } = require('../../lib/admin-auth');

const CORS_HEADERS = {
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Admin-Uid, X-Admin-Token',
  'Access-Control-Max-Age': '600'
};

const OPEN_HOUSE_SELECT = [
  'id',
  'address',
  'price',
  'beds',
  'baths',
  'open_start',
  'open_end',
  'image',
  'link',
  'agent',
  'agent_phone',
  'agent_email',
  'brokerage',
  'created_at',
  'updated_at'
].join(',');

const OPEN_HOUSE_SELECT_FALLBACK = [
  'id',
  'address',
  'price',
  'open_start',
  'open_end',
  'image',
  'link',
  'agent',
  'agent_phone',
  'agent_email',
  'brokerage',
  'created_at',
  'updated_at'
].join(',');

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
  'listing_photo_url',
  'mockup_image_url',
  'review_status',
  'created_at'
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

function readQuery(req, name) {
  const value = req.query?.[name];
  if (Array.isArray(value)) return value[0] || '';
  return value || '';
}

function enc(value) {
  return encodeURIComponent(String(value || ''));
}

function inFilter(values) {
  return `(${values.map(enc).join(',')})`;
}

function asNumber(value, fallback = null) {
  if (value === undefined || value === null || value === '') return fallback;
  const parsed = Number(String(value).replace(/[^0-9.-]/g, ''));
  return Number.isFinite(parsed) ? parsed : fallback;
}

function asDate(value, fallback) {
  const date = value ? new Date(value) : fallback;
  if (!date || Number.isNaN(date.getTime())) return fallback;
  return date;
}

function clean(value) {
  return String(value || '').trim();
}

function compact(value) {
  return clean(value).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function validHttp(value) {
  const text = clean(value);
  if (!/^https?:\/\//i.test(text)) return '';
  return text;
}

function firstPresent(...values) {
  for (const value of values) {
    if (value !== undefined && value !== null && clean(value) !== '') return value;
  }
  return '';
}

function parseFilters(req) {
  const now = new Date();
  const fromDefault = new Date(now.getTime() - 2 * 60 * 60 * 1000);
  const days = Math.max(1, Math.min(asNumber(readQuery(req, 'days'), 14), 90));
  const toDefault = new Date(now.getTime() + days * 24 * 60 * 60 * 1000);
  const from = asDate(readQuery(req, 'from'), fromDefault);
  const to = asDate(readQuery(req, 'to'), toDefault);

  return {
    q: clean(readQuery(req, 'q')),
    from,
    to,
    days,
    min_price: asNumber(readQuery(req, 'min_price')),
    max_price: asNumber(readQuery(req, 'max_price')),
    min_beds: asNumber(readQuery(req, 'min_beds')),
    min_baths: asNumber(readQuery(req, 'min_baths')),
    city: clean(readQuery(req, 'city')),
    state: clean(readQuery(req, 'state')),
    brokerage: clean(readQuery(req, 'brokerage')),
    agent: clean(readQuery(req, 'agent')),
    photo_only: ['1', 'true', 'yes'].includes(clean(readQuery(req, 'photo_only')).toLowerCase()),
    sort: clean(readQuery(req, 'sort')) || 'open_start_asc',
    limit: Math.max(1, Math.min(asNumber(readQuery(req, 'limit'), 120), 250))
  };
}

async function safeRest(label, warnings, fn) {
  try {
    const rows = await fn();
    return Array.isArray(rows) ? rows : [];
  } catch (error) {
    warnings.push({ source: label, error: error.message || String(error), status: error.status || null });
    return [];
  }
}

async function loadOpenHouses(filters, warnings) {
  const base = `open_start=gte.${enc(filters.from.toISOString())}&open_start=lte.${enc(filters.to.toISOString())}`;
  const path = (select) => `open_houses?select=${select}&${base}&order=open_start.asc.nullslast&limit=1000`;
  const rows = await safeRest('open_houses', warnings, () => supabaseRest(path(OPEN_HOUSE_SELECT)));
  if (rows.length || !warnings.find((item) => item.source === 'open_houses')) return rows;
  return safeRest('open_houses_fallback', warnings, () => supabaseRest(path(OPEN_HOUSE_SELECT_FALLBACK)));
}

async function loadQueueRows(filters, warnings) {
  const base = `open_start=gte.${enc(filters.from.toISOString())}&open_start=lte.${enc(filters.to.toISOString())}`;
  return safeRest('agent_outreach_queue', warnings, () => supabaseRest(
    `agent_outreach_queue?select=${QUEUE_SELECT}&${base}&order=open_start.asc.nullslast&limit=1000`
  ));
}

async function loadListingAgents(openHouseIds, warnings) {
  const ids = [...new Set((openHouseIds || []).filter(Boolean))];
  if (!ids.length) return [];
  const batches = [];
  for (let index = 0; index < ids.length; index += 80) {
    const chunk = ids.slice(index, index + 80);
    batches.push(safeRest('listing_agents', warnings, () => supabaseRest(
      `listing_agents?open_house_id=in.${inFilter(chunk)}&select=${LISTING_AGENT_SELECT}&order=is_primary.desc.nullslast,created_at.desc&limit=${Math.max(120, chunk.length * 4)}`
    )));
  }
  return (await Promise.all(batches)).flat();
}

function resultKey(item) {
  if (item.open_house_id) return `oh:${item.open_house_id}`;
  const address = compact(item.address);
  const time = item.open_start ? new Date(item.open_start).toISOString().slice(0, 16) : '';
  return `addr:${address}|${time}`;
}

function emptyResult() {
  return {
    id: '',
    open_house_id: '',
    queue_row_id: '',
    outreach_code: '',
    address: '',
    city: '',
    state: '',
    zip: '',
    price: null,
    beds: null,
    baths: null,
    open_start: null,
    open_end: null,
    image: '',
    listing_url: '',
    agent_name: '',
    agent_phone: '',
    agent_email: '',
    brokerage: '',
    review_status: '',
    source_types: [],
    listing_agents: []
  };
}

function mergeValue(left, right) {
  return firstPresent(left, right) || null;
}

function normalizeOpenHouse(row) {
  return {
    ...emptyResult(),
    id: `open_house:${row.id}`,
    open_house_id: row.id || '',
    address: clean(row.address),
    price: asNumber(row.price),
    beds: asNumber(row.beds),
    baths: asNumber(row.baths),
    open_start: row.open_start || null,
    open_end: row.open_end || null,
    image: validHttp(row.image),
    listing_url: validHttp(row.link),
    agent_name: clean(row.agent),
    agent_phone: clean(row.agent_phone),
    agent_email: clean(row.agent_email),
    brokerage: clean(row.brokerage),
    source_types: ['open_houses']
  };
}

function normalizeQueue(row) {
  return {
    ...emptyResult(),
    id: `queue:${row.id}`,
    queue_row_id: row.id || '',
    open_house_id: row.open_house_id || '',
    outreach_code: row.outreach_code || '',
    address: clean(row.address),
    city: clean(row.city),
    state: clean(row.state),
    zip: clean(row.zip),
    price: asNumber(row.price),
    beds: asNumber(row.beds),
    baths: asNumber(row.baths),
    open_start: row.open_start || null,
    open_end: row.open_end || null,
    image: validHttp(row.listing_photo_url) || validHttp(row.mockup_image_url),
    agent_name: clean(row.agent_name),
    agent_phone: clean(row.agent_phone),
    agent_email: clean(row.agent_email),
    brokerage: clean(row.brokerage),
    review_status: clean(row.review_status),
    source_types: ['agent_outreach_queue']
  };
}

function mergeResults(existing, incoming) {
  const merged = existing || emptyResult();
  return {
    ...merged,
    ...Object.fromEntries(Object.entries(incoming).filter(([key, value]) => {
      if (key === 'source_types' || key === 'listing_agents') return false;
      return value !== undefined && value !== null && clean(value) !== '';
    })),
    price: merged.price || incoming.price || null,
    beds: merged.beds || incoming.beds || null,
    baths: merged.baths || incoming.baths || null,
    image: mergeValue(merged.image, incoming.image) || '',
    listing_url: mergeValue(merged.listing_url, incoming.listing_url) || '',
    source_types: [...new Set([...(merged.source_types || []), ...(incoming.source_types || [])])],
    listing_agents: merged.listing_agents || []
  };
}

function attachAgents(rows, agents) {
  const byHouse = new Map();
  for (const agent of agents || []) {
    const id = agent.open_house_id;
    if (!id) continue;
    const list = byHouse.get(id) || [];
    list.push({
      id: agent.id,
      name: agent.name || '',
      phone: agent.phone || '',
      phone_normalized: agent.phone_normalized || '',
      email: agent.email || '',
      brokerage: agent.brokerage || '',
      photo_url: agent.primary_photo_url || agent.directory_photo_url || '',
      profile_url: agent.profile_url || '',
      is_primary: agent.is_primary === true
    });
    byHouse.set(id, list);
  }

  return rows.map((row) => {
    const listingAgents = byHouse.get(row.open_house_id) || [];
    const primary = listingAgents.find((agent) => agent.is_primary) || listingAgents[0] || null;
    return {
      ...row,
      listing_agents: listingAgents,
      agent_name: row.agent_name || primary?.name || '',
      agent_phone: row.agent_phone || primary?.phone || '',
      agent_email: row.agent_email || primary?.email || '',
      brokerage: row.brokerage || primary?.brokerage || ''
    };
  });
}

function haystack(row) {
  return [
    row.address,
    row.city,
    row.state,
    row.zip,
    row.brokerage,
    row.agent_name,
    row.agent_phone,
    row.agent_email,
    row.open_house_id,
    row.outreach_code,
    ...(row.listing_agents || []).flatMap((agent) => [agent.name, agent.phone, agent.email, agent.brokerage])
  ].filter(Boolean).join(' ').toLowerCase();
}

function matchesText(row, value, pick) {
  const needle = compact(value);
  if (!needle) return true;
  return compact(pick(row)).includes(needle);
}

function filterRows(rows, filters) {
  const q = compact(filters.q);
  return rows.filter((row) => {
    if (q && !haystack(row).includes(q)) return false;
    if (filters.min_price !== null && !(Number(row.price || 0) >= filters.min_price)) return false;
    if (filters.max_price !== null && !(Number(row.price || 0) <= filters.max_price)) return false;
    if (filters.min_beds !== null && !(Number(row.beds || 0) >= filters.min_beds)) return false;
    if (filters.min_baths !== null && !(Number(row.baths || 0) >= filters.min_baths)) return false;
    if (filters.photo_only && !row.image) return false;
    if (!matchesText(row, filters.city, (item) => item.city || item.address)) return false;
    if (!matchesText(row, filters.state, (item) => item.state || item.address)) return false;
    if (!matchesText(row, filters.brokerage, (item) => item.brokerage)) return false;
    if (!matchesText(row, filters.agent, (item) => item.agent_name)) return false;
    return true;
  });
}

function compareText(a, b) {
  return clean(a).localeCompare(clean(b), 'en', { sensitivity: 'base' });
}

function timeValue(value) {
  const time = new Date(value || 0).getTime();
  return Number.isFinite(time) ? time : 0;
}

function sortRows(rows, sort) {
  const sorted = [...rows];
  sorted.sort((a, b) => {
    switch (sort) {
      case 'open_start_desc':
        return timeValue(b.open_start) - timeValue(a.open_start);
      case 'price_asc':
        return Number(a.price || 0) - Number(b.price || 0) || timeValue(a.open_start) - timeValue(b.open_start);
      case 'price_desc':
        return Number(b.price || 0) - Number(a.price || 0) || timeValue(a.open_start) - timeValue(b.open_start);
      case 'beds_desc':
        return Number(b.beds || 0) - Number(a.beds || 0) || Number(b.baths || 0) - Number(a.baths || 0);
      case 'agent':
        return compareText(a.agent_name, b.agent_name) || timeValue(a.open_start) - timeValue(b.open_start);
      case 'brokerage':
        return compareText(a.brokerage, b.brokerage) || timeValue(a.open_start) - timeValue(b.open_start);
      case 'address':
        return compareText(a.address, b.address);
      default:
        return timeValue(a.open_start) - timeValue(b.open_start) || Number(a.price || 0) - Number(b.price || 0);
    }
  });
  return sorted;
}

function buildSummary(rows) {
  const prices = rows.map((row) => Number(row.price || 0)).filter((value) => value > 0);
  const openHouseCount = rows.filter((row) => row.open_start).length;
  return {
    total: rows.length,
    open_house_count: openHouseCount,
    with_photo: rows.filter((row) => row.image).length,
    min_price: prices.length ? Math.min(...prices) : null,
    max_price: prices.length ? Math.max(...prices) : null,
    avg_price: prices.length ? Math.round(prices.reduce((sum, price) => sum + price, 0) / prices.length) : null,
    brokerages: [...new Set(rows.map((row) => row.brokerage).filter(Boolean))].slice(0, 20)
  };
}

async function loadResults(filters) {
  const warnings = [];
  const [openHouses, queueRows] = await Promise.all([
    loadOpenHouses(filters, warnings),
    loadQueueRows(filters, warnings)
  ]);

  const merged = new Map();
  for (const item of [...openHouses.map(normalizeOpenHouse), ...queueRows.map(normalizeQueue)]) {
    const key = resultKey(item);
    merged.set(key, mergeResults(merged.get(key), item));
  }

  const openHouseIds = [...merged.values()].map((row) => row.open_house_id).filter(Boolean);
  const agents = await loadListingAgents(openHouseIds, warnings);
  const withAgents = attachAgents([...merged.values()], agents);
  const filtered = filterRows(withAgents, filters);
  const rows = sortRows(filtered, filters.sort).slice(0, filters.limit);

  return {
    rows,
    summary: buildSummary(rows),
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

    const filters = parseFilters(req);
    const result = await loadResults(filters);

    sendJson(res, 200, {
      ok: true,
      filters: {
        ...filters,
        from: filters.from.toISOString(),
        to: filters.to.toISOString()
      },
      rows: result.rows,
      summary: result.summary,
      warnings: result.warnings,
      loaded_at: new Date().toISOString()
    });
  } catch (error) {
    sendJson(res, error.status || 500, {
      ok: false,
      error: error.message || 'Unable to load buyer home matches.',
      details: error.payload || null
    });
  }
};
