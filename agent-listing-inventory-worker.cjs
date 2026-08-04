const DEFAULT_BATCH_SIZE = 100;
const DEFAULT_MAX_OFFSETS = 15;
const DEFAULT_STALE_AFTER_HOURS = 72;
const ONEKEY_SITE_URL = 'https://www.onekeymls.com';
const ONEKEY_BASE_URL = 'https://www.onekeymls.com/api/search';
const ONEKEY_AGENT_DIRECTORY_URL = 'https://www.onekeymls.com/api/agents';
const ONEKEY_AGENT_DISCOVERY_TYPES = ['Sale', 'Rent'];
const CURRENT_STATUSES = new Set(['active', 'coming soon', 'pending']);
const POSITIVE_REVIEW_STATUSES = new Set([
  'interested',
  'confirmed_open_house',
  'accepted_open_house',
  'drip_scheduled'
]);
const HISTORICAL_OUTREACH_STATUSES = new Set(['sent', 'manual_text_sent']);
const RANKING_RELATIONSHIP_STATUS = 'ranking_only';
const PRIOR_OUTREACH_RELATIONSHIP_STATUS = 'prior_outreach';
const ONEKEY_AGENT_CURSOR_KEY = 'agent_listing_inventory_onekey_agent_cursor';
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

function meaningfulAgentName(value) {
  const normalized = normalizeName(value);
  if (!normalized || normalized.length < 3) return false;
  return !/^(agent )?(phone|email)( number)?\b|^(unknown|unavailable|not available|n a|na)$/i.test(normalized);
}

function wasHistoricalOutreach(row = {}) {
  return Boolean(
    cleanText(row.initial_sent_at)
    || cleanText(row.last_outreach_at)
    || row.manual_sms_sent === true
    || HISTORICAL_OUTREACH_STATUSES.has(cleanText(row.initial_send_status).toLowerCase())
  );
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
    oneKeyDiscoveryEnabled: options.oneKeyDiscoveryEnabled === true
      || process.env.AGENT_LISTING_INVENTORY_ONEKEY_DISCOVERY_ENABLED === 'true',
    oneKeyAgentDiscoveryEnabled: options.oneKeyAgentDiscoveryEnabled === true
      || process.env.AGENT_LISTING_INVENTORY_ONEKEY_AGENT_DISCOVERY_ENABLED === 'true',
    oneKeyAgentConcurrency: positiveInt(
      options.oneKeyAgentConcurrency || process.env.AGENT_LISTING_INVENTORY_ONEKEY_AGENT_CONCURRENCY,
      6,
      10
    ),
    oneKeyAgentLimit: positiveInt(
      options.oneKeyAgentLimit || process.env.AGENT_LISTING_INVENTORY_ONEKEY_AGENT_LIMIT,
      250,
      1000
    ),
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
    accepted_open_house: 6,
    confirmed_open_house: 5,
    interested: 4,
    drip_scheduled: 3,
    worked_with: 2,
    prior_outreach: 1
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
    email: preferred.email || alternate.email || '',
    prior_outreach: Boolean(preferred.prior_outreach || alternate.prior_outreach),
    last_outreach_at: [preferred.last_outreach_at, alternate.last_outreach_at]
      .filter(Boolean)
      .sort()
      .at(-1) || null
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
    relationship_status: defaults.relationship_status || 'worked_with',
    prior_outreach: defaults.prior_outreach === true || wasHistoricalOutreach(input),
    last_outreach_at: input.last_outreach_at || input.initial_sent_at || null
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
      'select=id,agent_name,agent_phone,agent_phone_normalized,agent_email,brokerage,review_status,source,initial_send_status,initial_sent_at,last_outreach_at,manual_sms_sent,updated_at&order=last_outreach_at.desc.nullslast,updated_at.desc.nullslast',
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
    const positive = POSITIVE_REVIEW_STATUSES.has(row.review_status);
    const historical = wasHistoricalOutreach(row);
    if (!positive && !historical) continue;
    const status = positive ? row.review_status : PRIOR_OUTREACH_RELATIONSHIP_STATUS;
    const profile = relationshipProfile({
      ...row,
      queue_row_id: row.id,
      agent_id: null
    }, {
      relationship_source: row.source || 'agent_outreach_queue',
      relationship_status: status,
      prior_outreach: historical
    });
    if (!profile.relationship_key || !profile.agent_name_normalized) continue;
    profiles.set(profile.relationship_key, mergeProfile(profiles.get(profile.relationship_key), profile));
  }
  return [...profiles.values()];
}

function discoveryPriority(profile = {}) {
  if (POSITIVE_REVIEW_STATUSES.has(profile.relationship_status)) return 3;
  if (profile.prior_outreach || profile.relationship_status === PRIOR_OUTREACH_RELATIONSHIP_STATUS) return 2;
  return 1;
}

function prioritizeDiscoveryProfiles(profiles = []) {
  return profiles
    .filter((profile) => (
      profile.relationship_status !== RANKING_RELATIONSHIP_STATUS
      && meaningfulAgentName(profile.agent_name)
    ))
    .sort((left, right) => {
      const priority = discoveryPriority(right) - discoveryPriority(left);
      if (priority) return priority;
      const recency = String(right.last_outreach_at || '').localeCompare(String(left.last_outreach_at || ''));
      if (recency) return recency;
      return String(left.agent_name_normalized || '').localeCompare(String(right.agent_name_normalized || ''));
    });
}

