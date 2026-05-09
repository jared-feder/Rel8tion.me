import { KEY, SUPABASE_URL } from '../core/config.js';
import { authHeaders, jsonHeaders } from '../core/utils.js';
import { fetchJson } from './http.js';

export async function findNearestOpenHouses(lat, lng) {
  return fetchJson(`${SUPABASE_URL}/rest/v1/rpc/find_nearest_open_house`, {
    method: 'POST',
    headers: jsonHeaders(KEY),
    body: JSON.stringify({ user_lat: lat, user_lng: lng })
  });
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

  if (clean) {
    const rows = await fetchJson(
      `${SUPABASE_URL}/rest/v1/open_houses?address=ilike.${encodeURIComponent(`*${clean}*`)}&select=*&order=open_start.desc&limit=10`,
      headers
    );
    if (Array.isArray(rows) && rows.length) return rows;
  }

  if (/^[A-Za-z0-9_.:-]+$/.test(query)) {
    const rows = await fetchJson(
      `${SUPABASE_URL}/rest/v1/open_houses?id=eq.${encodeURIComponent(query)}&select=*&limit=10`,
      headers
    );
    if (Array.isArray(rows)) return rows;
  }

  return [];
}
