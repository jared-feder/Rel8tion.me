const DEFAULT_BATCH_SIZE = 100;
const DEFAULT_MAX_OFFSETS = 15;
const DEFAULT_STALE_AFTER_HOURS = 72;
const ONEKEY_BASE_URL = 'https://www.onekeymls.com/api/search';
const CURRENT_STATUSES = new Set(['active', 'coming soon', 'pending']);
const POSITIVE_REVIEW_STATUSES = new Set([
  'interested',
  'confirmed_open_house',
  'accepted_open_house',
  'drip_scheduled'
]);
const RANKING_RELATIONSHIP_STATUS = 'ranking_only';
const ONEKEY_BOXES = [
  { topLeft: '[-73.96,40.80]', bottomRight: '[-73.70,40.54]' },
  { topLeft: '[-73.80,40.92]', bottomRight: '[-73.40,40.55]' },
  { topLeft: '[-73.40,41.10]', bottomRight: '[-72.00,40.60]' }
];

function requireEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

function positiveInt(value, fallback, max = Number.MAX_SAFE_INTEGER) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? Math.min(parsed, max) : fallback;
}

function cleanText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function normalizeName(value) {
  return cleanText(value)
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeBrokerage(value) {
  return normalizeName(value)
    .replace(/\b(limited liability company|llc|incorporated|inc|corp|corporation|co|company|ltd|realty|real estate|brokerage|brokers?)\b/g, ' ')
    .replace(/\s+/g, '')
    .trim();
}

function similarBrokerage(left, right) {
  const a = normalizeBrokerage(left);
  const b = normalizeBrokerage(right);
  if (!a || !b) return false;
  return a === b || (Math.min(a.length, b.length) >= 4 && (a.includes(b) || b.includes(a)));
}

function normalizePhone(value) {
  const digits = String(value || '').replace(/\D/g, '');
  if (digits.length === 11 && digits.startsWith('1')) return digits.slice(1);
  return digits.length >= 10 ? digits.slice(-10) : '';
}

function normalizeEmail(value) {
  return cleanText(value).toLowerCase();
}

function numberOrNull(value) {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(String(value).replace(/[^0-9.-]/g, ''));
  return Number.isFinite(parsed) ? parsed : null;
}

function firstPresent(...values) {
  return values.find((value) => cleanText(value)) || '';
}

function compactObject(value) {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined));
}

function readConfig(options = {}) {
  const url = requireEnv('SUPABASE_URL').replace(/\/$/, '');
  if (!/^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(url)) {
    throw new Error('Invalid SUPABASE_URL environment variable.');
  }
  const dryRun = options.dryRun === true || process.env.AGENT_LISTING_INVENTORY_DRY_RUN === 'true';
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const anonKey = process.env.SUPABASE_ANON_KEY;
  const key = serviceRoleKey || (dryRun ? anonKey : '');
  if (!key) throw new Error('Missing SUPABASE_SERVICE_ROLE_KEY. Dry runs may use SUPABASE_ANON_KEY.');

  return {
    url,
    key,
    dryRun,
    promoteOpenHouses: options.promoteOpenHouses === true
      || process.env.AGENT_LISTING_INVENTORY_PROMOTE_OPEN_HOUSES === 'true',
    maxOffsets: positiveInt(
      options.maxOffsets || process.env.AGENT_LISTING_INVENTORY_MAX_OFFSETS,
      DEFAULT_MAX_OFFSETS,
      30
    ),
    staleAfterHours: positiveInt(
      options.staleAfterHours || process.env.AGENT_LISTING_INVENTORY_STALE_HOURS,
      DEFAULT_STALE_AFTER_HOURS,
      720
    ),
    relationshipLimit: positiveInt(
      options.relationshipLimit || process.env.AGENT_LISTING_INVENTORY_RELATIONSHIP_LIMIT,
      20000,
      50000
    ),
    boxes: options.boxes || ONEKEY_BOXES
  };
}

function restHeaders(config, extra = {}) {
  return {
    apikey: config.key,
    Authorization: `Bearer ${config.key}`,
    'Content-Type': 'application/json',
    ...extra
  };
}