function circularBatch(items = [], limit = items.length, cursor = 0) {
  if (!items.length || limit <= 0) return { items: [], cursor: 0, next_cursor: 0 };
  const start = Math.max(0, Number.parseInt(cursor, 10) || 0) % items.length;
  const count = Math.min(limit, items.length);
  const selected = Array.from({ length: count }, (_, index) => items[(start + index) % items.length]);
  return {
    items: selected,
    cursor: start,
    next_cursor: (start + count) % items.length
  };
}

async function loadOneKeyAgentCursor(config) {
  const rows = await supabaseRequest(
    config,
    `rel8tion_runtime_settings?key=eq.${ONEKEY_AGENT_CURSOR_KEY}&select=value&limit=1`
  ).catch(() => []);
  const cursor = Number.parseInt(rows?.[0]?.value?.cursor, 10);
  return Number.isFinite(cursor) && cursor >= 0 ? cursor : 0;
}

async function saveOneKeyAgentCursor(config, cursor, profilesConsidered, nowIso) {
  if (config.dryRun) return false;
  await supabaseRequest(config, 'rel8tion_runtime_settings?on_conflict=key', {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify({
      key: ONEKEY_AGENT_CURSOR_KEY,
      value: {
        cursor,
        profiles_considered: profilesConsidered,
        advanced_at: nowIso
      },
      updated_by: 'sync-agent-listing-inventory'
    })
  });
  return true;
}

function cachedOneKeyMatch(profile, payload = {}) {
  const candidate = {
    name: cleanText(payload.source_agent_name),
    phone: cleanText(payload.source_agent_phone),
    email: normalizeEmail(payload.source_agent_email),
    brokerage: cleanText(payload.source_brokerage),
    member_key: cleanText(payload.source_agent_member_key),
    member_mls_id: cleanText(payload.source_agent_member_mls_id),
    office_key: cleanText(payload.source_agent_office_key)
  };
  if (!candidate.member_key || normalizeName(candidate.name) !== profile.agent_name_normalized) return null;
  const candidatePhone = normalizePhone(candidate.phone);
  if (profile.phone_normalized && candidatePhone && profile.phone_normalized !== candidatePhone) return null;
  return {
    profile,
    candidate,
    match_score: profile.phone_normalized && candidatePhone ? 100 : 95,
    match_reason: 'onekey_cached_identity'
  };
}

async function loadOneKeyIdentityCache(config) {
  const rows = await supabaseRequestAll(
    config,
    'agent_listing_inventory',
    'source=eq.onekey&select=relationship_key,agent_name,phone_normalized,source_payload,last_seen_at&order=last_seen_at.desc',
    config.relationshipLimit
  ).catch(() => []);
  const cache = new Map();
  for (const row of rows || []) {
    if (!row.relationship_key || cache.has(row.relationship_key)) continue;
    const profile = relationshipProfile({
      agent_name: row.agent_name,
      phone_normalized: row.phone_normalized
    });
    const match = cachedOneKeyMatch(profile, row.source_payload || {});
    if (match) cache.set(row.relationship_key, row.source_payload);
  }
  return cache;
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
      if (normalizedName && profile.agent_name_normalized && normalizedName !== profile.agent_name_normalized) {
        continue;
      }
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

function displayLocation(record = {}) {
  const text = cleanText(record.DisplayLastLine);
  const match = text.match(/^(.*?),\s*([A-Za-z]{2})\s+(\d{5}(?:-\d{4})?)$/);
  return match
    ? { city: cleanText(match[1]), state: match[2].toUpperCase(), zip: match[3] }
    : { city: '', state: '', zip: '' };
}

function oneKeyListingUrl(record = {}) {
  const hash = cleanText(record.BUPI);
  const slug = normalizeName(record.DisplayName).replace(/\s+/g, '-');
  if (!hash || !slug) return null;
  const saleType = firstPresent(record.Computed?.PropertySaleType?.[0], 'Sale');
  return `${ONEKEY_SITE_URL}/home-details/${slug}/${encodeURIComponent(hash)}?propertySaleType=${encodeURIComponent(saleType)}`;
}

function sourcePayload(record, match) {
  return {
    unique_listing_id: record.UniqueListingId || null,
    standard_status: record.Listing?.StandardStatus || record.StandardStatus || null,
    match_score: match.match_score,
    match_reason: match.match_reason,
    source_agent_name: match.candidate.name || null,
    source_agent_phone: match.candidate.phone || null,
    source_agent_email: match.candidate.email || null,
    source_agent_member_key: match.candidate.member_key || null,
    source_agent_member_mls_id: match.candidate.member_mls_id || null,
    source_agent_office_key: match.candidate.office_key || null,
    source_brokerage: recordBrokerage(record) || null,
    checked_at: new Date().toISOString()
  };
}

function inventoryPayload(record, match, nowIso) {
  const profile = match.profile;
  const listing = record.Listing || {};
  const structure = record.Structure || {};
  const computed = record.Computed || {};
  const location = record.Location || {};
  const displayedLocation = displayLocation(record);
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
    city: cleanText(location.City) || displayedLocation.city || null,
    state: cleanText(location.StateOrProvince) || displayedLocation.state || 'NY',
    zip: cleanText(location.PostalCode) || displayedLocation.zip || null,
    price: numberOrNull(listing.Price?.ListPrice),
    beds: numberOrNull(structure.BedroomsTotal || computed.BedroomsTotalInteger),
    baths: numberOrNull(structure.BathroomsTotalInteger || computed.BathroomsTotalInteger),
    sqft: numberOrNull(structure.LivingArea || computed.LivingAreaSquareFeet),
    property_type: cleanText(record.PropertyType) || null,
    image_url: primaryImage(record) || null,
    listing_url: firstPresent(record.CanonicalURL, record.ListingURL, oneKeyListingUrl(record)) || null,
    open_start: computed.OpenHousesEarliestStartTime || null,
    open_end: computed.OpenHousesEarliestEndTime || null,
    lat: numberOrNull(record.LocationPoint?.lat),
    lng: numberOrNull(record.LocationPoint?.lon),
    is_current: true,
    last_seen_at: nowIso,
    source_checked_at: nowIso,
    inactive_at: null,
    source_payload: sourcePayload(record, match),
    updated_at: nowIso
  };
}

