import { KEY, SUPABASE_URL } from '../core/config.js';
import { authHeaders, jsonHeaders } from '../core/utils.js';
import { fetchJson } from './http.js';

const milesBetween = (a, b, c, d) => {
  const toRad = (n) => Number(n) * Math.PI / 180;
  const radius = 3958.8;
  const dLat = toRad(c - a);
  const dLng = toRad(d - b);
  const x = Math.sin(dLat / 2) ** 2
    + Math.cos(toRad(a)) * Math.cos(toRad(c)) * Math.sin(dLng / 2) ** 2;
  return 2 * radius * Math.asin(Math.sqrt(x));
};

function nyDateKey(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';

  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(date).reduce((acc, part) => {
    acc[part.type] = part.value;
    return acc;
  }, {});

  return `${parts.year}-${parts.month}-${parts.day}`;
}

function isWeekendNY(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return false;

  const weekday = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    weekday: 'short'
  }).format(date);

  return weekday === 'Sat' || weekday === 'Sun';
}

function distanceMilesFor(row, lat, lng) {
  if (row?.lat != null && row?.lng != null) {
    return milesBetween(lat, lng, row.lat, row.lng);
  }

  const distance = Number(row?.distance);
  if (Number.isFinite(distance)) return distance > 250 ? distance / 1609.344 : distance;
  return 999;
}

function timeScore(row) {
  const start = row?.open_start ? new Date(row.open_start).getTime() : 0;
  const end = row?.open_end ? new Date(row.open_end).getTime() : 0;
  const now = Date.now();
  if (!start) return 999;
  if (end && now >= start - 2 * 60 * 60 * 1000 && now <= end + 6 * 60 * 60 * 1000) return 0;
  if (Math.abs(start - now) <= 18 * 60 * 60 * 1000) return 1;
  return Math.abs(start - now) / (60 * 60 * 1000);
}

function dayScore(row) {
  const start = row?.open_start ? new Date(row.open_start) : null;
  const end = row?.open_end ? new Date(row.open_end) : null;
  const now = new Date();
  if (!start) return 9;

  if (end && now >= new Date(start.getTime() - 2 * 60 * 60 * 1000)
    && now <= new Date(end.getTime() + 6 * 60 * 60 * 1000)) {
    return 0;
  }

  if (nyDateKey(start) === nyDateKey(now)) return 1;
  if (start > now) return 2;
  return 4;
}

function sortNearbyOpenHouses(rows, lat, lng) {
  return (Array.isArray(rows) ? rows : [])
    .map((row) => ({
      ...row,
      _distance: distanceMilesFor(row, lat, lng),
      _dayScore: dayScore(row),
      _timeScore: timeScore(row)
    }))
    .filter((row) => row._dayScore < 4)
    .sort((a, b) => (
      (a._distance - b._distance)
      || (a._dayScore - b._dayScore)
      || (a._timeScore - b._timeScore)
    ));
}

