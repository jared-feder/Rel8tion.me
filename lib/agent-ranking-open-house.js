const { inferCountyFromRow, mergeBestLocation, normalizeCounty } = require('./location-intelligence');
const { normalizeEmail, normalizeName, normalizePhone, tokenSimilarity } = require('./agent-ranking');

function cleanText(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function lower(value) {
  return cleanText(value).toLowerCase();
}

function nyParts(date) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    weekday: 'short',
    hour: 'numeric',
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(date);
  return Object.fromEntries(parts.filter((part) => part.type !== 'literal').map((part) => [part.type, part.value]));
}

function isWeekendOpenHouse(value, now = new Date()) {
  if (!value) return false;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return false;
  if (date < now) return false;
  const parts = nyParts(date);
  const weekday = parts.weekday;
  const hour = Number(parts.hour || 0);
  const daysAhead = Math.ceil((date.getTime() - now.getTime()) / 86400000);
  if (daysAhead > 7) return false;
  return weekday === 'Sat' || weekday === 'Sun' || (weekday === 'Fri' && hour >= 12);
}

function latestDate(values) {
  let latest = null;
  for (const value of values || []) {
    if (!value) continue;
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) continue;
    if (!latest || date > latest) latest = date;
  }
  return latest ? latest.toISOString() : null;
}

function openHouseLocation(row) {
  const inferred = inferCountyFromRow({
    county: row.county,
    primary_county: row.primary_county,
    city: row.city || row.office_city,
    state: row.state || row.office_state_or_province || 'NY',
    zip: row.zip,
    address: row.address || row.location,
    market_area: row.market_area || row.area || row.region || row.location
  }, { applyDefault: false, tryInference: true });
  if (inferred.primary_county) {
    return {
      ...inferred,
      location_source: 'open_house_match',
      location_confidence: Math.max(80, Number(inferred.location_confidence || 0))
    };
  }
  return inferred;
}

function buildOpenHouseRows(openHouses = [], listingAgents = []) {
  const agentsByOpenHouse = new Map();
  for (const agent of listingAgents || []) {
    const key = cleanText(agent.open_house_id);
    if (!key) continue;
    if (!agentsByOpenHouse.has(key)) agentsByOpenHouse.set(key, []);
    agentsByOpenHouse.get(key).push(agent);
  }

  return (openHouses || []).map((openHouse) => {
    const agents = agentsByOpenHouse.get(cleanText(openHouse.id)) || [];
    const names = [openHouse.agent, ...agents.map((agent) => agent.name)].filter(Boolean);
    const brokerages = [openHouse.brokerage, ...agents.map((agent) => agent.brokerage)].filter(Boolean);
    const phones = [openHouse.agent_phone, ...agents.map((agent) => agent.phone || agent.phone_normalized)].map(normalizePhone).filter(Boolean);
    const emails = [openHouse.agent_email, ...agents.map((agent) => agent.email)].map(normalizeEmail).filter(Boolean);
    const activeListingCount = Math.max(0, ...agents.map((agent) => Number(agent.active_listing_count || 0)), Number(openHouse.active_listing_count || 0));
    const location = openHouseLocation({
      ...openHouse,
      city: agents.find((agent) => agent.office_city)?.office_city,
      state: agents.find((agent) => agent.office_state_or_province)?.office_state_or_province
    });
    return {
      id: cleanText(openHouse.id),
      address: openHouse.address || openHouse.location || '',
      names,
      brokerages,
      phones: [...new Set(phones)],
      emails: [...new Set(emails)],
      normalizedNames: names.map(normalizeName).filter(Boolean),
      normalizedBrokerages: brokerages.map(normalizeName).filter(Boolean),
      open_start: openHouse.open_start || null,
      open_end: openHouse.open_end || null,
      updated_at: openHouse.updated_at || openHouse.created_at || null,
      location,
      active_listing_count: activeListingCount,
      agents
    };
  }).filter((row) => row.id);
}