function sourceIdentityRecord(agentName, phone, email, brokerage) {
  return {
    Listing: {
      ListAgent: {
        FullName: cleanText(agentName),
        Phone: cleanText(phone),
        Email: normalizeEmail(email)
      },
      AgentOffice: {
        ListOffice: {
          ListOfficeName: cleanText(brokerage)
        }
      }
    }
  };
}

function normalizeListingStatus(value, fallback = 'active') {
  const status = cleanText(value).toLowerCase().replace(/\s+/g, '_');
  if (status === 'coming_soon') return 'coming_soon';
  if (status === 'pending') return 'pending';
  if (status === 'active') return 'active';
  return fallback;
}

function internalInventoryPayload(row, match, nowIso, source) {
  const profile = match.profile;
  const sourceListingId = String(row.source_listing_id || row.mls_id || row.id || '');
  return {
    relationship_key: profile.relationship_key,
    relationship_source: profile.relationship_source,
    relationship_status: profile.relationship_status,
    source,
    source_listing_id: sourceListingId,
    agent_id: profile.agent_id ? String(profile.agent_id) : null,
    queue_row_id: profile.queue_row_id || null,
    agent_name: profile.agent_name,
    agent_name_normalized: profile.agent_name_normalized,
    brokerage: cleanText(row.brokerage) || profile.brokerage || null,
    phone: profile.phone || cleanText(row.agent_phone) || null,
    phone_normalized: profile.phone_normalized || normalizePhone(row.agent_phone) || null,
    email: profile.email || normalizeEmail(row.agent_email) || null,
    listing_status: normalizeListingStatus(row.listing_status),
    address: cleanText(row.address || row.title),
    city: cleanText(row.city) || null,
    state: cleanText(row.state) || 'NY',
    zip: cleanText(row.zip) || null,
    price: numberOrNull(row.price),
    beds: numberOrNull(row.beds),
    baths: numberOrNull(row.baths),
    sqft: numberOrNull(row.sqft),
    property_type: cleanText(row.property_type) || null,
    image_url: firstPresent(row.primary_image, row.image) || null,
    listing_url: firstPresent(row.listing_url, row.link) || null,
    open_start: row.open_house_start || row.open_start || null,
    open_end: row.open_house_end || row.open_end || null,
    lat: numberOrNull(row.lat),
    lng: numberOrNull(row.lng),
    is_current: true,
    last_seen_at: nowIso,
    source_checked_at: nowIso,
    inactive_at: null,
    source_payload: {
      origin: source,
      origin_row_id: String(row.id || ''),
      source_agent_name: match.candidate.name || null,
      source_agent_phone: match.candidate.phone || null,
      source_agent_email: match.candidate.email || null,
      match_score: match.match_score,
      match_reason: match.match_reason,
      checked_at: nowIso
    },
    updated_at: nowIso
  };
}

function inventorySemanticKey(payload) {
  const address = normalizeName(payload.address);
  const agent = payload.agent_id
    ? `agent:${payload.agent_id}`
    : `name:${payload.agent_name_normalized}|${normalizeBrokerage(payload.brokerage)}`;
  return `${agent}|${address || `${payload.source}:${payload.source_listing_id}`}`;
}

function mergeInventoryPayload(existing, candidate) {
  if (!existing) return candidate;
  const listingPreferred = existing.source === 'agent_website_listing' ? existing : candidate;
  const alternate = listingPreferred === existing ? candidate : existing;
  const existingPriority = relationshipPriority(existing.relationship_status);
  const candidatePriority = relationshipPriority(candidate.relationship_status);
  const relationshipPreferred = candidatePriority > existingPriority ? candidate : existing;
  return {
    ...alternate,
    ...listingPreferred,
    relationship_key: relationshipPreferred.relationship_key,
    relationship_source: relationshipPreferred.relationship_source,
    relationship_status: relationshipPreferred.relationship_status,
    agent_id: relationshipPreferred.agent_id || listingPreferred.agent_id || alternate.agent_id || null,
    queue_row_id: relationshipPreferred.queue_row_id || null,
    phone: relationshipPreferred.phone || listingPreferred.phone || alternate.phone || null,
    phone_normalized: relationshipPreferred.phone_normalized || listingPreferred.phone_normalized || alternate.phone_normalized || null,
    email: relationshipPreferred.email || listingPreferred.email || alternate.email || null,
    open_start: listingPreferred.open_start || alternate.open_start || null,
    open_end: listingPreferred.open_end || alternate.open_end || null,
    image_url: listingPreferred.image_url || alternate.image_url || null,
    listing_url: listingPreferred.listing_url || alternate.listing_url || null,
    source_payload: {
      ...(alternate.source_payload || {}),
      ...(listingPreferred.source_payload || {}),
      related_source: alternate.source,
      related_source_listing_id: alternate.source_listing_id
    }
  };
}

