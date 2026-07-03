const { adminAuthorized, assertAdminConfig, sendJson, supabaseRest } = require('../../lib/admin-auth');
const {
  buildPitchVariants,
  dedupeRowsByIdentityKey,
  identityKeyForAgentRanking,
  marketAverages,
  matchImportedRows,
  normalizeEmail,
  normalizeImportRows,
  normalizeName,
  normalizePhone,
  outreachPayloadFromRanking,
  rankingFromImportRow,
  scoreRow,
  tokenSimilarity
} = require('../../lib/agent-ranking');
const { buildOpenHouseRows, matchOpenHousesForRanking } = require('../../lib/agent-ranking-open-house');
const { inferCountyFromRow, normalizeCounty, normalizeZip } = require('../../lib/location-intelligence');

const OPEN_HOUSE_BASE_SELECT = [
  'id',
  'address',
  'location',
  'agent',
  'brokerage',
  'agent_phone',
  'agent_email',
  'open_start',
  'open_end',
  'created_at',
  'updated_at'
].join(',');

const OPEN_HOUSE_DETAIL_SELECT = [
  OPEN_HOUSE_BASE_SELECT,
  'link',
  'source',
  'image',
  'price',
  'beds',
  'baths',
  'sqft'
].join(',');

const LISTING_AGENT_BASE_SELECT = [
  'open_house_id',
  'name',
  'phone',
  'phone_normalized',
  'email',
  'brokerage',
  'office_city',
  'office_state_or_province',
  'active_listing_count',
  'active_open_house_count'
].join(',');

const LISTING_AGENT_DETAIL_SELECT = [
  'id',
  LISTING_AGENT_BASE_SELECT,
  'source',
  'is_primary',
  'primary_photo_url',
  'directory_photo_url',
  'profile_url',
  'created_at',
  'scraped_at'
].join(',');

const AREA_COMPARE_SELECT = [
  'id',
  'identity_key',
  'agent_name',
  'phone_normalized',
  'market_area',
  'primary_county',
  'county',
  'active_listing_count',
  'listings_days_since_last',
  'listings_active_last_12_months',
  'buyside_last_90_days',
  'buyside_last_12_months',
  'matched_open_house_count',
  'matched_weekend_open_house_count',
  'agent_rank_score',
  'recommended_tier'
].join(',');

function parseBody(req) {
  if (!req.body) return {};
  if (typeof req.body === 'object') return req.body;
  try {
    return JSON.parse(req.body);
  } catch (_) {
    return {};
  }
}

function enc(value) {
  return encodeURIComponent(String(value ?? '').trim());
}

function one(rows) {
  return Array.isArray(rows) ? rows[0] || null : null;
}

function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || ''));
}

function clampLimit(value, fallback = 750, max = 2000) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(1, Math.min(Math.floor(parsed), max));
}

function readQuery(req, name) {
  const value = req.query?.[name];
  if (Array.isArray(value)) return value[0] || '';
  if (value) return value;
  try {
    return new URL(req.url || '', 'https://rel8tion.local').searchParams.get(name) || '';
  } catch (_) {
    return '';
  }
}

function uploadMetadata(body, auth) {
  return {
    source_name: String(body.source_name || 'Manual Upload').trim(),
    market_area: String(body.market_area || body.default_market_area || '').trim() || null,
    period_start: body.period_start || null,
    period_end: body.period_end || null,
    original_filename: String(body.original_filename || '').trim() || null,
    notes: String(body.notes || '').trim() || null,
    uploaded_by: isUuid(auth.uid) ? auth.uid : null
  };
}

function locationDefaults(body) {
  return {
    default_county: String(body.default_county || '').trim(),
    default_market_area: String(body.default_market_area || body.market_area || '').trim(),
    default_state: String(body.default_state || 'NY').trim() || 'NY',
    apply_location_defaults: body.apply_location_defaults !== false,
    try_county_inference: body.try_county_inference !== false,
    location_notes: String(body.location_notes || '').trim()
  };
}

function assertCsvUpload(body) {
  const filename = String(body.original_filename || '').toLowerCase();
  if (filename.endsWith('.xlsx') || filename.endsWith('.xls')) {
    const error = new Error('CSV import is enabled. XLSX support needs a package-backed parser before it can be safely finalized server-side.');
    error.status = 415;
    throw error;
  }
  if (!String(body.file_text || '').trim()) {
    const error = new Error('Missing CSV file contents.');
    error.status = 400;
    throw error;
  }
}

async function loadAgents() {
  return supabaseRest('agents?select=id,name,brokerage,phone,phone_normalized,email&order=name.asc&limit=5000')
    .catch(() => []);
}

function weekendRange(now = new Date()) {
  const start = new Date(now);
  const day = start.getDay();
  const daysUntilSaturday = (6 - day + 7) % 7;
  start.setDate(start.getDate() + daysUntilSaturday);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(start.getDate() + 3);
  end.setHours(3, 0, 0, 0);
  return { start, end };
}

async function loadOpenHouseSignals() {
  const now = new Date();
  const { start, end } = weekendRange(now);
  const rows = await supabaseRest(
    `agent_outreach_queue?select=agent_name,agent_phone,agent_phone_normalized,open_start,open_end,last_outreach_at,created_at&open_start=gte.${enc(now.toISOString())}&order=open_start.asc.nullslast&limit=5000`
  ).catch(() => []);
  const signals = {};
  for (const row of rows || []) {
    const keys = [
      normalizePhone(row.agent_phone_normalized || row.agent_phone),
      normalizeName(row.agent_name)
    ].filter(Boolean);
    const openStart = row.open_start ? new Date(row.open_start) : null;
    const isWeekend = Boolean(openStart && openStart >= start && openStart < end);
    for (const key of keys) {
      if (!signals[key]) {
        signals[key] = {
          open_house_count: 0,
          has_open_house_this_weekend: false,
          last_activity_at: null
        };
      }
      signals[key].open_house_count += 1;
      signals[key].has_open_house_this_weekend = signals[key].has_open_house_this_weekend || isWeekend;
      const activity = row.last_outreach_at || row.open_start || row.created_at || null;
      if (activity && (!signals[key].last_activity_at || new Date(activity) > new Date(signals[key].last_activity_at))) {
        signals[key].last_activity_at = activity;
      }
    }
  }
  return signals;
}

async function loadOpenHouseRows(options = {}) {
  const maxRows = Math.max(1000, Math.min(Number(options.maxRows || 5000), 50000));
  const [openHouses, listingAgents] = await Promise.all([
    supabaseRestAll(
      `open_houses?select=${OPEN_HOUSE_BASE_SELECT}&order=open_start.desc.nullslast`,
      { pageSize: 1000, maxRows }
    ).catch(() => []),
    supabaseRestAll(
      `listing_agents?select=${LISTING_AGENT_BASE_SELECT}`,
      { pageSize: 1000, maxRows }
    ).catch(() => [])
  ]);
  return buildOpenHouseRows(openHouses || [], listingAgents || []);
}

function firstPresent(...values) {
  return values.find((value) => String(value || '').trim()) || '';
}

function arrayValue(value) {
  if (Array.isArray(value)) return value.filter(Boolean);
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return [];
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) return parsed.filter(Boolean);
    } catch (_) {
      return trimmed.split(',').map((item) => item.trim()).filter(Boolean);
    }
  }
  return [];
}

function inFilter(values) {
  return `(${values.map(enc).join(',')})`;
}

async function loadOpenHouseDetailsByIds(ids) {
  const uniqueIds = [...new Set(arrayValue(ids).map(String).filter(Boolean))].slice(0, 50);
  if (!uniqueIds.length) return [];
  return supabaseRest(
    `open_houses?id=in.${inFilter(uniqueIds)}&select=${OPEN_HOUSE_DETAIL_SELECT}&limit=${uniqueIds.length}`
  ).catch(() => []);
}

async function loadListingAgentDetailsByOpenHouseIds(ids) {
  const uniqueIds = [...new Set(arrayValue(ids).map(String).filter(Boolean))].slice(0, 50);
  if (!uniqueIds.length) return [];
  return supabaseRest(
    `listing_agents?open_house_id=in.${inFilter(uniqueIds)}&select=${LISTING_AGENT_DETAIL_SELECT}&order=is_primary.desc.nullslast,created_at.desc&limit=${Math.max(50, uniqueIds.length * 6)}`
  ).catch(() => []);
}

function dedupeListingAgents(agents = []) {
  const seen = new Set();
  const deduped = [];
  for (const agent of agents || []) {
    const key = firstPresent(agent.id, `${agent.open_house_id || ''}|${normalizeName(agent.name)}|${normalizePhone(agent.phone_normalized || agent.phone)}`);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    deduped.push(agent);
  }
  return deduped;
}

