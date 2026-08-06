const { supabaseRest } = require('./admin-auth');
const { buildAgentPerformance, phoneDigits } = require('./admin-agent-performance');

const CORE_SOURCES = [
  {
    key: 'agents',
    table: 'agents',
    uuidIds: ['id'],
    slugs: ['slug'],
    names: ['name'],
    phones: ['phone'],
    normalizedPhones: ['phone_normalized'],
    emails: ['email']
  },
  {
    key: 'rankings',
    table: 'agent_rankings',
    uuidIds: ['id', 'agent_id'],
    names: ['agent_name'],
    phones: ['phone'],
    normalizedPhones: ['phone_normalized'],
    emails: ['email']
  },
  {
    key: 'outreach',
    table: 'agent_outreach_queue',
    uuidIds: ['id'],
    names: ['agent_name'],
    phones: ['agent_phone'],
    normalizedPhones: ['agent_phone_normalized'],
    emails: ['agent_email']
  },
  {
    key: 'inbox',
    table: 'agent_outreach_inbox',
    uuidIds: ['queue_row_id'],
    textIds: ['thread_key'],
    names: ['agent_name'],
    phones: ['agent_phone'],
    normalizedPhones: ['agent_phone_normalized'],
    emails: ['agent_email']
  },
  {
    key: 'listingInventory',
    table: 'agent_listing_inventory',
    uuidIds: ['id', 'agent_id', 'queue_row_id'],
    names: ['agent_name'],
    phones: ['phone'],
    normalizedPhones: ['phone_normalized'],
    emails: ['email']
  },
  {
    key: 'listingAgents',
    table: 'listing_agents',
    uuidIds: ['id'],
    names: ['name'],
    phones: ['phone'],
    normalizedPhones: ['phone_normalized'],
    emails: ['email']
  }
];

const SUPPLEMENTAL_SOURCES = [
  {
    key: 'fieldVisits',
    table: 'field_demo_visits',
    uuidIds: ['id', 'outreach_queue_id'],
    slugs: ['agent_slug'],
    names: ['agent_name'],
    phones: ['agent_phone'],
    emails: ['agent_email']
  },
  {
    key: 'leads',
    table: 'leads',
    slugs: ['agent_slug'],
    names: ['agent']
  },
  {
    key: 'openHouses',
    table: 'open_houses',
    uuidIds: ['id'],
    names: ['agent'],
    phones: ['agent_phone'],
    emails: ['agent_email']
  },
  {
    key: 'keys',
    table: 'keys',
    slugs: ['agent_slug']
  },
  {
    key: 'events',
    table: 'open_house_events',
    slugs: ['host_agent_slug']
  }
];

function cleanLookup(value) {
  return String(value || '')
    .replace(/[,*()]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 180);
}

function enc(value) {
  return encodeURIComponent(String(value || ''));
}

function unique(values, limit = 20) {
  return [...new Set((values || []).map((value) => String(value || '').trim()).filter(Boolean))].slice(0, limit);
}

function selector(column, operator, value) {
  return `${column}.${operator}.${enc(value)}`;
}

function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(value || ''));
}

function selectorsForLookup(source, lookup) {
  const raw = cleanLookup(lookup);
  if (!raw) return [];
  const digits = phoneDigits(raw);
  const selectors = [];
  if (isUuid(raw)) {
    for (const column of source.uuidIds || []) selectors.push(selector(column, 'eq', raw));
  }
  for (const column of source.textIds || []) selectors.push(selector(column, 'eq', raw));
  for (const column of source.slugs || []) selectors.push(selector(column, 'eq', raw));
  for (const column of source.names || []) selectors.push(selector(column, 'ilike', raw));
  for (const column of source.emails || []) selectors.push(selector(column, 'ilike', raw));
  for (const column of source.phones || []) selectors.push(selector(column, 'eq', raw));
  if (digits.length >= 7) {
    for (const column of source.normalizedPhones || []) selectors.push(selector(column, 'eq', digits));
    for (const column of source.phones || []) selectors.push(selector(column, 'eq', digits));
  }
  return unique(selectors, 30);
}

function collectIdentity(groups = {}) {
  const identity = {
    ids: [],
    slugs: [],
    names: [],
    phones: [],
    emails: []
  };
  for (const source of [...CORE_SOURCES, ...SUPPLEMENTAL_SOURCES]) {
    for (const row of groups[source.key] || []) {
      for (const column of source.uuidIds || []) identity.ids.push(row?.[column]);
      for (const column of source.textIds || []) identity.ids.push(row?.[column]);
      for (const column of source.slugs || []) identity.slugs.push(row?.[column]);
      for (const column of source.names || []) identity.names.push(row?.[column]);
      for (const column of source.phones || []) identity.phones.push(row?.[column]);
      for (const column of source.normalizedPhones || []) identity.phones.push(row?.[column]);
      for (const column of source.emails || []) identity.emails.push(row?.[column]);
    }
  }
  identity.ids = unique(identity.ids.filter(isUuid));
  identity.slugs = unique(identity.slugs);
  identity.names = unique(identity.names);
  identity.phones = unique(identity.phones.map(phoneDigits).filter((value) => value.length >= 7));
  identity.emails = unique(identity.emails.map((value) => String(value || '').toLowerCase()));
  return identity;
}