async function loadInternalListingSources(config, nowIso) {
  const websites = await supabaseRequestAll(
    config,
    'agent_websites',
    'select=id,name,brokerage,email,phone&order=id.asc',
    config.relationshipLimit
  );
  const websiteListings = await supabaseRequestAll(
    config,
    'agent_website_listings',
    'select=id,agent_website_id,source,source_listing_id,mls_id,title,address,city,state,zip,price,beds,baths,sqft,property_type,listing_status,primary_image,listing_url,brokerage,agent_name,agent_phone,agent_email,open_house_start,open_house_end,lat,lng&order=id.asc',
    config.relationshipLimit
  );
  const futureFilter = encodeURIComponent(nowIso);
  const [endingLater, startingLater] = await Promise.all([
    supabaseRequestAll(
      config,
      'open_houses',
      `open_end=gte.${futureFilter}&select=id,address,price,beds,baths,open_start,open_end,lat,lng,link,agent,brokerage,sqft,agent_phone,agent_email,image,source,agent_scraped,agent_enriched,updated_at&order=open_end.asc`,
      config.relationshipLimit
    ),
    supabaseRequestAll(
      config,
      'open_houses',
      `open_end=is.null&open_start=gte.${futureFilter}&select=id,address,price,beds,baths,open_start,open_end,lat,lng,link,agent,brokerage,sqft,agent_phone,agent_email,image,source,agent_scraped,agent_enriched,updated_at&order=open_start.asc`,
      config.relationshipLimit
    )
  ]);
  const openHouses = new Map();
  for (const row of [...endingLater, ...startingLater]) openHouses.set(String(row.id), row);
  return {
    websites,
    websiteListings,
    openHouses: [...openHouses.values()]
  };
}

function openHousePayload(record, match, nowIso) {
  const computed = record.Computed || {};
  const openStart = computed.OpenHousesEarliestStartTime || null;
  const openEnd = computed.OpenHousesEarliestEndTime || null;
  const end = openEnd ? new Date(openEnd) : null;
  const start = openStart ? new Date(openStart) : null;
  if (!start || !Number.isFinite(start.getTime())) return null;
  const effectiveEnd = end && Number.isFinite(end.getTime()) ? end : start;
  if (effectiveEnd < new Date(nowIso)) return null;

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
    sqft: numberOrNull(structure.LivingArea || computedFacts.LivingAreaSquareFeet),
    brokerage: recordBrokerage(record) || profile.brokerage || null,
    agent: profile.agent_name,
    agent_phone: profile.phone || match.candidate.phone || null,
    agent_email: profile.email || match.candidate.email || null,
    lat: numberOrNull(record.LocationPoint?.lat),
    lng: numberOrNull(record.LocationPoint?.lon),
    open_start: openStart,
    open_end: openEnd,
    image: primaryImage(record) || null,
    link: firstPresent(record.CanonicalURL, record.ListingURL, oneKeyListingUrl(record)) || null,
    source: 'onekey',
    agent_scraped: true,
    agent_enriched: Boolean(profile.phone_normalized || profile.email),
    updated_at: nowIso
  });
}

function hasValue(value) {
  return value !== null && value !== undefined && cleanText(value) !== '';
}

function openHouseAddressKey(value) {
  return normalizeName(value)
    .replace(/\b(street|st)\b/g, 'st')
    .replace(/\b(avenue|ave)\b/g, 'ave')
    .replace(/\b(road|rd)\b/g, 'rd')
    .replace(/\b(drive|dr)\b/g, 'dr')
    .replace(/\b(boulevard|blvd)\b/g, 'blvd')
    .replace(/\b(lane|ln)\b/g, 'ln');
}

function mergeCanonicalOpenHouse(existing, discovered, nowIso) {
  const oneKeyOwned = cleanText(existing.source).toLowerCase() === 'onekey';
  const merged = { ...existing };
  for (const [key, value] of Object.entries(discovered)) {
    if (key === 'id' || key === 'source' || key.startsWith('agent_')) continue;
    if ((oneKeyOwned || !hasValue(existing[key])) && hasValue(value)) merged[key] = value;
  }
  merged.id = existing.id;
  merged.source = existing.source || discovered.source;
  merged.agent = meaningfulAgentName(existing.agent) ? existing.agent : discovered.agent;
  merged.agent_phone = existing.agent_phone || discovered.agent_phone || null;
  merged.agent_email = existing.agent_email || discovered.agent_email || null;
  merged.agent_scraped = true;
  merged.agent_enriched = Boolean(normalizePhone(merged.agent_phone) || normalizeEmail(merged.agent_email));
  merged.updated_at = nowIso;
  return merged;
}