async function loadListingAgentPhotoCandidates(ranking = {}) {
  const tries = [];
  const phone = normalizePhone(ranking.phone_normalized || ranking.phone);
  const email = normalizeEmail(ranking.email);
  const name = String(ranking.agent_name || '').trim();
  if (phone) tries.push(`listing_agents?phone_normalized=eq.${enc(phone)}&select=${LISTING_AGENT_DETAIL_SELECT}&order=created_at.desc&limit=20`);
  if (email) tries.push(`listing_agents?email=eq.${enc(email)}&select=${LISTING_AGENT_DETAIL_SELECT}&order=created_at.desc&limit=20`);
  if (name.length >= 3) tries.push(`listing_agents?name=ilike.${enc(`*${name}*`)}&select=${LISTING_AGENT_DETAIL_SELECT}&order=created_at.desc&limit=20`);
  if (!tries.length) return [];
  const results = await Promise.all(tries.map((path) => supabaseRest(path).catch(() => [])));
  return dedupeListingAgents(results.flat());
}

function listingAgentPhoto(agent = {}) {
  agent = agent || {};
  return firstPresent(agent.primary_photo_url, agent.directory_photo_url, agent.image_url, agent.photo_url);
}

function listingAgentFitScore(ranking = {}, agent = {}) {
  ranking = ranking || {};
  agent = agent || {};
  const rankingPhone = normalizePhone(ranking.phone_normalized || ranking.phone);
  const agentPhone = normalizePhone(agent.phone_normalized || agent.phone);
  if (rankingPhone && agentPhone && rankingPhone === agentPhone) return 100;

  const rankingEmail = normalizeEmail(ranking.email);
  const agentEmail = normalizeEmail(agent.email);
  if (rankingEmail && agentEmail && rankingEmail === agentEmail) return 95;

  const nameScore = tokenSimilarity(ranking.agent_name, agent.name);
  const brokerageScore = tokenSimilarity(ranking.brokerage, agent.brokerage);
  if (nameScore >= 0.76 && brokerageScore >= 0.35) return Math.round(70 + (nameScore * 20) + (brokerageScore * 10));
  if (nameScore >= 0.76) return Math.round(55 + (nameScore * 25));
  return Math.round(nameScore * 60);
}

function bestListingAgentForRanking(ranking = {}, agents = []) {
  return [...(agents || [])]
    .sort((left, right) => {
      const scoreDelta = listingAgentFitScore(ranking, right) - listingAgentFitScore(ranking, left);
      if (scoreDelta) return scoreDelta;
      return Number(Boolean(listingAgentPhoto(right))) - Number(Boolean(listingAgentPhoto(left)));
    })[0] || null;
}

function publicListingAgent(agent = {}, ranking = {}) {
  agent = agent || {};
  ranking = ranking || {};
  return {
    id: agent.id || '',
    name: agent.name || '',
    phone: agent.phone || agent.phone_normalized || '',
    phone_normalized: normalizePhone(agent.phone_normalized || agent.phone),
    email: agent.email || '',
    brokerage: agent.brokerage || '',
    office_city: agent.office_city || '',
    office_state_or_province: agent.office_state_or_province || '',
    active_listing_count: Number(agent.active_listing_count || 0),
    active_open_house_count: Number(agent.active_open_house_count || 0),
    profile_url: agent.profile_url || '',
    photo_url: listingAgentPhoto(agent),
    match_score: listingAgentFitScore(ranking, agent)
  };
}

function listingPhoto(openHouse = {}) {
  openHouse = openHouse || {};
  return firstPresent(openHouse.image, openHouse.image_url, openHouse.listing_photo_url, openHouse.primary_photo_url, openHouse.photo_url);
}

function openHouseDetailRow(openHouse = {}, agents = [], ranking = {}) {
  openHouse = openHouse || {};
  ranking = ranking || {};
  const bestAgent = bestListingAgentForRanking(ranking, agents);
  return {
    id: openHouse.id || '',
    address: openHouse.address || openHouse.location || '',
    listing_url: openHouse.link || '',
    listing_photo_url: listingPhoto(openHouse),
    source: openHouse.source || '',
    price: openHouse.price || null,
    beds: openHouse.beds || null,
    baths: openHouse.baths || null,
    sqft: openHouse.sqft || null,
    open_start: openHouse.open_start || null,
    open_end: openHouse.open_end || null,
    updated_at: openHouse.updated_at || openHouse.created_at || null,
    agent_name: firstPresent(bestAgent?.name, openHouse.agent),
    brokerage: firstPresent(bestAgent?.brokerage, openHouse.brokerage),
    agent_phone: firstPresent(bestAgent?.phone, bestAgent?.phone_normalized, openHouse.agent_phone),
    agent_email: firstPresent(bestAgent?.email, openHouse.agent_email),
    agent_photo_url: listingAgentPhoto(bestAgent),
    agent_profile_url: bestAgent?.profile_url || '',
    match_score: bestAgent ? listingAgentFitScore(ranking, bestAgent) : 0,
    listing_agents: agents.map((agent) => publicListingAgent(agent, ranking))
  };
}

function roundMetric(value, digits = 1) {
  const number = Number(value || 0);
  if (!Number.isFinite(number)) return 0;
  const factor = 10 ** digits;
  return Math.round(number * factor) / factor;
}

function ratioText(value, average, lowerIsBetter = false) {
  const current = Number(value || 0);
  const avg = Number(average || 0);
  if (!Number.isFinite(current) || !Number.isFinite(avg) || avg <= 0) return 'area average unavailable';
  const delta = lowerIsBetter ? avg - current : current - avg;
  const pct = Math.round(Math.abs(delta / avg) * 100);
  if (pct < 8) return 'about area average';
  const direction = delta > 0 ? (lowerIsBetter ? 'fresher than' : 'above') : (lowerIsBetter ? 'staler than' : 'below');
  return `${pct}% ${direction} area average`;
}

function comparisonMetric(label, value, average, options = {}) {
  return {
    label,
    value: roundMetric(value, options.digits ?? 1),
    average: roundMetric(average, options.digits ?? 1),
    unit: options.unit || '',
    lower_is_better: Boolean(options.lowerIsBetter),
    comparison: ratioText(value, average, Boolean(options.lowerIsBetter))
  };
}

function plural(value, singular, pluralValue = `${singular}s`) {
  return Number(value || 0) === 1 ? singular : pluralValue;
}

function beVerb(value) {
  return Number(value || 0) === 1 ? 'is' : 'are';
}

function areaOpportunityStory(ranking = {}, metrics = [], label = 'area') {
  const agent = ranking.agent_name || 'This agent';
  const activeListings = Number(ranking.active_listing_count || 0);
  const listingSide12 = Number(ranking.listings_active_last_12_months || 0);
  const buyside12 = Number(ranking.buyside_last_12_months || 0);
  const daysSince = Number(ranking.listings_days_since_last || 0);
  const matchedOpenHouses = Number(ranking.matched_open_house_count || 0);
  const avgBuySide = Number(metrics.find((metric) => metric.label === 'Buyside 12m')?.average || 0);
  const avgDays = Number(metrics.find((metric) => metric.label === 'Days since last listing')?.average || 0);
  const hasFreshListing = daysSince > 0 && (!avgDays || daysSince <= Math.min(45, avgDays));
  const hasListingTraffic = activeListings > 0 || listingSide12 > 0;
  const buysideGap = avgBuySide > 0 && buyside12 < avgBuySide;

  if (hasListingTraffic && buysideGap) {
    const activeText = activeListings > 0
      ? `${activeListings} active ${plural(activeListings, 'listing')}`
      : `${listingSide12} listing-side ${plural(listingSide12, 'transaction')} in the last 12 months`;
    const recencyText = hasFreshListing ? ` and a listing ${daysSince} days ago` : '';
    return {
      headline: `${agent} is creating listing traffic with ${activeText}${recencyText}, but the buyer-side number is not keeping up.`,
      opportunity: `ListReports shows ${buyside12} buyer-side ${plural(buyside12, 'transaction')} in the last 12 months versus a ${roundMetric(avgBuySide, 1)} ${label} peer average. That is the missed capture story: buyers are showing up around the listings, but they are not turning into visible buyer-side opportunity.`,
      capture: matchedOpenHouses > 0
        ? `${matchedOpenHouses} matched Rel8tion open-house ${plural(matchedOpenHouses, 'record')} ${beVerb(matchedOpenHouses)} connected. Use that proof to show how much more buyer traffic can be captured.`
        : `No Rel8tion open-house capture is connected yet, so the next open house is the moment to stop buyer conversations from disappearing after the sign-in sheet.`
    };
  }

  if (hasListingTraffic && matchedOpenHouses <= 0) {
    const recencyText = hasFreshListing ? `, including a listing ${daysSince} days ago,` : '';
    return {
      headline: `${agent} has listing activity${recencyText} but no Rel8tion capture connected yet.`,
      opportunity: `The missed opportunity is not production volume; it is the buyer traffic around the listings they already have. Rel8tion gives that traffic a tap-or-scan capture point, instant follow-up, disclosures, and financing support without adding work for the agent.`,
      capture: `No matched Rel8tion open-house capture is connected yet, which means the first Event Pass can create new visibility immediately.`
    };
  }

  return {
    headline: `${agent} is close to the ${label} peer average, so the easiest win is improving buyer capture on the next listing.`,
    opportunity: `Rel8tion changes the outcome by giving them a no-setup Event Pass for the next listing, so even average production can create cleaner buyer capture and stronger follow-up.`,
    capture: matchedOpenHouses > 0
      ? `${matchedOpenHouses} matched Rel8tion open-house ${plural(matchedOpenHouses, 'record')} ${beVerb(matchedOpenHouses)} already connected.`
      : `No matched Rel8tion open-house capture is connected yet, which means the first Event Pass can create new visibility immediately.`
  };
}

