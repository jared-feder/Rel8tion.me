import { KEY, SUPABASE_URL } from '../core/config.js';
import { authHeaders, jsonHeaders } from '../core/utils.js';
import { fetchJson } from './http.js';

export async function getActiveEventBySmartSignId(signId) {
  if (!signId) return null;
  const rows = await fetchJson(
    `${SUPABASE_URL}/rest/v1/open_house_events?smart_sign_id=eq.${encodeURIComponent(signId)}&ended_at=is.null&select=*&order=created_at.desc&limit=1`,
    { headers: authHeaders(KEY) }
  );
  return Array.isArray(rows) && rows.length ? rows[0] : null;
}

export async function getRecentEventByHostAgentSlug(hostAgentSlug, daysBack = 2) {
  if (!hostAgentSlug) return null;
  const since = new Date(Date.now() - daysBack * 24 * 60 * 60 * 1000).toISOString();
  const rows = await fetchJson(
    `${SUPABASE_URL}/rest/v1/open_house_events?host_agent_slug=eq.${encodeURIComponent(hostAgentSlug)}&created_at=gte.${encodeURIComponent(since)}&select=*&order=created_at.desc&limit=1`,
    { headers: authHeaders(KEY) }
  );
  return Array.isArray(rows) && rows.length ? rows[0] : null;
}

export async function createOpenHouseEvent(payload) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/open_house_events`, {
    method: 'POST',
    headers: { ...jsonHeaders(KEY), Prefer: 'return=representation' },
    body: JSON.stringify(payload)
  });

  const raw = await res.text().catch(() => '');
  if (!res.ok) throw new Error('Failed to create event: ' + raw);

  let created = null;
  try { created = raw ? JSON.parse(raw) : null; } catch (e) {}
  return Array.isArray(created) && created.length ? created[0] : null;
}

export async function updateOpenHouseEvent(eventId, patch) {
  if (!eventId) throw new Error('Missing event id');
  const res = await fetch(`${SUPABASE_URL}/rest/v1/open_house_events?id=eq.${encodeURIComponent(eventId)}`, {
    method: 'PATCH',
    headers: { ...jsonHeaders(KEY), Prefer: 'return=representation' },
    body: JSON.stringify(patch)
  });

  const raw = await res.text().catch(() => '');
  if (!res.ok) throw new Error('Failed to update event: ' + raw);

  let updated = null;
  try { updated = raw ? JSON.parse(raw) : null; } catch (e) {}
  return Array.isArray(updated) && updated.length ? updated[0] : null;
}