function reconcileOpenHousePayloads(discoveredRows = [], existingRows = [], nowIso = new Date().toISOString()) {
  const existingById = new Map(existingRows.map((row) => [String(row.id), row]));
  const existingByAddress = new Map();
  for (const row of existingRows) {
    const key = openHouseAddressKey(row.address);
    if (!key) continue;
    if (!existingByAddress.has(key)) existingByAddress.set(key, []);
    existingByAddress.get(key).push(row);
  }

  const rows = [];
  const usedExistingIds = new Set();
  let matchedById = 0;
  let matchedByAddressTime = 0;
  let inserted = 0;
  let attached = 0;

  for (const discovered of discoveredRows) {
    let existing = existingById.get(String(discovered.id));
    let matchType = existing ? 'id' : '';
    if (!existing) {
      const start = new Date(discovered.open_start).getTime();
      const candidates = existingByAddress.get(openHouseAddressKey(discovered.address)) || [];
      existing = candidates
        .filter((row) => !usedExistingIds.has(String(row.id)))
        .map((row) => ({ row, delta: Math.abs(new Date(row.open_start).getTime() - start) }))
        .filter(({ delta }) => Number.isFinite(delta) && delta <= 45 * 60 * 1000)
        .sort((left, right) => left.delta - right.delta)[0]?.row;
      if (existing) matchType = 'address_time';
    }

    if (!existing) {
      rows.push(discovered);
      inserted += 1;
      continue;
    }

    usedExistingIds.add(String(existing.id));
    if (matchType === 'id') matchedById += 1;
    else matchedByAddressTime += 1;
    const previouslyEnriched = Boolean(
      meaningfulAgentName(existing.agent)
      && (normalizePhone(existing.agent_phone) || normalizeEmail(existing.agent_email))
    );
    const merged = mergeCanonicalOpenHouse(existing, discovered, nowIso);
    if (!previouslyEnriched && merged.agent_enriched) attached += 1;
    rows.push(merged);
  }

  return {
    rows,
    matched_by_id: matchedById,
    matched_by_address_time: matchedByAddressTime,
    inserted,
    attached
  };
}

async function fetchOneKeyJson(url, label = 'OneKey request') {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20000);
  const response = await fetch(url, {
    headers: {
      Accept: 'application/json,text/plain,*/*',
      'User-Agent': 'Mozilla/5.0 (compatible; Rel8tionAgentListingInventory/1.0)'
    },
    signal: controller.signal
  }).finally(() => clearTimeout(timeout));
  const raw = await response.text().catch(() => '');
  if (!response.ok) throw new Error(raw || `${label} failed: ${response.status}`);
  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new Error(`${label} returned invalid JSON: ${error.message}`);
  }
}

async function fetchOneKeyPage(box, offset) {
  const url = `${ONEKEY_BASE_URL}?topLeft=${encodeURIComponent(box.topLeft)}&bottomRight=${encodeURIComponent(box.bottomRight)}&propertySaleType=Sale&StateOrProvince=NY&offset=${offset}`;
  return fetchOneKeyJson(url, 'OneKey geographic search');
}

function oneKeyAgentCandidate(row = {}) {
  const office = row.OfficeMetadata || {};
  return {
    raw: row,
    name: cleanText(row.MemberFullName),
    phone: firstPresent(row.MemberMobilePhone, row.MemberDirectPhone),
    email: normalizeEmail(row.MemberEmail),
    brokerage: cleanText(office.OfficeName),
    member_key: cleanText(row.MemberKey),
    member_mls_id: cleanText(row.MemberMlsId),
    office_key: cleanText(office.OfficeKey || row.OfficeKey)
  };
}

function matchOneKeyAgentProfile(profile, rows = []) {
  const exact = rows
    .map(oneKeyAgentCandidate)
    .filter((candidate) => (
      candidate.name
      && normalizeName(candidate.name) === profile.agent_name_normalized
      && candidate.member_key
    ));
  const scored = [];

  for (const candidate of exact) {
    const candidatePhone = normalizePhone(candidate.phone);
    const candidateEmail = normalizeEmail(candidate.email);
    const phoneMatch = Boolean(
      profile.phone_normalized
      && candidatePhone
      && profile.phone_normalized === candidatePhone
    );
    const emailMatch = Boolean(profile.email && candidateEmail && profile.email === candidateEmail);
    const brokerageMatch = Boolean(
      profile.brokerage
      && candidate.brokerage
      && similarBrokerage(profile.brokerage, candidate.brokerage)
    );
    const phoneConflict = Boolean(
      profile.phone_normalized
      && candidatePhone
      && profile.phone_normalized !== candidatePhone
    );
    if (phoneConflict) continue;

    let matchScore = 0;
    let matchReason = '';
    if (phoneMatch) {
      matchScore = 100;
      matchReason = 'onekey_agent_phone';
    } else if (emailMatch) {
      matchScore = 98;
      matchReason = 'onekey_agent_email';
    } else if (brokerageMatch) {
      matchScore = 90;
      matchReason = 'onekey_exact_name_brokerage';
    } else if (exact.length === 1) {
      matchScore = 80;
      matchReason = 'onekey_unique_exact_name';
    }
    if (!matchScore) continue;
    scored.push({
      profile,
      candidate,
      match_score: matchScore,
      match_reason: matchReason
    });
  }

  scored.sort((left, right) => right.match_score - left.match_score);
  if (!scored.length) return null;
  if (scored[1] && scored[1].match_score === scored[0].match_score) return null;
  return scored[0];
}

async function fetchOneKeyAgentDirectory(profile) {
  const params = new URLSearchParams({
    value: profile.agent_name,
    page: '1'
  });
  return fetchOneKeyJson(
    `${ONEKEY_AGENT_DIRECTORY_URL}?${params.toString()}`,
    'OneKey agent directory'
  );
}