async function loadAreaPeerRows(ranking = {}) {
  const county = normalizeCounty(ranking.primary_county || ranking.county || '');
  const market = canonicalMarketArea(ranking.market_area, ranking);
  const attempts = [];
  if (county) {
    attempts.push({
      label: county,
      basis: 'county',
      path: `agent_rankings?primary_county=eq.${enc(county)}&select=${AREA_COMPARE_SELECT}&order=id.asc`
    });
    attempts.push({
      label: county,
      basis: 'county',
      path: `agent_rankings?county=eq.${enc(county)}&select=${AREA_COMPARE_SELECT}&order=id.asc`
    });
  }
  if (market && market !== county) {
    attempts.push({
      label: market,
      basis: 'market',
      path: `agent_rankings?market_area=eq.${enc(market)}&select=${AREA_COMPARE_SELECT}&order=id.asc`
    });
  }

  for (const attempt of attempts) {
    const rows = await supabaseRestAll(attempt.path, { pageSize: 1000, maxRows: 15000 }).catch(() => []);
    const peers = (rows || []).filter((row) => hasRankingIdentity(row));
    if (peers.length >= 5) return { ...attempt, rows: peers };
  }

  return { label: county || market || 'Area', basis: county ? 'county' : 'market', rows: [] };
}

function areaComparisonForRanking(ranking = {}, peerContext = {}) {
  const rows = (peerContext.rows || []).filter((row) => row.id !== ranking.id);
  const averages = marketAverages(rows.length ? rows : peerContext.rows || []);
  const label = peerContext.label || ranking.primary_county || ranking.county || ranking.market_area || 'Area';
  const metrics = [
    comparisonMetric('Active listings', ranking.active_listing_count, averages.average_active_listings, { digits: 1 }),
    comparisonMetric('Listing side 12m', ranking.listings_active_last_12_months, averages.average_listing_side_12_months, { digits: 1 }),
    comparisonMetric('Buyside 12m', ranking.buyside_last_12_months, averages.average_buyside_12_months, { digits: 1 }),
    comparisonMetric('Days since last listing', ranking.listings_days_since_last, averages.average_days_since_last_listing, { digits: 0, unit: 'days', lowerIsBetter: true })
  ];
  const story = areaOpportunityStory(ranking, metrics, label);

  return {
    label,
    basis: peerContext.basis || '',
    peer_count: rows.length || (peerContext.rows || []).length,
    averages: {
      active_listing_count: roundMetric(averages.average_active_listings, 1),
      listings_active_last_12_months: roundMetric(averages.average_listing_side_12_months, 1),
      buyside_last_12_months: roundMetric(averages.average_buyside_12_months, 1),
      listings_days_since_last: roundMetric(averages.average_days_since_last_listing, 0)
    },
    metrics,
    headline: story.headline,
    opportunity: story.opportunity,
    capture: story.capture
  };
}

async function profileDetailsForRanking(ranking) {
  let ids = arrayValue(ranking.matched_open_house_ids);
  let openHouses = await loadOpenHouseDetailsByIds(ids);
  let listingAgents = await loadListingAgentDetailsByOpenHouseIds(ids);
  let photoCandidates = [];
  const peerContext = await loadAreaPeerRows(ranking);

  if (!openHouses.length && Number(ranking.matched_open_house_count || 0) > 0) {
    const openHouseRows = await loadOpenHouseRows();
    const match = matchOpenHousesForRanking(ranking, openHouseRows);
    ids = match.matched_open_house_ids || [];
    [openHouses, listingAgents] = await Promise.all([
      loadOpenHouseDetailsByIds(ids),
      loadListingAgentDetailsByOpenHouseIds(ids)
    ]);
  }

  if (!openHouses.length) {
    photoCandidates = await loadListingAgentPhotoCandidates(ranking);
    const candidateOpenHouseIds = [...new Set(photoCandidates.map((agent) => agent.open_house_id).filter(Boolean))].slice(0, 50);
    if (candidateOpenHouseIds.length) {
      [openHouses, listingAgents] = await Promise.all([
        loadOpenHouseDetailsByIds(candidateOpenHouseIds),
        loadListingAgentDetailsByOpenHouseIds(candidateOpenHouseIds)
      ]);
    }
  }

  if (!listingAgents.some((agent) => listingAgentPhoto(agent))) {
    photoCandidates = photoCandidates.length ? photoCandidates : await loadListingAgentPhotoCandidates(ranking);
  }
  const allListingAgents = dedupeListingAgents([...(listingAgents || []), ...(photoCandidates || [])]);

  const agentsByOpenHouse = new Map();
  for (const agent of listingAgents || []) {
    const key = String(agent.open_house_id || '');
    if (!key) continue;
    if (!agentsByOpenHouse.has(key)) agentsByOpenHouse.set(key, []);
    agentsByOpenHouse.get(key).push(agent);
  }

  const rows = (openHouses || [])
    .map((openHouse) => openHouseDetailRow(openHouse, agentsByOpenHouse.get(String(openHouse.id || '')) || [], ranking))
    .sort((left, right) => new Date(right.open_start || right.updated_at || 0) - new Date(left.open_start || left.updated_at || 0));
  const bestAgent = bestListingAgentForRanking(ranking, allListingAgents || []);
  const bestAgentPhoto = listingAgentPhoto(bestAgent);
  return {
    ranking,
    profile_photo_url: firstPresent(ranking.agent_photo_url, ranking.image_url, bestAgentPhoto),
    profile_url: bestAgent?.profile_url || '',
    area_comparison: areaComparisonForRanking(ranking, peerContext),
    current_listings: rows,
    open_houses: rows,
    listing_agents: allListingAgents.map((agent) => publicListingAgent(agent, ranking)),
    summary: {
      matched_open_house_count: rows.length,
      matched_listing_agent_count: allListingAgents.length,
      active_listing_count: Number(ranking.active_listing_count || 0),
      matched_active_listing_count: Number(ranking.matched_active_listing_count || 0),
      weekend_open_house_count: Number(ranking.matched_weekend_open_house_count || 0)
    }
  };
}

async function parseAndMatch(body) {
  assertCsvUpload(body);
  const defaults = locationDefaults(body);
  const parsed = normalizeImportRows(body.file_text, {
    market_area: body.market_area,
    column_overrides: body.column_overrides || {},
    ...defaults
  });
  const agents = await loadAgents();
  const matchedRows = matchImportedRows(parsed.rows, agents);
  const matchedCount = matchedRows.filter((row) => row.matched_agent_id).length;
  const needsReviewCount = matchedRows.filter((row) => row.needs_review).length;
  return {
    ...parsed,
    rows: matchedRows,
    matched_count: matchedCount,
    unmatched_count: matchedRows.length - matchedCount,
    needs_review_count: needsReviewCount
  };
}

function importRowPayload(uploadId, row) {
  return {
    upload_id: uploadId,
    matched_agent_id: row.matched_agent_id || null,
    agent_name: row.agent_name || null,
    first_name: row.first_name || null,
    last_name: row.last_name || null,
    brokerage: row.brokerage || null,
    phone: row.phone || null,
    phone_normalized: row.phone_normalized || null,
    email: row.email || null,
    market_area: row.market_area || null,
    city: row.city || null,
    county: row.county || null,
    primary_county: row.primary_county || row.county || null,
    zip: row.zip || null,
    inferred_county: row.inferred_county || null,
    location_confidence: row.location_confidence || 0,
    location_source: row.location_source || 'missing',
    state: row.state || null,
    production_volume: row.production_volume || 0,
    transaction_count: row.transaction_count || 0,
    active_listing_count: row.active_listing_count || 0,
    sold_listing_count: row.sold_listing_count || 0,
    listings_days_since_last: row.listings_days_since_last || 0,
    listings_active_last_12_months: row.listings_active_last_12_months || 0,
    buyside_last_90_days: row.buyside_last_90_days || 0,
    buyside_last_12_months: row.buyside_last_12_months || 0,
    average_price: row.average_price || 0,
    raw: {
      ...(row.raw || {}),
      duplicate_key: row.duplicate_key || null,
      is_duplicate: Boolean(row.is_duplicate),
      identity_key: row.identity_key || null,
      identity_missing_reason: row.identity_missing_reason || null,
      match_reason: row.match_reason || 'unmatched',
      needs_review: Boolean(row.needs_review)
    },
    match_confidence: row.match_confidence || 0
  };
}

async function insertRows(table, rows, chunkSize = 200) {
  const inserted = [];
  for (let index = 0; index < rows.length; index += chunkSize) {
    const chunk = rows.slice(index, index + chunkSize);
    if (!chunk.length) continue;
    const result = await supabaseRest(table, {
      method: 'POST',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify(chunk)
    });
    inserted.push(...(Array.isArray(result) ? result : []));
  }
  return inserted;
}

function pagedPath(path, limit, offset) {
  const joiner = path.includes('?') ? '&' : '?';
  return `${path}${joiner}limit=${limit}&offset=${offset}`;
}