async function supabaseRequest(config, path, options = {}) {
  const response = await fetch(`${config.url}/rest/v1/${path}`, {
    ...options,
    headers: restHeaders(config, options.headers || {})
  });
  const raw = await response.text().catch(() => '');
  if (!response.ok) {
    const error = new Error(raw || `Supabase request failed: ${response.status}`);
    error.status = response.status;
    error.body = raw;
    throw error;
  }
  return raw ? JSON.parse(raw) : null;
}

async function supabaseRequestAll(config, table, query, limit) {
  const rows = [];
  const pageSize = 1000;
  for (let offset = 0; offset < limit; offset += pageSize) {
    const page = await supabaseRequest(
      config,
      `${table}?${query}&limit=${Math.min(pageSize, limit - offset)}&offset=${offset}`
    );
    rows.push(...(page || []));
    if (!Array.isArray(page) || page.length < pageSize) break;
  }
  return rows;
}

function relationshipKey(profile = {}) {
  const phone = normalizePhone(profile.phone_normalized || profile.phone);
  if (phone) return `phone:${phone}`;
  const email = normalizeEmail(profile.email);
  if (email) return `email:${email}`;
  const name = normalizeName(profile.agent_name || profile.name);
  const brokerage = normalizeBrokerage(profile.brokerage);
  return name ? `name:${name}|${brokerage}` : '';
}

function relationshipPriority(status) {
  return {
    accepted_open_house: 5,
    confirmed_open_house: 4,
    interested: 3,
    drip_scheduled: 2,
    worked_with: 1
  }[status] || 0;
}

function mergeProfile(current, candidate) {
  if (!current) return candidate;
  const preferred = relationshipPriority(candidate.relationship_status) > relationshipPriority(current.relationship_status)
    ? candidate
    : current;
  const alternate = preferred === current ? candidate : current;
  return {
    ...alternate,
    ...preferred,
    agent_id: preferred.agent_id || alternate.agent_id || null,
    queue_row_id: preferred.queue_row_id || alternate.queue_row_id || null,
    agent_name: preferred.agent_name || alternate.agent_name,
    brokerage: preferred.brokerage || alternate.brokerage || '',
    phone: preferred.phone || alternate.phone || '',
    phone_normalized: preferred.phone_normalized || alternate.phone_normalized || '',
    email: preferred.email || alternate.email || ''
  };
}

function relationshipProfile(input = {}, defaults = {}) {
  const hasExplicitAgentId = Object.prototype.hasOwnProperty.call(input, 'agent_id');
  const profile = {
    agent_id: hasExplicitAgentId ? input.agent_id : (input.id || null),
    queue_row_id: input.queue_row_id || null,
    agent_name: cleanText(input.agent_name || input.name),
    brokerage: cleanText(input.brokerage),
    phone: cleanText(input.agent_phone || input.phone),
    phone_normalized: normalizePhone(input.agent_phone_normalized || input.phone_normalized || input.agent_phone || input.phone),
    email: normalizeEmail(input.agent_email || input.email),
    relationship_source: defaults.relationship_source || 'agents',
    relationship_status: defaults.relationship_status || 'worked_with'
  };
  profile.relationship_key = relationshipKey(profile);
  profile.agent_name_normalized = normalizeName(profile.agent_name);
  return profile;
}

async function loadRelationshipProfiles(config) {
  const [agents, queueRows, rankings] = await Promise.all([
    supabaseRequestAll(
      config,
      'agents',
      'select=id,name,brokerage,phone,phone_normalized,email&order=name.asc',
      config.relationshipLimit
    ).catch(() => []),
    supabaseRequestAll(
      config,
      'agent_outreach_queue',
      `review_status=in.(${[...POSITIVE_REVIEW_STATUSES].join(',')})&select=id,agent_name,agent_phone,agent_phone_normalized,agent_email,brokerage,review_status,source,updated_at&order=updated_at.desc.nullslast`,
      config.relationshipLimit
    ).catch(() => []),
    supabaseRequestAll(
      config,
      'agent_rankings',
      'select=id,agent_id,agent_name,brokerage,phone,phone_normalized,email&order=id.asc',
      config.relationshipLimit
    ).catch(() => [])
  ]);

  const profiles = new Map();
  for (const row of rankings || []) {
    const profile = relationshipProfile(row, {
      relationship_source: 'agent_rankings',
      relationship_status: RANKING_RELATIONSHIP_STATUS
    });
    if (!profile.relationship_key || !profile.agent_name_normalized) continue;
    profiles.set(profile.relationship_key, mergeProfile(profiles.get(profile.relationship_key), profile));
  }
  for (const row of agents || []) {
    const profile = relationshipProfile(row, {
      relationship_source: 'agents',
      relationship_status: 'worked_with'
    });
    if (!profile.relationship_key || !profile.agent_name_normalized) continue;
    profiles.set(profile.relationship_key, mergeProfile(profiles.get(profile.relationship_key), profile));
  }
  for (const row of queueRows || []) {
    const status = POSITIVE_REVIEW_STATUSES.has(row.review_status) ? row.review_status : 'interested';
    const profile = relationshipProfile({
      ...row,
      queue_row_id: row.id,
      agent_id: null
    }, {
      relationship_source: row.source || 'agent_outreach_queue',
      relationship_status: status
    });
    if (!profile.relationship_key || !profile.agent_name_normalized) continue;
    profiles.set(profile.relationship_key, mergeProfile(profiles.get(profile.relationship_key), profile));
  }
  return [...profiles.values()];
}