async function fetchOneKeyAgentListings(config, match, saleType) {
  const params = new URLSearchParams({
    propertySaleType: saleType,
    StateOrProvince: 'NY',
    listAgentFullName: match.candidate.name,
    listAgentKey: match.candidate.member_key
  });
  if (match.candidate.office_key) params.set('listOfficeKey', match.candidate.office_key);

  const byId = new Map();
  let total = 0;
  let offset = 0;
  let complete = false;
  for (let index = 0; index < config.maxOffsets; index += 1) {
    params.set('offset', String(offset));
    const data = await fetchOneKeyJson(
      `${ONEKEY_BASE_URL}?${params.toString()}`,
      `OneKey ${saleType.toLowerCase()} listings`
    );
    const results = Array.isArray(data?.Results) ? data.Results : [];
    total = Number(data?.Total || total || 0);
    for (const record of results) {
      const id = String(record?.UniqueListingId || '');
      if (id) byId.set(id, record);
    }
    if (!results.length) {
      complete = true;
      break;
    }
    const declaredNext = Number(data?.NextOffset);
    const nextOffset = Number.isFinite(declaredNext) && declaredNext > offset
      ? declaredNext
      : offset + results.length;
    if ((total && nextOffset >= total) || results.length >= total) {
      complete = true;
      break;
    }
    if (nextOffset <= offset) break;
    offset = nextOffset;
  }
  return { records: [...byId.values()], total, complete, sale_type: saleType };
}

async function discoverOneKeyListingsForProfile(config, profile, cachedIdentity = null) {
  let directory = null;
  let rows = [];
  let match = cachedIdentity ? cachedOneKeyMatch(profile, cachedIdentity) : null;
  const identityCacheHit = Boolean(match);
  if (!match) {
    directory = await fetchOneKeyAgentDirectory(profile);
    rows = Array.isArray(directory?.Results) ? directory.Results : [];
    match = matchOneKeyAgentProfile(profile, rows);
  }
  if (!match) {
    return {
      profile,
      match: null,
      records: [],
      complete: true,
      directory_total: Number(directory?.Total || rows.length || 0),
      listing_totals: {},
      identity_cache_hit: false
    };
  }

  const scans = await Promise.all(
    ONEKEY_AGENT_DISCOVERY_TYPES.map((saleType) => fetchOneKeyAgentListings(config, match, saleType))
  );
  const byId = new Map();
  for (const scan of scans) {
    for (const record of scan.records) {
      const id = String(record?.UniqueListingId || '');
      if (id) byId.set(id, record);
    }
  }
  return {
    profile,
    match,
    records: [...byId.values()],
    complete: scans.every((scan) => scan.complete),
    directory_total: Number(directory?.Total || rows.length || 0),
    listing_totals: Object.fromEntries(scans.map((scan) => [scan.sale_type, scan.total])),
    identity_cache_hit: identityCacheHit
  };
}

async function mapWithConcurrency(items, concurrency, mapper) {
  const results = new Array(items.length);
  let cursor = 0;
  const workers = Array.from(
    { length: Math.min(Math.max(1, concurrency), Math.max(1, items.length)) },
    async () => {
      while (cursor < items.length) {
        const index = cursor;
        cursor += 1;
        results[index] = await mapper(items[index], index);
      }
    }
  );
  await Promise.all(workers);
  return results;
}

async function scanOneKeyAgents(config, profiles = [], options = {}) {
  const actionable = prioritizeDiscoveryProfiles(profiles);
  const batch = circularBatch(actionable, config.oneKeyAgentLimit, options.cursor || 0);
  const selected = batch.items;
  const identityCache = options.identityCache || new Map();
  const results = await mapWithConcurrency(
    selected,
    config.oneKeyAgentConcurrency,
    async (profile) => {
      try {
        return await discoverOneKeyListingsForProfile(
          config,
          profile,
          identityCache.get(profile.relationship_key) || null
        );
      } catch (error) {
        return {
          profile,
          match: null,
          records: [],
          complete: false,
          error: error.message || String(error),
          directory_total: 0,
          listing_totals: {},
          identity_cache_hit: false
        };
      }
    }
  );
  const entries = [];
  const matchReasons = {};
  for (const result of results) {
    if (!result.match) continue;
    matchReasons[result.match.match_reason] = (matchReasons[result.match.match_reason] || 0) + 1;
    for (const record of result.records) entries.push({ record, match: result.match });
  }
  return {
    entries,
    profiles_considered: actionable.length,
    profiles_scanned: selected.length,
    profiles_matched: results.filter((result) => result.match).length,
    profiles_failed: results.filter((result) => !result.complete).length,
    identity_cache_hits: results.filter((result) => result.identity_cache_hit).length,
    match_reasons: matchReasons,
    complete: selected.length === actionable.length && results.every((result) => result.complete),
    cursor: batch.cursor,
    next_cursor: batch.next_cursor,
    results
  };
}