async function supabaseRestAll(path, options = {}) {
  const pageSize = Math.max(1, Math.min(Number(options.pageSize || 1000), 1000));
  const maxRows = Math.max(pageSize, Number(options.maxRows || 100000));
  const rows = [];

  for (let offset = 0; offset < maxRows; offset += pageSize) {
    const chunk = await supabaseRest(pagedPath(path, pageSize, offset)).catch(() => []);
    if (!Array.isArray(chunk) || !chunk.length) break;
    rows.push(...chunk);
    if (chunk.length < pageSize) break;
  }

  return rows;
}

async function postRowsResilient(path, rows, options = {}, chunkSize = 100) {
  const inserted = [];
  const failed = [];

  for (let index = 0; index < rows.length; index += chunkSize) {
    const chunk = rows.slice(index, index + chunkSize);
    if (!chunk.length) continue;
    try {
      const result = await supabaseRest(path, {
        method: 'POST',
        ...(options || {}),
        body: JSON.stringify(chunk)
      });
      inserted.push(...(Array.isArray(result) ? result : []));
    } catch (error) {
      for (const row of chunk) {
        try {
          const result = await supabaseRest(path, {
            method: 'POST',
            ...(options || {}),
            body: JSON.stringify([row])
          });
          inserted.push(...(Array.isArray(result) ? result : []));
        } catch (rowError) {
          failed.push({
            identity_key: row.identity_key || null,
            agent_name: row.agent_name || null,
            error: rowError.message || 'Row failed'
          });
        }
      }
    }
  }

  return { inserted, failed };
}

function rankingIdentity(row) {
  return row.identity_key || identityKeyForAgentRanking(row);
}

function displayDedupeKey(row) {
  const name = normalizeName(row.agent_name || [row.first_name, row.last_name].filter(Boolean).join(' '));
  const phone = normalizePhone(row.phone_normalized || row.phone);
  const brokerage = normalizeName(row.brokerage || '');
  if (!name || !phone) return '';
  return `display:${name}|${brokerage}|${phone}`;
}

function rankingStrength(row) {
  return [
    Number(row.agent_rank_score || 0),
    Number(row.opportunity_gap_score || 0),
    Number(row.matched_weekend_open_house_count || 0),
    Number(row.matched_open_house_count || 0),
    Number(row.active_listing_count || 0),
    Number(row.listings_active_last_12_months || 0),
    Number(row.buyside_last_12_months || 0),
    Number(row.production_volume || 0),
    Number(row.transaction_count || 0),
    Number(row.raw_sources?.match_confidence || 0)
  ];
}

function strongerRanking(left, right) {
  const a = rankingStrength(left);
  const b = rankingStrength(right);
  for (let index = 0; index < a.length; index += 1) {
    if (a[index] !== b[index]) return a[index] > b[index] ? left : right;
  }
  return left;
}

function maxNumber(...values) {
  return Math.max(0, ...values.map((value) => Number(value || 0)).filter((value) => Number.isFinite(value)));
}

function minPositiveNumber(...values) {
  const positive = values
    .map((value) => Number(value || 0))
    .filter((value) => Number.isFinite(value) && value > 0);
  return positive.length ? Math.min(...positive) : 0;
}

function latestDateValue(...values) {
  let latest = null;
  for (const value of values) {
    if (!value) continue;
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) continue;
    if (!latest || date.getTime() > latest.time) latest = { value, time: date.getTime() };
  }
  return latest?.value || null;
}

function uniqueStrings(values = []) {
  return [...new Set((values || []).flat().filter(Boolean).map(String))];
}

function rowLocationLabel(row = {}) {
  return [
    row.primary_county || row.county || '',
    row.market_area || '',
    [row.city, row.state].filter(Boolean).join(', ')
  ].filter(Boolean).join(' / ');
}

function mergeDuplicateRanking(kept, duplicate, key) {
  const keptIds = kept.raw_sources?.duplicate_import_row_ids || [];
  const duplicateIds = duplicate.raw_sources?.duplicate_import_row_ids || [];
  return {
    ...kept,
    raw_sources: {
      ...(kept.raw_sources || {}),
      duplicate_identity_key: key,
      duplicate_ranking_count: Number(kept.raw_sources?.duplicate_ranking_count || 1) + Number(duplicate.raw_sources?.duplicate_ranking_count || 1),
      duplicate_import_row_ids: [
        ...new Set([
          ...keptIds,
          ...duplicateIds,
          kept.latest_import_row_id,
          duplicate.latest_import_row_id
        ].filter(Boolean))
      ]
    }
  };
}

function mergeDisplayDuplicateRanking(kept, duplicate, key) {
  const keptRaw = kept.raw_sources || {};
  const duplicateRaw = duplicate.raw_sources || {};
  const keptCount = Number(keptRaw.display_duplicate_count || 1);
  const duplicateCount = Number(duplicateRaw.display_duplicate_count || 1);
  const ids = uniqueStrings([
    keptRaw.display_duplicate_ranking_ids || [],
    duplicateRaw.display_duplicate_ranking_ids || [],
    kept.id,
    duplicate.id
  ]);
  const identityKeys = uniqueStrings([
    keptRaw.display_duplicate_identity_keys || [],
    duplicateRaw.display_duplicate_identity_keys || [],
    kept.identity_key,
    duplicate.identity_key
  ]);
  const uploadIds = uniqueStrings([
    keptRaw.display_duplicate_upload_ids || [],
    duplicateRaw.display_duplicate_upload_ids || [],
    uploadIdForRanking(kept),
    uploadIdForRanking(duplicate)
  ]);
  const locations = uniqueStrings([
    keptRaw.display_duplicate_locations || [],
    duplicateRaw.display_duplicate_locations || [],
    rowLocationLabel(kept),
    rowLocationLabel(duplicate)
  ]);
  const matchedOpenHouseIds = uniqueStrings([
    kept.matched_open_house_ids || [],
    duplicate.matched_open_house_ids || []
  ]);

  return {
    ...kept,
    agent_id: kept.agent_id || duplicate.agent_id || null,
    latest_import_row_id: kept.latest_import_row_id || duplicate.latest_import_row_id || null,
    email: kept.email || duplicate.email || null,
    active_listing_count: maxNumber(kept.active_listing_count, duplicate.active_listing_count),
    sold_listing_count: maxNumber(kept.sold_listing_count, duplicate.sold_listing_count),
    listings_days_since_last: minPositiveNumber(kept.listings_days_since_last, duplicate.listings_days_since_last),
    listings_active_last_12_months: maxNumber(kept.listings_active_last_12_months, duplicate.listings_active_last_12_months),
    buyside_last_90_days: maxNumber(kept.buyside_last_90_days, duplicate.buyside_last_90_days),
    buyside_last_12_months: maxNumber(kept.buyside_last_12_months, duplicate.buyside_last_12_months),
    open_house_count: maxNumber(kept.open_house_count, duplicate.open_house_count),
    matched_open_house_count: maxNumber(kept.matched_open_house_count, duplicate.matched_open_house_count),
    matched_weekend_open_house_count: maxNumber(kept.matched_weekend_open_house_count, duplicate.matched_weekend_open_house_count),
    matched_active_listing_count: maxNumber(kept.matched_active_listing_count, duplicate.matched_active_listing_count),
    matched_open_house_ids: matchedOpenHouseIds,
    has_open_house_this_weekend: Boolean(kept.has_open_house_this_weekend || duplicate.has_open_house_this_weekend),
    has_phone: Boolean(kept.has_phone || duplicate.has_phone || kept.phone_normalized || duplicate.phone_normalized),
    has_email: Boolean(kept.has_email || duplicate.has_email || kept.email || duplicate.email),
    location_confidence: maxNumber(kept.location_confidence, duplicate.location_confidence),
    last_activity_at: latestDateValue(kept.last_activity_at, duplicate.last_activity_at) || kept.last_activity_at || duplicate.last_activity_at || null,
    last_matched_open_house_at: latestDateValue(kept.last_matched_open_house_at, duplicate.last_matched_open_house_at) || kept.last_matched_open_house_at || duplicate.last_matched_open_house_at || null,
    updated_at: latestDateValue(kept.updated_at, duplicate.updated_at) || kept.updated_at || duplicate.updated_at || null,
    raw_sources: {
      ...keptRaw,
      display_dedupe_key: key,
      display_duplicate_count: keptCount + duplicateCount,
      display_duplicate_ranking_ids: ids,
      display_duplicate_identity_keys: identityKeys,
      display_duplicate_upload_ids: uploadIds,
      display_duplicate_locations: locations,
      display_duplicate_note: 'Duplicate stored ranking rows are collapsed for this dashboard view; raw import rows are preserved.'
    }
  };
}

function dedupeRankings(rankings) {
  const map = new Map();
  let collapsed = 0;

  for (const ranking of rankings || []) {
    const key = rankingIdentity(ranking);
    if (!key) continue;
    const existing = map.get(key);
    if (!existing) {
      map.set(key, ranking);
      continue;
    }
    collapsed += 1;
    const strongest = strongerRanking(existing, ranking);
    const duplicate = strongest === existing ? ranking : existing;
    map.set(key, mergeDuplicateRanking(strongest, duplicate, key));
  }

  return { rankings: [...map.values()], collapsed };
}