function normalizeSearchText(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function searchTokens(value) {
  return normalizeSearchText(value)
    .split(' ')
    .filter((token) => token.length > 1);
}

function rowSearchText(row = {}) {
  return normalizeSearchText([
    row.address,
    row.city,
    row.state,
    row.zip,
    row.agent,
    row.agent_name,
    row.brokerage
  ].filter(Boolean).join(' '));
}

function rowMatchesTokens(row, tokens) {
  if (!tokens.length) return false;
  const target = rowSearchText(row);
  return tokens.every((token) => target.includes(token));
}

function sortSearchResults(rows, tokens) {
  const query = tokens.join(' ');
  return [...rows].sort((a, b) => {
    const aText = rowSearchText(a);
    const bText = rowSearchText(b);
    const aExact = aText.includes(query) ? 0 : 1;
    const bExact = bText.includes(query) ? 0 : 1;
    const aTime = a.open_start ? new Date(a.open_start).getTime() : 0;
    const bTime = b.open_start ? new Date(b.open_start).getTime() : 0;
    return (aExact - bExact) || (bTime - aTime);
  });
}

function mergeRows(...groups) {
  const seen = new Set();
  return groups.flat().filter((row) => {
    const key = String(row?.id || row?.open_house_id || row?.address || '').toLowerCase();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function openHouseFromOutreach(row = {}) {
  return {
    id: row.open_house_id || '',
    address: row.address || '',
    city: row.city || '',
    state: row.state || '',
    zip: row.zip || '',
    open_start: row.open_start || '',
    open_end: row.open_end || '',
    price: row.price || '',
    beds: row.beds || '',
    baths: row.baths || '',
    brokerage: row.brokerage || '',
    listing_photo_url: row.listing_photo_url || '',
    image_url: row.listing_photo_url || '',
    agent: row.agent_name || '',
    agent_name: row.agent_name || '',
    agent_phone: row.agent_phone || '',
    agent_email: row.agent_email || '',
    outreach_queue_id: row.id || '',
    outreach_code: row.outreach_code || '',
    source: row.source || 'agent_outreach_queue'
  };
}

async function getLocalOpenHouseFallback(lat, lng) {
  const now = new Date();
  const from = new Date(now.getTime() - 12 * 60 * 60 * 1000).toISOString();
  const to = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString();
  const radius = isWeekendNY(now) ? 30 : 45;
  const rows = await fetchJson(
    `${SUPABASE_URL}/rest/v1/open_houses?open_start=gte.${encodeURIComponent(from)}&open_start=lte.${encodeURIComponent(to)}&select=*&order=open_start.asc&limit=300`,
    { headers: authHeaders(KEY) }
  );

  return sortNearbyOpenHouses(rows, lat, lng)
    .filter((row) => row._distance <= radius)
    .slice(0, 20);
}

async function getFocusedOpenHouseFallback(lat, lng) {
  const now = new Date();
  const from = new Date(now.getTime() - 12 * 60 * 60 * 1000).toISOString();
  const to = new Date(now.getTime() + 18 * 60 * 60 * 1000).toISOString();
  const radius = isWeekendNY(now) ? 3 : 5;
  const latDelta = radius / 69;
  const lngDelta = radius / Math.max(1, 69 * Math.cos(Number(lat) * Math.PI / 180));
  const minLat = Number(lat) - latDelta;
  const maxLat = Number(lat) + latDelta;
  const minLng = Number(lng) - lngDelta;
  const maxLng = Number(lng) + lngDelta;

  const rows = await fetchJson(
    `${SUPABASE_URL}/rest/v1/open_houses?open_start=gte.${encodeURIComponent(from)}&open_start=lte.${encodeURIComponent(to)}&lat=gte.${encodeURIComponent(minLat)}&lat=lte.${encodeURIComponent(maxLat)}&lng=gte.${encodeURIComponent(minLng)}&lng=lte.${encodeURIComponent(maxLng)}&select=*&order=open_start.asc&limit=500`,
    { headers: authHeaders(KEY) }
  );

  return sortNearbyOpenHouses(rows, lat, lng)
    .filter((row) => row._distance <= radius)
    .slice(0, 50);
}

export async function findNearestOpenHouses(lat, lng) {
  const rows = await fetchJson(`${SUPABASE_URL}/rest/v1/rpc/find_nearest_open_house`, {
    method: 'POST',
    headers: jsonHeaders(KEY),
    body: JSON.stringify({ user_lat: lat, user_lng: lng })
  }).catch(() => []);

  const focusedRows = await getFocusedOpenHouseFallback(lat, lng).catch(() => []);
  const fallbackRows = await getLocalOpenHouseFallback(lat, lng).catch(() => []);
  const seen = new Set();
  const merged = [
    ...(Array.isArray(rows) ? rows : []),
    ...(Array.isArray(focusedRows) ? focusedRows : []),
    ...(Array.isArray(fallbackRows) ? fallbackRows : [])
  ]
    .filter((row) => {
      if (!row?.id || seen.has(String(row.id))) return false;
      seen.add(String(row.id));
      return true;
    });

  return sortNearbyOpenHouses(merged, lat, lng).slice(0, 20);
}

export async function getOpenHouseById(openHouseId) {
  if (!openHouseId) return null;
  const rows = await fetchJson(
    `${SUPABASE_URL}/rest/v1/open_houses?id=eq.${encodeURIComponent(openHouseId)}&select=*`,
    { headers: authHeaders(KEY) }
  );
  return Array.isArray(rows) && rows.length ? rows[0] : null;
}

export async function searchOpenHouses(term) {
  const query = String(term || '').trim();
  if (!query) return [];

  const clean = query.replace(/[%*(),]/g, ' ').replace(/\s+/g, ' ').trim();
  const headers = { headers: authHeaders(KEY) };
  const tokens = searchTokens(clean);
  const driverToken = tokens.find((token) => /^\d/.test(token))
    || tokens.find((token) => token.length >= 4)
    || tokens[0]
    || clean;
  const matches = [];

  if (clean) {
    const exactRows = await fetchJson(
      `${SUPABASE_URL}/rest/v1/open_houses?address=ilike.${encodeURIComponent(`*${clean}*`)}&select=*&order=open_start.desc&limit=10`,
      headers
    ).catch(() => []);
    matches.push(...(Array.isArray(exactRows) ? exactRows : []));
  }

  if (driverToken) {
    const candidateRows = await fetchJson(
      `${SUPABASE_URL}/rest/v1/open_houses?address=ilike.${encodeURIComponent(`*${driverToken}*`)}&select=*&order=open_start.desc&limit=50`,
      headers
    ).catch(() => []);
    matches.push(...(Array.isArray(candidateRows) ? candidateRows.filter((row) => rowMatchesTokens(row, tokens)) : []));

    const outreachRows = await fetchJson(
      `${SUPABASE_URL}/rest/v1/agent_outreach_queue?address=ilike.${encodeURIComponent(`*${driverToken}*`)}&select=id,open_house_id,address,city,state,zip,open_start,open_end,price,beds,baths,listing_photo_url,source,agent_name,agent_phone,agent_email,brokerage,outreach_code&order=open_start.desc&limit=50`,
      headers
    ).catch(() => []);
    matches.push(...(Array.isArray(outreachRows)
      ? outreachRows.map(openHouseFromOutreach).filter((row) => rowMatchesTokens(row, tokens))
      : []));
  }

  if (/^[A-Za-z0-9_.:-]+$/.test(query)) {
    const rows = await fetchJson(
      `${SUPABASE_URL}/rest/v1/open_houses?id=eq.${encodeURIComponent(query)}&select=*&limit=10`,
      headers
    );
    if (Array.isArray(rows)) matches.push(...rows);
  }

  return sortSearchResults(mergeRows(matches), tokens).slice(0, 10);
}
