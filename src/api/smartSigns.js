import { KEY, SUPABASE_URL } from '../core/config.js';
import { authHeaders, jsonHeaders } from '../core/utils.js';
import { fetchJson } from './http.js';

export async function getSmartSignByUid(uid) {
  if (!uid) return null;

  const primary = await fetchJson(
    `${SUPABASE_URL}/rest/v1/smart_signs?uid_primary=eq.${encodeURIComponent(uid)}&select=*`,
    { headers: authHeaders(KEY) }
  );
  if (Array.isArray(primary) && primary.length) return primary[0];

  const secondary = await fetchJson(
    `${SUPABASE_URL}/rest/v1/smart_signs?uid_secondary=eq.${encodeURIComponent(uid)}&select=*`,
    { headers: authHeaders(KEY) }
  );
  return Array.isArray(secondary) && secondary.length ? secondary[0] : null;
}

export async function createSmartSign(payload) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/smart_signs`, {
    method: 'POST',
    headers: { ...jsonHeaders(KEY), Prefer: 'return=representation' },
    body: JSON.stringify(payload)
  });

  const raw = await res.text().catch(() => '');
  if (!res.ok) throw new Error('Failed to create smart sign: ' + raw);

  let created = null;
  try { created = raw ? JSON.parse(raw) : null; } catch (e) {}
  return Array.isArray(created) && created.length ? created[0] : null;
}

export async function updateSmartSign(signId, patch) {
  if (!signId) throw new Error('Missing smart sign id');

  const res = await fetch(`${SUPABASE_URL}/rest/v1/smart_signs?id=eq.${encodeURIComponent(signId)}`, {
    method: 'PATCH',
    headers: { ...jsonHeaders(KEY), Prefer: 'return=representation' },
    body: JSON.stringify(patch)
  });

  const raw = await res.text().catch(() => '');
  if (!res.ok) throw new Error('Failed to update smart sign: ' + raw);

  let updated = null;
  try { updated = raw ? JSON.parse(raw) : null; } catch (e) {}
  return Array.isArray(updated) && updated.length ? updated[0] : null;
}

export async function getActiveSmartSignEvent(signId) {
  if (!signId) return null;
  const rows = await fetchJson(
    `${SUPABASE_URL}/rest/v1/open_house_events?smart_sign_id=eq.${encodeURIComponent(signId)}&ended_at=is.null&select=*&order=created_at.desc&limit=1`,
    { headers: authHeaders(KEY) }
  );
  return Array.isArray(rows) && rows.length ? rows[0] : null;
}