function dedupeRankingsForDisplay(rankings) {
  const map = new Map();
  let collapsed = 0;
  let groups = 0;

  for (const ranking of rankings || []) {
    const key = displayDedupeKey(ranking);
    if (!key) continue;
    const existing = map.get(key);
    if (!existing) {
      map.set(key, ranking);
      continue;
    }
    collapsed += 1;
    if (Number(existing.raw_sources?.display_duplicate_count || 1) === 1) groups += 1;
    const strongest = strongerRanking(existing, ranking);
    const duplicate = strongest === existing ? ranking : existing;
    map.set(key, mergeDisplayDuplicateRanking(strongest, duplicate, key));
  }

  return { rankings: [...map.values()], collapsed, groups };
}

async function upsertRankings(rankings) {
  const deduped = dedupeRowsByIdentityKey(rankings);
  const existing = await supabaseRestAll('agent_rankings?select=id,identity_key&order=id.asc')
    .catch(() => []);
  const existingIdentityKeys = new Set((existing || []).map((row) => row.identity_key).filter(Boolean));
  const payloadRows = deduped.rows.map((ranking) => ({
    ...ranking,
    identity_key: ranking.identity_key || identityKeyForAgentRanking(ranking)
  })).filter((ranking) => ranking.identity_key);

  const result = await postRowsResilient('agent_rankings?on_conflict=identity_key', payloadRows, {
    headers: { Prefer: 'resolution=merge-duplicates,return=representation' }
  }, 100);

  const created = [];
  const updated = [];
  for (const row of result.inserted) {
    if (existingIdentityKeys.has(row.identity_key)) updated.push(row);
    else created.push(row);
  }

  return {
    created,
    updated,
    failed: result.failed,
    collapsed_duplicates: deduped.duplicates_skipped,
    skipped_missing_identity: deduped.skipped_missing_identity,
    skipped_missing_identity_count: deduped.skipped_missing_identity_count
  };
}

function rescoreRanking(ranking, averages) {
  const scored = scoreRow(ranking, averages);
  return {
    ...ranking,
    rel8tion_lead_capture_score: scored.rel8tion_lead_capture_score,
    opportunity_gap_score: scored.opportunity_gap_score,
    agent_rank_score: scored.agent_rank_score,
    recommended_tier: scored.recommended_tier,
    recommended_pitch: scored.recommended_pitch,
    next_best_action: scored.next_best_action,
    gap_summary: scored.gap_summary,
    rel8tion_value_summary: scored.rel8tion_value_summary,
    raw_sources: {
      ...(ranking.raw_sources || {}),
      labels: scored.labels,
      above_average_volume: scored.above_average_volume,
      above_average_transactions: scored.above_average_transactions,
      above_average_listing_side_12_months: scored.above_average_listing_side_12_months,
      above_average_buyside_12_months: scored.above_average_buyside_12_months,
      above_average_price: scored.above_average_price,
      below_average_capture_opportunity: scored.below_average_capture_opportunity,
      needs_location_review: !ranking.primary_county && !ranking.county
    }
  };
}

function uploadMapping(upload, field) {
  return upload?.raw_metadata?.mapping?.[field] || null;
}

function looksLikeEncodedGeometry(value) {
  const text = String(value || '').trim();
  return /^010[0-9a-f]{20,}$/i.test(text) || /^[0-9a-f]{32,}$/i.test(text);
}

function fallbackMarketArea(row = {}) {
  const county = normalizeCounty(row.primary_county || row.county || '');
  if (county) return county;
  const state = String(row.state || '').trim().toUpperCase();
  return state || '';
}

function canonicalMarketArea(value, row = {}) {
  const text = String(value || '').trim().replace(/\s+/g, ' ');
  if (!text || looksLikeEncodedGeometry(text)) return fallbackMarketArea(row);
  const normalized = text.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  if (['lng island', 'long island', 'li', 'nassau suffolk', 'nassau and suffolk'].includes(normalized)) {
    return 'Long Island';
  }
  if (normalized === 'nassau county') return 'Nassau';
  if (normalized === 'suffolk county') return 'Suffolk';
  if (normalized === 'schenectady county') return 'Schenectady';
  return text;
}

function isTrustedListReportsUpload(upload) {
  const source = String(upload?.source_name || '').trim().toLowerCase();
  if (source && source !== 'listreports') return false;

  const hasCoreListReportsFields = [
    'agent_name',
    'brokerage',
    'phone',
    'active_listing_count',
    'listings_days_since_last',
    'listings_active_last_12_months',
    'buyside_last_90_days',
    'buyside_last_12_months'
  ].every((field) => Boolean(uploadMapping(upload, field)));

  const hasLegacyBadProductionMapping = [
    'production_volume',
    'transaction_count',
    'sold_listing_count',
    'average_price'
  ].some((field) => Boolean(uploadMapping(upload, field)));

  return hasCoreListReportsFields && !hasLegacyBadProductionMapping;
}

function buildTrustedUploadSet(uploads) {
  return new Set((uploads || []).filter(isTrustedListReportsUpload).map((upload) => upload.id).filter(Boolean));
}

function hasRankingIdentity(row) {
  return Boolean(row?.identity_key && normalizePhone(row.phone_normalized || row.phone));
}

function normalizeListReportsRanking(row) {
  const marketArea = canonicalMarketArea(row.market_area, row);
  return {
    ...row,
    market_area: marketArea || null,
    production_volume: 0,
    transaction_count: 0,
    sold_listing_count: 0,
    average_price: 0,
    raw_sources: {
      ...(row.raw_sources || {}),
      trusted_listreports_display: true,
      original_market_area: row.market_area && row.market_area !== marketArea ? row.market_area : row.raw_sources?.original_market_area,
      display_metric_note: 'ListReports import does not provide production volume, transaction count, sold listings, or average price.'
    }
  };
}

function trustedRankingView(rankings, uploads) {
  const trustedUploadIds = buildTrustedUploadSet(uploads);
  const dataQuality = {
    raw_ranking_rows: (rankings || []).length,
    trusted_uploads: trustedUploadIds.size,
    hidden_missing_identity: 0,
    hidden_untrusted_upload: 0,
    trusted_rows_before_display_dedupe: 0,
    collapsed_display_duplicates: 0,
    collapsed_display_duplicate_groups: 0,
    visible_trusted_rows: 0
  };

  const candidates = [];
  for (const row of rankings || []) {
    if (!hasRankingIdentity(row)) {
      dataQuality.hidden_missing_identity += 1;
      continue;
    }
    if (!trustedUploadIds.has(uploadIdForRanking(row))) {
      dataQuality.hidden_untrusted_upload += 1;
      continue;
    }
    candidates.push(normalizeListReportsRanking(row));
  }

  const deduped = dedupeRankingsForDisplay(candidates);
  const averages = marketAverages(deduped.rankings);
  const visible = deduped.rankings.map((row) => rescoreRanking(row, averages));
  dataQuality.trusted_rows_before_display_dedupe = candidates.length;
  dataQuality.collapsed_display_duplicates = deduped.collapsed;
  dataQuality.collapsed_display_duplicate_groups = deduped.groups;
  dataQuality.visible_trusted_rows = visible.length;
  return { rankings: visible, data_quality: dataQuality };
}

function applyOpenHouseMatchToRanking(ranking, openHouseRows, averages) {
  const match = matchOpenHousesForRanking(ranking, openHouseRows);
  const matched = {
    ...ranking,
    ...(match.location || {}),
    open_house_count: Math.max(Number(ranking.open_house_count || 0), Number(match.open_house_count || 0)),
    matched_open_house_count: Number(match.matched_open_house_count || 0),
    matched_weekend_open_house_count: Number(match.matched_weekend_open_house_count || 0),
    matched_active_listing_count: Number(match.matched_active_listing_count || 0),
    matched_open_house_ids: match.matched_open_house_ids || [],
    last_matched_open_house_at: match.last_matched_open_house_at || null,
    has_open_house_this_weekend: Boolean(ranking.has_open_house_this_weekend || match.has_open_house_this_weekend),
    last_activity_at: match.last_activity_at || ranking.last_activity_at || null,
    raw_sources: {
      ...(ranking.raw_sources || {}),
      open_house_match_confidence: Number(match.match_confidence || 0),
      open_house_match_refreshed_at: new Date().toISOString()
    }
  };
  return rescoreRanking(matched, averages);
}

