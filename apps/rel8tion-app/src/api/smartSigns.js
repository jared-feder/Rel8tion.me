import { KEY, SUPABASE_URL } from '../core/config.js';
import { authHeaders } from '../core/utils.js';
import { fetchJson } from './http.js';

export async function getSmartSignByPublicCode(publicCode) {
  if (!publicCode) return null;
  const rows = await fetchJson(
    `${SUPABASE_URL}/rest/v1/smart_signs?public_code=eq.${encodeURIComponent(publicCode)}&select=*`,
    { headers: authHeaders(KEY) }
  );
  return Array.isArray(rows) && rows.length ? rows[0] : null;
}

export async function getActiveSmartSignEvent(signId) {
  if (!signId) return null;
  const rows = await fetchJson(
    `${SUPABASE_URL}/rest/v1/open_house_events?smart_sign_id=eq.${encodeURIComponent(signId)}&ended_at=is.null&select=*&order=created_at.desc&limit=1`,
    { headers: authHeaders(KEY) }
  );
  return Array.isArray(rows) && rows.length ? rows[0] : null;
}