function selectorsForIdentity(source, identity) {
  const selectors = [];
  for (const value of identity.ids || []) {
    for (const column of source.uuidIds || []) selectors.push(selector(column, 'eq', value));
  }
  for (const value of identity.slugs || []) {
    for (const column of source.slugs || []) selectors.push(selector(column, 'eq', value));
  }
  for (const value of identity.names || []) {
    for (const column of source.names || []) selectors.push(selector(column, 'ilike', value));
  }
  for (const value of identity.phones || []) {
    for (const column of source.normalizedPhones || []) selectors.push(selector(column, 'eq', value));
    for (const column of source.phones || []) selectors.push(selector(column, 'eq', value));
  }
  for (const value of identity.emails || []) {
    for (const column of source.emails || []) selectors.push(selector(column, 'ilike', value));
  }
  return unique(selectors, 80);
}

function mergeRows(...groups) {
  const rows = new Map();
  for (const group of groups) {
    for (const row of group || []) {
      const key = String(row?.id || row?.thread_key || row?.queue_row_id || JSON.stringify(row));
      if (key) rows.set(key, row);
    }
  }
  return [...rows.values()];
}

async function loadSource(source, selectors, warnings, limit = 1000) {
  if (!selectors.length) return [];
  try {
    const rows = await supabaseRest(
      `${source.table}?select=*&or=(${selectors.join(',')})&limit=${limit}`
    );
    return Array.isArray(rows) ? rows : [];
  } catch (error) {
    warnings.push({ source: source.table, error: error.message || String(error) });
    return [];
  }
}

async function loadOpenHousesByIds(groups, warnings) {
  const ids = unique([
    ...(groups.outreach || []).map((row) => row.open_house_id),
    ...(groups.listingAgents || []).map((row) => row.open_house_id),
    ...(groups.listingInventory || []).map((row) => row.source_listing_id || row.open_house_id)
  ].filter(isUuid), 500);
  if (!ids.length) return [];
  try {
    const rows = await supabaseRest(`open_houses?id=in.(${ids.map(enc).join(',')})&select=*&limit=${ids.length}`);
    return Array.isArray(rows) ? rows : [];
  } catch (error) {
    warnings.push({ source: 'open_houses_by_id', error: error.message || String(error) });
    return [];
  }
}

function profileMatchesLookup(profile, lookup) {
  const raw = cleanLookup(lookup).toLowerCase();
  const digits = phoneDigits(raw);
  const values = [
    profile.id,
    profile.agent_id,
    profile.ranking_id,
    profile.slug,
    profile.name,
    profile.email
  ].map((value) => String(value || '').trim().toLowerCase()).filter(Boolean);
  if (values.includes(raw)) return true;
  if (digits.length >= 7 && phoneDigits(profile.phone_normalized || profile.phone) === digits) return true;
  return (profile.outreach_threads || []).some((thread) => String(thread.id || '').toLowerCase() === raw);
}

async function loadAgentProfiles(lookup) {
  const clean = cleanLookup(lookup);
  if (clean.length < 2) {
    const error = new Error('An agent phone, email, name, slug, or saved ID is required.');
    error.status = 400;
    throw error;
  }

  const warnings = [];
  const seedEntries = await Promise.all(CORE_SOURCES.map(async (source) => [
    source.key,
    await loadSource(source, selectorsForLookup(source, clean), warnings, 100)
  ]));
  const seeds = Object.fromEntries(seedEntries);
  const seedIdentity = collectIdentity(seeds);
  if (!Object.values(seedIdentity).some((values) => values.length)) {
    return { profiles: [], warnings };
  }

  const coreEntries = await Promise.all(CORE_SOURCES.map(async (source) => [
    source.key,
    mergeRows(seeds[source.key], await loadSource(source, selectorsForIdentity(source, seedIdentity), warnings))
  ]));
  const groups = Object.fromEntries(coreEntries);
  const identity = collectIdentity(groups);
  const supplementalEntries = await Promise.all(SUPPLEMENTAL_SOURCES.map(async (source) => [
    source.key,
    await loadSource(source, selectorsForIdentity(source, identity), warnings)
  ]));
  Object.assign(groups, Object.fromEntries(supplementalEntries));
  groups.openHouses = mergeRows(groups.openHouses, await loadOpenHousesByIds(groups, warnings));

  const profiles = buildAgentPerformance(groups).filter((profile) => profileMatchesLookup(profile, clean));
  return { profiles, warnings };
}

module.exports = {
  cleanLookup,
  collectIdentity,
  loadAgentProfiles,
  profileMatchesLookup,
  selectorsForIdentity,
  selectorsForLookup
};