function summarizeRankings(rankings) {
  const totalVolume = rankings.reduce((sum, row) => sum + Number(row.production_volume || 0), 0);
  const totalActiveListings = rankings.reduce((sum, row) => sum + Number(row.active_listing_count || 0), 0);
  const totalListingSide12 = rankings.reduce((sum, row) => sum + Number(row.listings_active_last_12_months || 0), 0);
  const totalBuySide90 = rankings.reduce((sum, row) => sum + Number(row.buyside_last_90_days || 0), 0);
  const totalBuySide12 = rankings.reduce((sum, row) => sum + Number(row.buyside_last_12_months || 0), 0);
  const matchedOpenHouseTotal = rankings.reduce((sum, row) => sum + Number(row.matched_open_house_count || 0), 0);
  const matchedWeekendTotal = rankings.reduce((sum, row) => sum + Number(row.matched_weekend_open_house_count || 0), 0);
  const daysValues = rankings
    .map((row) => Number(row.listings_days_since_last || 0))
    .filter((value) => Number.isFinite(value) && value > 0);
  const missingCapture = rankings.filter((row) => Number(row.opportunity_gap_score || 0) >= 55).length;
  return {
    total_agents_analyzed: rankings.length,
    a_plus_agents: rankings.filter((row) => row.recommended_tier === 'A+').length,
    a_tier_agents: rankings.filter((row) => row.recommended_tier === 'A').length,
    total_production_volume_imported: totalVolume,
    total_active_listings: totalActiveListings,
    total_listings_active_last_12_months: totalListingSide12,
    total_buyside_last_90_days: totalBuySide90,
    total_buyside_last_12_months: totalBuySide12,
    average_days_since_last_listing: daysValues.length
      ? daysValues.reduce((sum, value) => sum + value, 0) / daysValues.length
      : 0,
    average_agent_production: rankings.length ? totalVolume / rankings.length : 0,
    agents_with_open_houses_this_weekend: rankings.filter((row) => row.has_open_house_this_weekend).length,
    agents_with_matched_open_houses: rankings.filter((row) => Number(row.matched_open_house_count || 0) > 0).length,
    agents_with_weekend_open_houses: rankings.filter((row) => Number(row.matched_weekend_open_house_count || 0) > 0).length,
    matched_open_house_total: matchedOpenHouseTotal,
    matched_weekend_open_house_total: matchedWeekendTotal,
    located_agents: rankings.filter((row) => row.primary_county || row.county || row.city || row.zip).length,
    location_review_needed: rankings.filter((row) => !row.primary_county && !row.county).length,
    agents_missing_buyer_capture_opportunity: missingCapture
  };
}

function parseJsonQuery(req, name) {
  const raw = readQuery(req, name);
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch (_) {
    return {};
  }
}

function plainValue(value) {
  const text = String(value ?? '').trim();
  return text && text !== 'all' ? text : '';
}

function boolValue(value) {
  if (value === true || value === 'true') return true;
  if (value === false || value === 'false') return false;
  return null;
}