function agentObject(value) {
  if (!value || typeof value !== 'object') return null;
  const name = firstPresent(value.FullName, value.MemberFullName, value.Name, value.fullName, value.name);
  if (!name) return null;
  return {
    name: cleanText(name),
    phone: firstPresent(value.Phone, value.MobilePhone, value.CellPhone, value.phone),
    email: normalizeEmail(firstPresent(value.Email, value.email))
  };
}

function listingAgentCandidates(record = {}) {
  const listing = record.Listing || {};
  const candidates = [
    listing.ListAgent,
    listing.Agent,
    listing.CoListAgent,
    listing.ListAgent2,
    record.ListAgent,
    record.ListingAgent
  ].flatMap((value) => Array.isArray(value) ? value : [value]);
  const fallbackName = firstPresent(
    record.ListingAgentName,
    record.ListAgentFullName,
    record.ListAgentName
  );
  if (fallbackName) candidates.push({ Name: fallbackName });

  const seen = new Set();
  return candidates
    .map(agentObject)
    .filter(Boolean)
    .filter((candidate) => {
      const key = `${normalizeName(candidate.name)}|${normalizePhone(candidate.phone)}|${candidate.email}`;
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function recordBrokerage(record = {}) {
  const listing = record.Listing || {};
  return firstPresent(
    listing.AgentOffice?.ListOffice?.ListOfficeName,
    listing.ListOffice?.ListOfficeName,
    listing.ListOfficeName,
    record.ListOfficeName
  );
}

function profileIndexes(profiles = []) {
  const byPhone = new Map();
  const byEmail = new Map();
  const byName = new Map();
  const add = (map, key, profile) => {
    if (!key) return;
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(profile);
  };
  for (const profile of profiles) {
    add(byPhone, profile.phone_normalized, profile);
    add(byEmail, profile.email, profile);
    add(byName, profile.agent_name_normalized, profile);
  }
  return { byPhone, byEmail, byName };
}

function matchProfiles(record, profiles = [], indexes = profileIndexes(profiles)) {
  const agents = listingAgentCandidates(record);
  const brokerage = recordBrokerage(record);
  const matched = new Map();

  for (const candidate of agents) {
    const phone = normalizePhone(candidate.phone);
    const email = normalizeEmail(candidate.email);
    const normalizedName = normalizeName(candidate.name);
    const sameNameProfiles = indexes.byName.get(normalizedName) || [];
    const contactProfiles = [
      ...(indexes.byPhone.get(phone) || []),
      ...(indexes.byEmail.get(email) || [])
    ];
    for (const profile of contactProfiles) {
      const phoneMatch = phone && profile.phone_normalized && phone === profile.phone_normalized;
      const emailMatch = email && profile.email && email === profile.email;
      if (!phoneMatch && !emailMatch) continue;
      matched.set(profile.relationship_key, {
        profile,
        candidate,
        match_score: phoneMatch ? 100 : 98,
        match_reason: phoneMatch ? 'agent_phone' : 'agent_email'
      });
    }
    for (const profile of sameNameProfiles) {
      if (matched.has(profile.relationship_key)) continue;
      const brokerageMatch = profile.brokerage && brokerage && similarBrokerage(profile.brokerage, brokerage);
      const brokerageConflict = profile.brokerage && brokerage && !brokerageMatch;
      if (brokerageConflict) continue;
      if (!brokerageMatch && sameNameProfiles.length > 1) continue;
      matched.set(profile.relationship_key, {
        profile,
        candidate,
        match_score: brokerageMatch ? 90 : 80,
        match_reason: brokerageMatch ? 'exact_name_brokerage' : 'unique_exact_name'
      });
    }
  }
  return [...matched.values()];
}

function listingStatus(record = {}) {
  const raw = cleanText(record.Listing?.StandardStatus || record.StandardStatus).toLowerCase();
  if (raw === 'coming soon') return 'coming_soon';
  if (raw === 'pending') return 'pending';
  return raw === 'active' ? 'active' : raw;
}

function currentListing(record) {
  const status = cleanText(record?.Listing?.StandardStatus || record?.StandardStatus).toLowerCase();
  return CURRENT_STATUSES.has(status);
}

function primaryImage(record = {}) {
  const media = Array.isArray(record.Media) ? record.Media : [];
  return firstPresent(
    media[0]?.MediaURL,
    media[1]?.MediaURL,
    record.ImagesHero,
    record.MediaURL
  );
}

function openHouseWindow(record = {}, nowIso = new Date().toISOString()) {
  const listing = record.Listing || {};
  const computed = record.Computed || {};
  const candidates = [{
    start: computed.OpenHousesEarliestStartTime,
    end: computed.OpenHousesEarliestEndTime,
    source: 'computed_earliest'
  }];
  const collections = [
    record.OpenHouses,
    listing.OpenHouses,
    computed.OpenHouses
  ].filter(Array.isArray);
  for (const rows of collections) {
    for (const row of rows) {
      candidates.push({
        start: firstPresent(row?.OpenHouseStartTime, row?.StartTime, row?.StartDateTime, row?.open_start, row?.start),
        end: firstPresent(row?.OpenHouseEndTime, row?.EndTime, row?.EndDateTime, row?.open_end, row?.end),
        source: 'open_house_collection'
      });
    }
  }

  const now = new Date(nowIso).getTime();
  return candidates
    .map((candidate) => {
      const start = new Date(candidate.start || '').getTime();
      const parsedEnd = new Date(candidate.end || '').getTime();
      const end = Number.isFinite(parsedEnd) ? parsedEnd : (Number.isFinite(start) ? start + 4 * 60 * 60 * 1000 : NaN);
      return { ...candidate, start_time:start, end_time:end };
    })
    .filter((candidate) => Number.isFinite(candidate.start_time) && Number.isFinite(candidate.end_time) && candidate.end_time >= now)
    .sort((a, b) => a.start_time - b.start_time)[0] || null;
}

function sourcePayload(record, match, window) {
  return {
    unique_listing_id: record.UniqueListingId || null,
    standard_status: record.Listing?.StandardStatus || record.StandardStatus || null,
    match_score: match.match_score,
    match_reason: match.match_reason,
    source_agent_name: match.candidate.name || null,
    source_agent_phone: match.candidate.phone || null,
    source_agent_email: match.candidate.email || null,
    source_brokerage: recordBrokerage(record) || null,
    has_upcoming_open_house: Boolean(window),
    open_house_tag_source: window?.source || null,
    checked_at: new Date().toISOString()
  };
}

function inventoryPayload(record, match, nowIso) {
  const profile = match.profile;
  const listing = record.Listing || {};
  const structure = record.Structure || {};
  const computed = record.Computed || {};
  const location = record.Location || {};
  const window = openHouseWindow(record, nowIso);
  return {
    relationship_key: profile.relationship_key,
    relationship_source: profile.relationship_source,
    relationship_status: profile.relationship_status,
    source: 'onekey',
    source_listing_id: String(record.UniqueListingId || ''),
    agent_id: profile.agent_id ? String(profile.agent_id) : null,
    queue_row_id: profile.queue_row_id || null,
    agent_name: profile.agent_name,
    agent_name_normalized: profile.agent_name_normalized,
    brokerage: recordBrokerage(record) || profile.brokerage || null,
    phone: profile.phone || match.candidate.phone || null,
    phone_normalized: profile.phone_normalized || normalizePhone(match.candidate.phone) || null,
    email: profile.email || match.candidate.email || null,
    listing_status: listingStatus(record),
    address: cleanText(record.DisplayName),
    city: cleanText(location.City) || null,
    state: cleanText(location.StateOrProvince) || 'NY',
    zip: cleanText(location.PostalCode) || null,
    price: numberOrNull(listing.Price?.ListPrice),
    beds: numberOrNull(structure.BedroomsTotal || computed.BedroomsTotalInteger),
    baths: numberOrNull(structure.BathroomsTotalInteger || computed.BathroomsTotalInteger),
    sqft: numberOrNull(structure.LivingArea || computed.LivingAreaSquareFeet),
    property_type: cleanText(record.PropertyType) || null,
    image_url: primaryImage(record) || null,
    listing_url: firstPresent(record.CanonicalURL, record.ListingURL) || null,
    open_start: window?.start || null,
    open_end: window?.end || null,
    lat: numberOrNull(record.LocationPoint?.lat),
    lng: numberOrNull(record.LocationPoint?.lon),
    is_current: true,
    last_seen_at: nowIso,
    source_checked_at: nowIso,
    inactive_at: null,
    source_payload: sourcePayload(record, match, window),
    updated_at: nowIso
  };
}

function openHousePayload(record, match, nowIso) {
  const window = openHouseWindow(record, nowIso);
  if (!window) return null;
  const openStart = window.start;
  const openEnd = window.end || null;

  const profile = match.profile;
  const listing = record.Listing || {};
  const structure = record.Structure || {};
  const computedFacts = record.Computed || {};
  return compactObject({
    id: String(record.UniqueListingId || ''),
    address: cleanText(record.DisplayName) || null,
    price: numberOrNull(listing.Price?.ListPrice),
    beds: numberOrNull(structure.BedroomsTotal || computedFacts.BedroomsTotalInteger),
    baths: numberOrNull(structure.BathroomsTotalInteger || computedFacts.BathroomsTotalInteger),
    brokerage: recordBrokerage(record) || profile.brokerage || null,
    agent: profile.agent_name,
    agent_phone: profile.phone || match.candidate.phone || null,
    agent_email: profile.email || match.candidate.email || null,
    lat: numberOrNull(record.LocationPoint?.lat),
    lng: numberOrNull(record.LocationPoint?.lon),
    open_start: openStart,
    open_end: openEnd,
    image: primaryImage(record) || null,
    link: firstPresent(record.CanonicalURL, record.ListingURL) || null,
    source: 'onekey',
    agent_scraped: true,
    agent_enriched: Boolean(profile.phone_normalized || profile.email),
    updated_at: nowIso
  });
}

async function fetchOneKeyPage(box, offset) {
  const url = `${ONEKEY_BASE_URL}?topLeft=${encodeURIComponent(box.topLeft)}&bottomRight=${encodeURIComponent(box.bottomRight)}&propertySaleType=Sale&StateOrProvince=NY&offset=${offset}`;
  const response = await fetch(url, {
    headers: {
      Accept: 'application/json,text/plain,*/*',
      'User-Agent': 'Mozilla/5.0 (compatible; Rel8tionAgentListingInventory/1.0)'
    }
  });
  const raw = await response.text().catch(() => '');
  if (!response.ok) throw new Error(raw || `OneKey request failed: ${response.status}`);
  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new Error(`OneKey returned invalid JSON: ${error.message}`);
  }
}

async function scanOneKey(config) {
  const byId = new Map();
  const boxes = [];
  let complete = true;
  for (const box of config.boxes) {
    let fetched = 0;
    let total = 0;
    let boxComplete = false;
    for (let index = 0; index < config.maxOffsets; index += 1) {
      const offset = index * 100;
      const data = await fetchOneKeyPage(box, offset);
      const results = Array.isArray(data?.Results) ? data.Results : [];
      total = Number(data?.Total || total || 0);
      if (!results.length) {
        boxComplete = true;
        break;
      }
      fetched += results.length;
      for (const record of results) {
        const id = String(record?.UniqueListingId || '');
        if (id) byId.set(id, record);
      }
      if (total && offset + results.length >= total) {
        boxComplete = true;
        break;
      }
      if (results.length < DEFAULT_BATCH_SIZE) {
        boxComplete = true;
        break;
      }
    }
    if (!boxComplete) complete = false;
    boxes.push({ ...box, fetched, total, complete: boxComplete });
  }
  return { records: [...byId.values()], boxes, complete };
}

async function upsertRows(config, table, rows, conflictColumns) {
  if (config.dryRun || !rows.length) return 0;
  let written = 0;
  for (let index = 0; index < rows.length; index += DEFAULT_BATCH_SIZE) {
    const chunk = rows.slice(index, index + DEFAULT_BATCH_SIZE);
    await supabaseRequest(config, `${table}?on_conflict=${conflictColumns}`, {
      method: 'POST',
      headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify(chunk)
    });
    written += chunk.length;
  }
  return written;
}

async function markStaleInventory(config, nowIso, scanComplete) {
  if (config.dryRun || !scanComplete) return { marked_inactive: 0, skipped: true };
  const cutoff = new Date(new Date(nowIso).getTime() - config.staleAfterHours * 60 * 60 * 1000).toISOString();
  const rows = await supabaseRequest(
    config,
    `agent_listing_inventory?source=eq.onekey&is_current=eq.true&last_seen_at=lt.${encodeURIComponent(cutoff)}`,
    {
      method: 'PATCH',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify({ is_current: false, inactive_at: nowIso, updated_at: nowIso })
    }
  );
  return { marked_inactive: Array.isArray(rows) ? rows.length : 0, skipped: false, cutoff };
}

async function run(options = {}) {
  const config = readConfig(options);
  const nowIso = new Date().toISOString();
  const profiles = await loadRelationshipProfiles(config);
  if (!profiles.length) {
    return { ok: true, dryRun: config.dryRun, relationship_agents: 0, scanned: 0, matched_listings: 0 };
  }

  const scan = await scanOneKey(config);
  const indexes = profileIndexes(profiles);
  const inventoryByKey = new Map();
  const openHousesById = new Map();
  for (const record of scan.records) {
    if (!currentListing(record)) continue;
    for (const match of matchProfiles(record, profiles, indexes)) {
      const payload = inventoryPayload(record, match, nowIso);
      if (!payload.source_listing_id || !payload.address) continue;
      inventoryByKey.set(`${payload.relationship_key}|${payload.source_listing_id}`, payload);
      const openHouse = openHousePayload(record, match, nowIso);
      if (openHouse?.id) openHousesById.set(openHouse.id, openHouse);
    }
  }

  const inventory = [...inventoryByKey.values()];
  const openHouses = [...openHousesById.values()];
  const inventoryWritten = await upsertRows(
    config,
    'agent_listing_inventory',
    inventory,
    'relationship_key,source,source_listing_id'
  );
  const openHousesWritten = config.promoteOpenHouses
    ? await upsertRows(config, 'open_houses', openHouses, 'id')
    : 0;
  const stale = await markStaleInventory(config, nowIso, scan.complete);

  return {
    ok: true,
    dryRun: config.dryRun,
    relationship_agents: profiles.length,
    scanned: scan.records.length,
    scan_complete: scan.complete,
    boxes: scan.boxes,
    matched_listings: inventory.length,
    upcoming_open_houses: openHouses.length,
    inventory_written: inventoryWritten,
    open_house_promotion_enabled: config.promoteOpenHouses,
    open_houses_written: openHousesWritten,
    ...stale
  };
}

function parseCliArgs(argv = []) {
  const options = {};
  for (const arg of argv) {
    if (arg === '--dry-run') options.dryRun = true;
    if (arg === '--promote-open-houses') options.promoteOpenHouses = true;
    if (arg.startsWith('--max-offsets=')) options.maxOffsets = Number(arg.slice('--max-offsets='.length));
    if (arg.startsWith('--stale-hours=')) options.staleAfterHours = Number(arg.slice('--stale-hours='.length));
  }
  return options;
}

if (require.main === module) {
  run(parseCliArgs(process.argv.slice(2)))
    .then((result) => console.log(JSON.stringify(result, null, 2)))
    .catch((error) => {
      console.error('[agent-listing-inventory] failed:', error.message || error);
      process.exitCode = 1;
    });
}

module.exports = {
  CURRENT_STATUSES,
  POSITIVE_REVIEW_STATUSES,
  RANKING_RELATIONSHIP_STATUS,
  inventoryPayload,
  listingAgentCandidates,
  matchProfiles,
  normalizeBrokerage,
  normalizeName,
  normalizePhone,
  openHouseWindow,
  openHousePayload,
  profileIndexes,
  readConfig,
  relationshipKey,
  relationshipProfile,
  run,
  similarBrokerage
};
