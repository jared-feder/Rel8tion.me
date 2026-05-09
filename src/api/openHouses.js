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

export async function findNearestOpenHouses(lat, lng) {
  const rows = await fetchJson(`${SUPABASE_URL}/rest/v1/rpc/find_nearest_open_house`, {
    method: 'POST',
    headers: jsonHeaders(KEY),
    body: JSON.stringify({ user_lat: lat, user_lng: lng })
  }).catch(() => []);

  const fallbackRows = await getLocalOpenHouseFallback(lat, lng).catch(() => []);
  const seen = new Set();
  const merged = [...(Array.isArray(rows) ? rows : []), ...(Array.isArray(fallbackRows) ? fallbackRows : [])]
    .filter((row) => {
      if (!row?.id || seen.has(String(row.id))) return false;
      seen.add(String(row.id));
      return true;
    });

  return sortNearbyOpenHouses(merged, lat, lng).slice(0, 20);
}