function numberValue(value) {
  const text = String(value ?? '').trim();
  if (!text || text === 'all') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function queryOrFilter(req, filters, key, aliases = []) {
  const query = readQuery(req, key);
  if (query !== '') return query;
  if (filters[key] !== undefined) return filters[key];
  for (const alias of aliases) {
    const aliasQuery = readQuery(req, alias);
    if (aliasQuery !== '') return aliasQuery;
    if (filters[alias] !== undefined) return filters[alias];
  }
  return '';
}

function parseRankingFilters(req) {
  const filters = parseJsonQuery(req, 'filters');
  return {
    q: plainValue(queryOrFilter(req, filters, 'q')),
    tier: plainValue(queryOrFilter(req, filters, 'tier')),
    brokerage: plainValue(queryOrFilter(req, filters, 'brokerage')),
    market_area: canonicalMarketArea(plainValue(queryOrFilter(req, filters, 'market_area', ['market']))),
    county: plainValue(queryOrFilter(req, filters, 'county')),
    city: plainValue(queryOrFilter(req, filters, 'city')),
    state: plainValue(queryOrFilter(req, filters, 'state')),
    location_source: plainValue(queryOrFilter(req, filters, 'location_source', ['locationSource'])),
    upload: plainValue(queryOrFilter(req, filters, 'upload', ['upload_id'])),
    period_start: plainValue(queryOrFilter(req, filters, 'period_start', ['periodStart'])),
    period_end: plainValue(queryOrFilter(req, filters, 'period_end', ['periodEnd'])),
    has_location: boolValue(queryOrFilter(req, filters, 'has_location', ['hasLocation'])),
    has_matched_open_house: boolValue(queryOrFilter(req, filters, 'has_matched_open_house', ['matchedOpenHouse'])),
    has_weekend_open_house: boolValue(queryOrFilter(req, filters, 'has_weekend_open_house', ['weekendOpenHouse', 'weekend'])),
    has_phone: boolValue(queryOrFilter(req, filters, 'has_phone', ['phone'])),
    has_email: boolValue(queryOrFilter(req, filters, 'has_email', ['email'])),
    min_location_confidence: numberValue(queryOrFilter(req, filters, 'min_location_confidence', ['minLocationConfidence'])),
    min_open_house_count: numberValue(queryOrFilter(req, filters, 'min_open_house_count', ['minOpenHouseCount'])),
    min_weekend_open_house_count: numberValue(queryOrFilter(req, filters, 'min_weekend_open_house_count', ['minWeekendOpenHouseCount'])),
    production_min: numberValue(queryOrFilter(req, filters, 'production_min', ['productionMin'])),
    production_max: numberValue(queryOrFilter(req, filters, 'production_max', ['productionMax'])),
    active_min: numberValue(queryOrFilter(req, filters, 'active_min', ['activeMin'])),
    active_max: numberValue(queryOrFilter(req, filters, 'active_max', ['activeMax'])),
    days_max: numberValue(queryOrFilter(req, filters, 'days_max', ['daysMax'])),
    buyer_min: numberValue(queryOrFilter(req, filters, 'buyer_min', ['buyerMin', 'buy12Min'])),
    buyer_max: numberValue(queryOrFilter(req, filters, 'buyer_max', ['buyerMax'])),
    listing_min: numberValue(queryOrFilter(req, filters, 'listing_min', ['listingMin', 'listing12Min'])),
    listing_max: numberValue(queryOrFilter(req, filters, 'listing_max', ['listingMax']))
  };
}

function uploadIdForRanking(row) {
  return row?.raw_sources?.upload_id || row?.raw_sources?.source_upload_id || '';
}

function dateKey(value) {
  return String(value || '').slice(0, 10);
}

function overlapsPeriod(row, filters) {
  if (!filters.period_start && !filters.period_end) return true;
  const raw = row?.raw_sources || {};
  const rowStart = dateKey(raw.period_start || raw.source_period_start);
  const rowEnd = dateKey(raw.period_end || raw.source_period_end) || rowStart;
  const start = rowStart || rowEnd;
  const end = rowEnd || rowStart;
  if (!start && !end) return false;
  if (filters.period_start && end < filters.period_start) return false;
  if (filters.period_end && start > filters.period_end) return false;
  return true;
}

function hasLocation(row) {
  return Boolean(row.primary_county || row.county || row.city || row.zip);
}

function textEqual(a, b) {
  return String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();
}

function passesMin(value, min) {
  return min === null || Number(value || 0) >= min;
}

function passesMax(value, max) {
  return max === null || Number(value || 0) <= max;
}

function applyRankingFilters(rankings, filters) {
  return (rankings || []).filter((row) => {
    const haystack = [
      row.agent_name,
      row.brokerage,
      row.market_area,
      row.primary_county,
      row.county,
      row.city,
      row.state,
      row.email,
      row.phone
    ].join(' ').toLowerCase();
    if (filters.q && !haystack.includes(filters.q.toLowerCase())) return false;
    if (filters.tier && !textEqual(row.recommended_tier, filters.tier)) return false;
    if (filters.brokerage && !textEqual(row.brokerage, filters.brokerage)) return false;
    if (filters.market_area && !textEqual(row.market_area, filters.market_area)) return false;
    if (filters.county && !textEqual(row.primary_county || row.county, filters.county)) return false;
    if (filters.city && !textEqual(row.city, filters.city)) return false;
    if (filters.state && !textEqual(row.state, filters.state)) return false;
    if (filters.location_source && !textEqual(row.location_source, filters.location_source)) return false;
    if (filters.upload && uploadIdForRanking(row) !== filters.upload) return false;
    if (!overlapsPeriod(row, filters)) return false;
    if (filters.has_location !== null && hasLocation(row) !== filters.has_location) return false;
    if (filters.has_matched_open_house !== null && (Number(row.matched_open_house_count || 0) > 0) !== filters.has_matched_open_house) return false;
    if (filters.has_weekend_open_house !== null && (Number(row.matched_weekend_open_house_count || 0) > 0 || Boolean(row.has_open_house_this_weekend)) !== filters.has_weekend_open_house) return false;
    if (filters.has_phone !== null && Boolean(row.has_phone || row.phone_normalized || row.phone) !== filters.has_phone) return false;
    if (filters.has_email !== null && Boolean(row.has_email || row.email) !== filters.has_email) return false;
    if (!passesMin(row.location_confidence, filters.min_location_confidence)) return false;
    if (!passesMin(row.matched_open_house_count, filters.min_open_house_count)) return false;
    if (!passesMin(row.matched_weekend_open_house_count, filters.min_weekend_open_house_count)) return false;
    if (!passesMin(row.production_volume, filters.production_min) || !passesMax(row.production_volume, filters.production_max)) return false;
    if (!passesMin(row.active_listing_count, filters.active_min) || !passesMax(row.active_listing_count, filters.active_max)) return false;
    if (!passesMax(row.listings_days_since_last, filters.days_max)) return false;
    if (!passesMin(row.buyside_last_12_months, filters.buyer_min) || !passesMax(row.buyside_last_12_months, filters.buyer_max)) return false;
    if (!passesMin(row.listings_active_last_12_months, filters.listing_min) || !passesMax(row.listings_active_last_12_months, filters.listing_max)) return false;
    return true;
  });
}

function uniqueSorted(rows, pick) {
  return [...new Set((rows || []).map(pick).filter(Boolean).map(String))]
    .sort((a, b) => a.localeCompare(b));
}

function buildFilterOptions(rankings) {
  return {
    brokerages: uniqueSorted(rankings, (row) => row.brokerage),
    markets: uniqueSorted(rankings, (row) => row.market_area),
    counties: uniqueSorted(rankings, (row) => row.primary_county || row.county),
    cities: uniqueSorted(rankings, (row) => row.city),
    states: uniqueSorted(rankings, (row) => row.state),
    location_sources: uniqueSorted(rankings, (row) => row.location_source),
    tiers: uniqueSorted(rankings, (row) => row.recommended_tier)
  };
}

const SORT_ALIASES = {
  rank: 'agent_rank_score',
  rank_score: 'agent_rank_score',
  agent: 'agent_name',
  company: 'brokerage',
  market: 'market_area',
  county: 'primary_county',
  listing_side_count: 'listings_active_last_12_months',
  buyer_side_count: 'buyside_last_12_months',
  transactions: 'transaction_count',
  active_listings: 'active_listing_count',
  days_since_last: 'listings_days_since_last',
  open_houses: 'matched_open_house_count',
  weekend_open_houses: 'matched_weekend_open_house_count',
  opportunity_gap: 'opportunity_gap_score',
  tier: 'recommended_tier',
  phone: 'phone_normalized',
  last_activity: 'last_activity_at'
};

const SORT_FIELDS = new Set([
  'agent_rank_score',
  'agent_name',
  'brokerage',
  'primary_county',
  'market_area',
  'city',
  'state',
  'production_volume',
  'transaction_count',
  'average_price',
  'active_listing_count',
  'listings_days_since_last',
  'listings_active_last_12_months',
  'buyside_last_90_days',
  'buyside_last_12_months',
  'matched_open_house_count',
  'matched_weekend_open_house_count',
  'matched_active_listing_count',
  'opportunity_gap_score',
  'recommended_tier',
  'phone_normalized',
  'email',
  'location_confidence',
  'location_source',
  'last_activity_at',
  'updated_at',
  'created_at'
]);

const DEFAULT_SORT_CHAIN = ['agent_rank_score', 'active_listing_count', 'listings_active_last_12_months', 'buyside_last_12_months'];

function canonicalSortBy(value) {
  const key = String(value || '').trim();
  const mapped = SORT_ALIASES[key] || key;
  return SORT_FIELDS.has(mapped) ? mapped : '';
}

function sortValue(row, field) {
  if (field === 'primary_county') return row.primary_county || row.county || '';
  if (field === 'last_activity_at' || field === 'updated_at' || field === 'created_at') {
    const date = new Date(row[field] || 0);
    return Number.isFinite(date.getTime()) ? date.getTime() : 0;
  }
  return row[field];
}

function compareValues(a, b) {
  const aNum = Number(a);
  const bNum = Number(b);
  if (Number.isFinite(aNum) && Number.isFinite(bNum)) return aNum - bNum;
  return String(a || '').localeCompare(String(b || ''), undefined, { sensitivity: 'base' });
}

function sortRankings(rankings, sortBy, direction) {
  const requested = canonicalSortBy(sortBy);
  const chain = requested ? [requested, ...DEFAULT_SORT_CHAIN.filter((field) => field !== requested), 'agent_name'] : [...DEFAULT_SORT_CHAIN, 'agent_name'];
  const primaryDirection = String(direction || 'desc').toLowerCase() === 'asc' ? 1 : -1;
  return [...(rankings || [])].sort((left, right) => {
    for (let index = 0; index < chain.length; index += 1) {
      const field = chain[index];
      const result = compareValues(sortValue(left, field), sortValue(right, field));
      if (result !== 0) {
        const directionForField = field === 'agent_name' ? 1 : -1;
        return result * (index === 0 && requested ? primaryDirection : directionForField);
      }
    }
    return 0;
  });
}

async function handlePreview(body) {
  const parsed = await parseAndMatch(body);
  const finalRows = dedupeRowsByIdentityKey(parsed.rows);
  return {
    headers: parsed.headers,
    mapping: parsed.mapping,
    unmapped_columns: parsed.unmapped_columns,
    row_count: parsed.row_count,
    duplicate_count: parsed.duplicate_count,
    valid_count: finalRows.rows.length,
    skipped_missing_phone_name: finalRows.skipped_missing_identity_count,
    duplicates_skipped: finalRows.duplicates_skipped,
    matched_count: parsed.matched_count,
    unmatched_count: parsed.unmatched_count,
    needs_review_count: parsed.needs_review_count,
    preview_rows: parsed.rows.slice(0, 20)
  };
}

async function handleConfirm(body, auth) {
  const parsed = await parseAndMatch(body);
  const finalRows = dedupeRowsByIdentityKey(parsed.rows);
  const metadata = uploadMetadata(body, auth);
  const defaults = locationDefaults(body);
  const upload = one(await supabaseRest('agent_production_uploads', {
    method: 'POST',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify({
      ...metadata,
      row_count: parsed.row_count,
      raw_metadata: {
        mapping: parsed.mapping,
        unmapped_columns: parsed.unmapped_columns,
        duplicate_count: parsed.duplicate_count,
        duplicates_skipped: finalRows.duplicates_skipped,
        skipped_missing_identity_count: finalRows.skipped_missing_identity_count,
        matched_count: parsed.matched_count,
        unmatched_count: parsed.unmatched_count,
        needs_review_count: parsed.needs_review_count,
        location_defaults: defaults
      }
    })
  }));

  const importInsert = await postRowsResilient(
    'agent_production_import_rows',
    finalRows.rows.map((row) => importRowPayload(upload.id, row)),
    { headers: { Prefer: 'return=representation' } },
    200
  );
  const importRows = importInsert.inserted;
  const signals = await loadOpenHouseSignals();
  const avgs = marketAverages(importRows);
  const rankings = importRows.map((row) => {
    const ranking = rankingFromImportRow(row, avgs, signals);
    ranking.identity_key = identityKeyForAgentRanking(ranking) || row.raw?.identity_key || null;
    ranking.raw_sources = {
      ...(ranking.raw_sources || {}),
      upload_id: upload.id,
      source_name: upload.source_name || null,
      source_upload_id: upload.id,
      period_start: upload.period_start || null,
      period_end: upload.period_end || null,
      original_filename: upload.original_filename || null,
      open_house_match_status: 'deferred_to_profile_modal'
    };
    return ranking;
  });
  const upserted = await upsertRankings(rankings);
  const savedRankings = [...upserted.updated, ...upserted.created].sort((a, b) => Number(b.agent_rank_score || 0) - Number(a.agent_rank_score || 0));
  const importSummary = {
    uploaded_rows: parsed.row_count,
    valid_rows: importRows.length,
    skipped_missing_phone_name: finalRows.skipped_missing_identity_count,
    duplicates_skipped: finalRows.duplicates_skipped + Number(upserted.collapsed_duplicates || 0),
    new_rankings_inserted: upserted.created.length,
    existing_rankings_updated: upserted.updated.length,
    failed_rows: importInsert.failed.length + (upserted.failed?.length || 0)
  };

  return {
    upload,
    imported_rows: importRows.length,
    rankings_created: upserted.created.length,
    rankings_updated: upserted.updated.length,
    rankings_collapsed_duplicates: upserted.collapsed_duplicates || 0,
    failed_rows: [...importInsert.failed, ...(upserted.failed || [])],
    import_summary: importSummary,
    summary: summarizeRankings(savedRankings),
    top_rankings: savedRankings.slice(0, 20)
  };
}

async function handleList(req) {
  const filters = parseRankingFilters(req);
  const page = Math.max(1, Number.parseInt(readQuery(req, 'page') || '1', 10) || 1);
  const pageSize = clampLimit(readQuery(req, 'pageSize') || readQuery(req, 'limit') || 50, 50, 250);
  const sortBy = canonicalSortBy(readQuery(req, 'sortBy'));
  const sortDirection = String(readQuery(req, 'sortDirection') || 'desc').toLowerCase() === 'asc' ? 'asc' : 'desc';
  const [rankings, uploads] = await Promise.all([
    supabaseRestAll('agent_rankings?select=*&order=id.asc').catch(() => []),
    supabaseRest('agent_production_uploads?select=*&order=created_at.desc&limit=50').catch(() => [])
  ]);
  const trustedView = trustedRankingView(rankings || [], uploads || []);
  const visibleRankings = trustedView.rankings;
  const filtered = applyRankingFilters(visibleRankings, filters);
  const sorted = sortRankings(filtered, sortBy, sortDirection);
  const start = (page - 1) * pageSize;
  return {
    rankings: sorted.slice(start, start + pageSize),
    uploads,
    summary: summarizeRankings(filtered),
    options: buildFilterOptions(visibleRankings),
    total: filtered.length,
    page,
    page_size: pageSize,
    sort_by: sortBy || '',
    sort_direction: sortDirection,
    filters,
    data_quality: trustedView.data_quality,
    loaded_at: new Date().toISOString()
  };
}

async function findRanking(id) {
  const ranking = one(await supabaseRest(`agent_rankings?id=eq.${enc(id)}&select=*&limit=1`));
  if (!ranking) {
    const error = new Error('Agent ranking not found.');
    error.status = 404;
    throw error;
  }
  return ranking;
}

function rankingPatchPayload(ranking) {
  const { id, created_at, ...payload } = ranking || {};
  return payload;
}

async function refreshAgentRankingOpenHouseMatches(options = {}) {
  const rankingId = String(options.ranking_id || '').trim();
  const agentId = String(options.agent_id || '').trim();
  const uploadId = String(options.upload_id || '').trim();
  let path = 'agent_rankings?select=*&order=id.asc';
  if (rankingId) path = `agent_rankings?id=eq.${enc(rankingId)}&select=*&limit=1`;
  else if (agentId) path = `agent_rankings?agent_id=eq.${enc(agentId)}&select=*&order=id.asc`;

  const rows = rankingId
    ? await supabaseRest(path).catch(() => [])
    : await supabaseRestAll(path).catch(() => []);
  const scoped = uploadId ? (rows || []).filter((row) => uploadIdForRanking(row) === uploadId) : (rows || []);
  const openHouseRows = await loadOpenHouseRows();
  const averages = marketAverages(scoped);
  const updated = [];

  for (const row of scoped) {
    const matched = applyOpenHouseMatchToRanking(row, openHouseRows, averages);
    const patched = one(await supabaseRest(`agent_rankings?id=eq.${enc(row.id)}`, {
      method: 'PATCH',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify(rankingPatchPayload(matched))
    }));
    if (patched) updated.push(patched);
  }

  return {
    updated_count: updated.length,
    rankings: updated.slice(0, 50),
    scoped_count: scoped.length
  };
}

async function handleRefreshMatches(body) {
  return refreshAgentRankingOpenHouseMatches({
    ranking_id: body.ranking_id,
    upload_id: body.upload_id,
    agent_id: body.agent_id
  });
}

async function handleProfileDetails(body) {
  const ranking = await findRanking(body.ranking_id);
  return profileDetailsForRanking(ranking);
}

async function handleFixLocation(body) {
  const ranking = await findRanking(body.ranking_id);
  const inferred = inferCountyFromRow({
    county: body.primary_county || body.county,
    city: body.city,
    state: body.state || ranking.state || 'NY',
    zip: body.zip,
    market_area: body.market_area || ranking.market_area
  }, { applyDefault: false, tryInference: true });
  const primaryCounty = normalizeCounty(body.primary_county || body.county || inferred.primary_county || inferred.county);
  const city = String(body.city || ranking.city || '').trim() || null;
  const state = String(body.state || ranking.state || 'NY').trim().toUpperCase() || 'NY';
  const zip = normalizeZip(body.zip || ranking.zip || '') || null;
  const marketArea = String(body.market_area || ranking.market_area || primaryCounty || '').trim() || null;

  if (!primaryCounty && !city && !zip && !marketArea) {
    const error = new Error('Enter at least one location value before saving.');
    error.status = 400;
    throw error;
  }

  const previousLocationScore = Math.max(0, Number(ranking.location_confidence || 0) / 10);
  const labels = [
    ...new Set([
      ...((ranking.raw_sources?.labels || []).filter((label) => label !== 'Needs Location Review')),
      'Manual Location'
    ])
  ];
  const payload = {
    county: primaryCounty || ranking.county || null,
    primary_county: primaryCounty || ranking.primary_county || null,
    market_area: marketArea,
    city,
    state,
    zip,
    inferred_county: inferred.inferred_county || null,
    location_confidence: 100,
    location_source: 'manual_admin',
    agent_rank_score: Math.round(Number(ranking.agent_rank_score || 0) - previousLocationScore + 10),
    raw_sources: {
      ...(ranking.raw_sources || {}),
      labels,
      needs_location_review: false,
      location_fixed_at: new Date().toISOString(),
      location_fixed_note: String(body.note || '').trim() || null
    }
  };
  payload.identity_key = identityKeyForAgentRanking({ ...ranking, ...payload }) || ranking.identity_key || null;
  const updated = one(await supabaseRest(`agent_rankings?id=eq.${enc(ranking.id)}`, {
    method: 'PATCH',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify(payload)
  }));
  return { ranking: updated || { ...ranking, ...payload } };
}

async function handleAddToOutreach(body) {
  const ranking = await findRanking(body.ranking_id);
  const payload = outreachPayloadFromRanking(ranking);
  const phone = normalizePhone(payload.agent_phone_normalized || payload.agent_phone);
  let existing = null;
  if (phone) {
    existing = one(await supabaseRest(`agent_outreach_queue?source=eq.agent_ranking&agent_phone_normalized=eq.${enc(phone)}&select=id&limit=1`).catch(() => []));
  }
  if (!existing && ranking.email) {
    existing = one(await supabaseRest(`agent_outreach_queue?source=eq.agent_ranking&agent_email=eq.${enc(ranking.email)}&select=id&limit=1`).catch(() => []));
  }
  if (!existing && ranking.agent_name) {
    existing = one(await supabaseRest(`agent_outreach_queue?source=eq.agent_ranking&agent_name=eq.${enc(ranking.agent_name)}&select=id&limit=1`).catch(() => []));
  }

  const queue = existing?.id
    ? one(await supabaseRest(`agent_outreach_queue?id=eq.${enc(existing.id)}`, {
        method: 'PATCH',
        headers: { Prefer: 'return=representation' },
        body: JSON.stringify(payload)
      }))
    : one(await supabaseRest('agent_outreach_queue', {
        method: 'POST',
        headers: { Prefer: 'return=representation' },
        body: JSON.stringify(payload)
      }));

  return { ranking, queue, variants: buildPitchVariants(ranking) };
}

async function handleGeneratePitch(body) {
  const ranking = await findRanking(body.ranking_id);
  return { ranking_id: ranking.id, variants: buildPitchVariants(ranking), recommended_pitch: ranking.recommended_pitch };
}

async function handleNotFit(body) {
  const ranking = await findRanking(body.ranking_id);
  const updated = one(await supabaseRest(`agent_rankings?id=eq.${enc(ranking.id)}`, {
    method: 'PATCH',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify({
      recommended_tier: 'Not a Fit',
      next_best_action: 'Marked as not a fit by admin review.',
      raw_sources: {
        ...(ranking.raw_sources || {}),
        not_fit_at: new Date().toISOString(),
        not_fit_reason: String(body.reason || '').trim() || null
      }
    })
  }));
  return { ranking: updated || ranking };
}

module.exports = async function handler(req, res) {
  try {
    if (req.method !== 'GET' && req.method !== 'POST') {
      res.setHeader('Allow', 'GET, POST');
      sendJson(res, 405, { ok: false, error: 'Method not allowed.' });
      return;
    }

    assertAdminConfig();
    const auth = adminAuthorized(req);
    if (!auth.ok) {
      sendJson(res, 401, { ok: false, error: auth.error });
      return;
    }

    if (req.method === 'GET') {
      const payload = await handleList(req);
      sendJson(res, 200, { ok: true, ...payload });
      return;
    }

    const body = parseBody(req);
    const action = String(body.action || '').trim();
    if (action === 'preview_upload') {
      const result = await handlePreview(body);
      sendJson(res, 200, { ok: true, action, ...result });
      return;
    }
    if (action === 'confirm_import') {
      const result = await handleConfirm(body, auth);
      sendJson(res, 200, { ok: true, action, ...result });
      return;
    }
    if (action === 'refresh_matches') {
      const result = await handleRefreshMatches(body);
      sendJson(res, 200, { ok: true, action, ...result });
      return;
    }
    if (action === 'profile_details') {
      const result = await handleProfileDetails(body);
      sendJson(res, 200, { ok: true, action, ...result });
      return;
    }
    if (action === 'fix_location') {
      const result = await handleFixLocation(body);
      sendJson(res, 200, { ok: true, action, ...result });
      return;
    }
    if (action === 'add_to_outreach') {
      const result = await handleAddToOutreach(body);
      sendJson(res, 200, { ok: true, action, ...result });
      return;
    }
    if (action === 'generate_pitch') {
      const result = await handleGeneratePitch(body);
      sendJson(res, 200, { ok: true, action, ...result });
      return;
    }
    if (action === 'mark_not_fit') {
      const result = await handleNotFit(body);
      sendJson(res, 200, { ok: true, action, ...result });
      return;
    }

    sendJson(res, 400, { ok: false, error: 'Unsupported agent ranking action.' });
  } catch (error) {
    sendJson(res, error.status || 500, {
      ok: false,
      error: error.message || 'Unable to process agent ranking request.',
      details: error.payload || null
    });
  }
};