function sameLocation(a = {}, b = {}) {
  const countyA = normalizeCounty(a.primary_county || a.county);
  const countyB = normalizeCounty(b.primary_county || b.county);
  if (countyA && countyB && countyA === countyB) return true;
  const marketA = lower(a.market_area);
  const marketB = lower(b.market_area);
  if (marketA && marketB && (marketA.includes(marketB) || marketB.includes(marketA))) return true;
  const cityA = lower(a.city);
  const cityB = lower(b.city);
  return Boolean(cityA && cityB && cityA === cityB);
}

function bestNameScore(ranking, openHouse) {
  const agentName = normalizeName(ranking.agent_name);
  if (!agentName) return 0;
  return Math.max(0, ...openHouse.normalizedNames.map((name) => tokenSimilarity(agentName, name)));
}

function bestBrokerageScore(ranking, openHouse) {
  const brokerage = normalizeName(ranking.brokerage);
  if (!brokerage) return 0;
  return Math.max(0, ...openHouse.normalizedBrokerages.map((name) => tokenSimilarity(brokerage, name)));
}

function matchScore(ranking, openHouse) {
  const phone = normalizePhone(ranking.phone_normalized || ranking.phone);
  if (phone && openHouse.phones.includes(phone)) return 100;

  const email = normalizeEmail(ranking.email);
  if (email && openHouse.emails.includes(email)) return 95;

  const nameScore = bestNameScore(ranking, openHouse);
  const brokerageScore = bestBrokerageScore(ranking, openHouse);
  if (nameScore >= 0.76 && brokerageScore >= 0.35) return Math.round(70 + (nameScore * 20) + (brokerageScore * 10));
  if (nameScore >= 0.76 && sameLocation(ranking, openHouse.location)) return Math.round(62 + (nameScore * 20));
  if (nameScore >= 0.66 && sameLocation(ranking, openHouse.location)) return Math.round(52 + (nameScore * 20));
  return 0;
}

function matchOpenHousesForRanking(ranking, openHouseRows = []) {
  const matches = [];
  for (const openHouse of openHouseRows || []) {
    const score = matchScore(ranking, openHouse);
    if (score >= 65) matches.push({ openHouse, score });
  }

  const ids = [...new Set(matches.map((match) => match.openHouse.id))];
  const weekendCount = matches.filter((match) => isWeekendOpenHouse(match.openHouse.open_start)).length;
  const activeListingCount = matches.reduce((sum, match) => sum + Number(match.openHouse.active_listing_count || 0), 0);
  let location = {
    county: ranking.county || '',
    primary_county: ranking.primary_county || '',
    market_area: ranking.market_area || '',
    city: ranking.city || '',
    state: ranking.state || '',
    zip: ranking.zip || '',
    inferred_county: ranking.inferred_county || '',
    location_confidence: Number(ranking.location_confidence || 0),
    location_source: ranking.location_source || 'missing'
  };

  for (const match of matches) {
    location = mergeBestLocation(location, match.openHouse.location);
  }

  return {
    matched_open_house_count: ids.length,
    matched_weekend_open_house_count: weekendCount,
    matched_active_listing_count: activeListingCount || ids.length,
    matched_open_house_ids: ids.slice(0, 50),
    last_matched_open_house_at: latestDate(matches.map((match) => match.openHouse.open_start || match.openHouse.updated_at)),
    has_open_house_this_weekend: weekendCount > 0,
    open_house_count: ids.length,
    last_activity_at: latestDate(matches.map((match) => match.openHouse.open_start || match.openHouse.updated_at)),
    match_confidence: matches.length ? Math.max(...matches.map((match) => match.score)) : Number(ranking.raw_sources?.match_confidence || 0),
    location
  };
}

module.exports = {
  buildOpenHouseRows,
  isWeekendOpenHouse,
  matchOpenHousesForRanking
};
