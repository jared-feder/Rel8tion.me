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