async function scanOneKey(config) {
  const byId = new Map();
  const boxes = [];
  let complete = true;
  for (const box of config.boxes) {
    let fetched = 0;
    let total = 0;
    let boxComplete = false;
    let offset = 0;
    for (let index = 0; index < config.maxOffsets; index += 1) {
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
      const declaredNext = Number(data?.NextOffset);
      const nextOffset = Number.isFinite(declaredNext) && declaredNext > offset
        ? declaredNext
        : offset + results.length;
      if (total && nextOffset >= total) {
        boxComplete = true;
        break;
      }
      if (nextOffset <= offset) {
        boxComplete = true;
        break;
      }
      offset = nextOffset;
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

async function markStaleInventory(config, nowIso, scanComplete, sources = ['onekey'], cutoffOverride = '') {
  if (config.dryRun || !scanComplete) return { marked_inactive: 0, skipped: true };
  const cutoff = cutoffOverride || new Date(
    new Date(nowIso).getTime() - config.staleAfterHours * 60 * 60 * 1000
  ).toISOString();
  const rows = await supabaseRequest(
    config,
    `agent_listing_inventory?source=in.(${sources.join(',')})&is_current=eq.true&last_seen_at=lt.${encodeURIComponent(cutoff)}`,
    {
      method: 'PATCH',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify({ is_current: false, inactive_at: nowIso, updated_at: nowIso })
    }
  );
  return { marked_inactive: Array.isArray(rows) ? rows.length : 0, skipped: false, cutoff };
}

async function markStaleOneKeyAgentInventory(config, nowIso, scan) {
  if (config.dryRun) return { marked_inactive: 0, skipped: true };
  const relationshipKeys = [
    ...new Set(
      (scan?.results || [])
        .filter((result) => result.complete && result.profile?.relationship_key)
        .map((result) => result.profile.relationship_key)
    )
  ];
  if (!relationshipKeys.length) return { marked_inactive: 0, skipped: true };

  const cutoff = new Date(
    new Date(nowIso).getTime() - config.staleAfterHours * 60 * 60 * 1000
  ).toISOString();
  let markedInactive = 0;
  for (let index = 0; index < relationshipKeys.length; index += DEFAULT_BATCH_SIZE) {
    const batch = relationshipKeys.slice(index, index + DEFAULT_BATCH_SIZE);
    const rows = await supabaseRequest(
      config,
      `agent_listing_inventory?source=eq.onekey&is_current=eq.true&last_seen_at=lt.${encodeURIComponent(cutoff)}&relationship_key=in.${encodeURIComponent(`(${batch.join(',')})`)}`,
      {
        method: 'PATCH',
        headers: { Prefer: 'return=representation' },
        body: JSON.stringify({ is_current: false, inactive_at: nowIso, updated_at: nowIso })
      }
    );
    markedInactive += Array.isArray(rows) ? rows.length : 0;
  }
  return { marked_inactive: markedInactive, skipped: false, cutoff };
}

async function run(options = {}) {
  const config = readConfig(options);
  const nowIso = new Date().toISOString();
  const profiles = await loadRelationshipProfiles(config);
  if (!profiles.length) {
    return { ok: true, dryRun: config.dryRun, relationship_agents: 0, scanned: 0, matched_listings: 0 };
  }

  const indexes = profileIndexes(profiles);
  const inventoryByKey = new Map();
  const openHousesById = new Map();

  const [internal, oneKeyAgentCursor, oneKeyIdentityCache] = await Promise.all([
    loadInternalListingSources(config, nowIso),
    config.oneKeyAgentDiscoveryEnabled ? loadOneKeyAgentCursor(config) : Promise.resolve(0),
    config.oneKeyAgentDiscoveryEnabled ? loadOneKeyIdentityCache(config) : Promise.resolve(new Map())
  ]);
  const websitesById = new Map(internal.websites.map((row) => [String(row.id), row]));
  for (const row of internal.websiteListings) {
    if (!CURRENT_STATUSES.has(cleanText(row.listing_status).toLowerCase().replace(/_/g, ' '))) continue;
    const website = websitesById.get(String(row.agent_website_id)) || {};
    const identity = sourceIdentityRecord(
      row.agent_name || website.name,
      row.agent_phone || website.phone,
      row.agent_email || website.email,
      row.brokerage || website.brokerage
    );
    for (const match of matchProfiles(identity, profiles, indexes)) {
      const payload = internalInventoryPayload({
        ...row,
        agent_name: row.agent_name || website.name,
        agent_phone: row.agent_phone || website.phone,
        agent_email: row.agent_email || website.email,
        brokerage: row.brokerage || website.brokerage
      }, match, nowIso, 'agent_website_listing');
      if (!payload.source_listing_id || !payload.address) continue;
      const key = inventorySemanticKey(payload);
      inventoryByKey.set(key, mergeInventoryPayload(inventoryByKey.get(key), payload));
    }
  }

  for (const row of internal.openHouses) {
    const identity = sourceIdentityRecord(row.agent, row.agent_phone, row.agent_email, row.brokerage);
    for (const match of matchProfiles(identity, profiles, indexes)) {
      const payload = internalInventoryPayload({
        ...row,
        listing_status: 'active'
      }, match, nowIso, 'open_house');
      if (!payload.source_listing_id || !payload.address) continue;
      const key = inventorySemanticKey(payload);
      inventoryByKey.set(key, mergeInventoryPayload(inventoryByKey.get(key), payload));
    }
  }

  const agentScan = config.oneKeyAgentDiscoveryEnabled
    ? await scanOneKeyAgents(config, profiles, {
        cursor: oneKeyAgentCursor,
        identityCache: oneKeyIdentityCache
      })
    : {
        entries: [],
        profiles_considered: 0,
        profiles_scanned: 0,
        profiles_matched: 0,
        profiles_failed: 0,
        identity_cache_hits: 0,
        match_reasons: {},
        complete: false,
        cursor: 0,
        next_cursor: 0,
        results: []
      };
  if (config.oneKeyAgentDiscoveryEnabled) {
    for (const { record, match } of agentScan.entries) {
      if (!currentListing(record)) continue;
      const payload = inventoryPayload(record, match, nowIso);
      if (!payload.source_listing_id || !payload.address) continue;
      const key = inventorySemanticKey(payload);
      inventoryByKey.set(key, mergeInventoryPayload(inventoryByKey.get(key), payload));
      const openHouse = openHousePayload(record, match, nowIso);
      if (openHouse?.id) openHousesById.set(openHouse.id, openHouse);
    }
  }

  const scan = config.oneKeyDiscoveryEnabled
    ? await scanOneKey(config)
    : { records: [], boxes: [], complete: false };
  if (config.oneKeyDiscoveryEnabled) {
    for (const record of scan.records) {
      if (!currentListing(record)) continue;
      for (const match of matchProfiles(record, profiles, indexes)) {
        const payload = inventoryPayload(record, match, nowIso);
        if (!payload.source_listing_id || !payload.address) continue;
        const key = inventorySemanticKey(payload);
        inventoryByKey.set(key, mergeInventoryPayload(inventoryByKey.get(key), payload));
        const openHouse = openHousePayload(record, match, nowIso);
        if (openHouse?.id) openHousesById.set(openHouse.id, openHouse);
      }
    }
  }

  const inventory = [...inventoryByKey.values()];
  const openHouses = [...openHousesById.values()];
  const openHouseReconciliation = reconcileOpenHousePayloads(openHouses, internal.openHouses, nowIso);
  const inventoryWritten = await upsertRows(
    config,
    'agent_listing_inventory',
    inventory,
    'relationship_key,source,source_listing_id'
  );
  const openHousesWritten = config.promoteOpenHouses
    ? await upsertRows(config, 'open_houses', openHouseReconciliation.rows, 'id')
    : 0;
  const stale = await markStaleInventory(
    config,
    nowIso,
    true,
    ['agent_website_listing', 'open_house'],
    nowIso
  );
  const oneKeyStale = config.oneKeyDiscoveryEnabled
    ? await markStaleInventory(config, nowIso, scan.complete, ['onekey'])
    : config.oneKeyAgentDiscoveryEnabled
      ? await markStaleOneKeyAgentInventory(config, nowIso, agentScan)
      : { marked_inactive: 0, skipped: true };
  const cursorSaved = config.oneKeyAgentDiscoveryEnabled && agentScan.profiles_scanned > 0
    ? await saveOneKeyAgentCursor(
        config,
        agentScan.next_cursor,
        agentScan.profiles_considered,
        nowIso
      )
    : false;

  return {
    ok: true,
    dryRun: config.dryRun,
    relationship_agents: profiles.length,
    scanned: scan.records.length,
    scan_complete: config.oneKeyDiscoveryEnabled ? scan.complete : null,
    onekey_discovery_enabled: config.oneKeyDiscoveryEnabled,
    onekey_agent_discovery_enabled: config.oneKeyAgentDiscoveryEnabled,
    onekey_agent_profiles_considered: agentScan.profiles_considered,
    onekey_agent_profiles_scanned: agentScan.profiles_scanned,
    onekey_agent_profiles_matched: agentScan.profiles_matched,
    onekey_agent_profiles_failed: agentScan.profiles_failed,
    onekey_agent_identity_cache_hits: agentScan.identity_cache_hits,
    onekey_agent_match_reasons: agentScan.match_reasons,
    onekey_agent_cursor: agentScan.cursor,
    onekey_agent_next_cursor: agentScan.next_cursor,
    onekey_agent_cursor_saved: cursorSaved,
    onekey_agent_scan_complete: config.oneKeyAgentDiscoveryEnabled ? agentScan.complete : null,
    onekey_agent_listings_scanned: agentScan.entries.length,
    boxes: scan.boxes,
    website_listings_scanned: internal.websiteListings.length,
    upcoming_open_houses_scanned: internal.openHouses.length,
    matched_listings: inventory.length,
    upcoming_open_houses: openHouses.length,
    inventory_written: inventoryWritten,
    open_house_promotion_enabled: config.promoteOpenHouses,
    open_houses_written: openHousesWritten,
    open_houses_matched_by_id: openHouseReconciliation.matched_by_id,
    open_houses_matched_by_address_time: openHouseReconciliation.matched_by_address_time,
    open_houses_agents_attached: openHouseReconciliation.attached,
    open_houses_inserted: openHouseReconciliation.inserted,
    marked_inactive: stale.marked_inactive + oneKeyStale.marked_inactive,
    stale_marking_skipped: stale.skipped,
    onekey_stale_marking_skipped: oneKeyStale.skipped,
    cutoff: stale.cutoff || null
  };
}

function parseCliArgs(argv = []) {
  const options = {};
  for (const arg of argv) {
    if (arg === '--dry-run') options.dryRun = true;
    if (arg === '--promote-open-houses') options.promoteOpenHouses = true;
    if (arg === '--onekey-discovery') options.oneKeyDiscoveryEnabled = true;
    if (arg === '--onekey-agent-discovery') options.oneKeyAgentDiscoveryEnabled = true;
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
  HISTORICAL_OUTREACH_STATUSES,
  POSITIVE_REVIEW_STATUSES,
  PRIOR_OUTREACH_RELATIONSHIP_STATUS,
  RANKING_RELATIONSHIP_STATUS,
  cachedOneKeyMatch,
  circularBatch,
  inventoryPayload,
  internalInventoryPayload,
  inventorySemanticKey,
  discoverOneKeyListingsForProfile,
  listingAgentCandidates,
  matchProfiles,
  matchOneKeyAgentProfile,
  normalizeBrokerage,
  normalizeName,
  normalizePhone,
  openHousePayload,
  prioritizeDiscoveryProfiles,
  profileIndexes,
  readConfig,
  reconcileOpenHousePayloads,
  relationshipKey,
  relationshipProfile,
  run,
  mergeInventoryPayload,
  oneKeyListingUrl,
  scanOneKeyAgents,
  sourceIdentityRecord,
  similarBrokerage,
  wasHistoricalOutreach
};
