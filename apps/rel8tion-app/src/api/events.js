import { KEY, SUPABASE_URL } from '../core/config.js';
import { authHeaders, jsonHeaders } from '../core/utils.js';
import { fetchJson } from './http.js';

export async function getEventById(eventId) {
  if (!eventId) return null;
  const rows = await fetchJson(
    `${SUPABASE_URL}/rest/v1/open_house_events?id=eq.${encodeURIComponent(eventId)}&select=*`,
    { headers: authHeaders(KEY) }
  );
  return Array.isArray(rows) && rows.length ? rows[0] : null;
}

export async function touchEvent(eventId) {
  if (!eventId) return null;
  const res = await fetch(`${SUPABASE_URL}/rest/v1/open_house_events?id=eq.${encodeURIComponent(eventId)}`, {
    method: 'PATCH',
    headers: { ...jsonHeaders(KEY), Prefer: 'return=representation' },
    body: JSON.stringify({ last_activity_at: new Date().toISOString() })
  });

  const raw = await res.text().catch(() => '');
  if (!res.ok) throw new Error('Failed to update event: ' + raw);

  let updated = null;
  try { updated = raw ? JSON.parse(raw) : null; } catch {}
  return Array.isArray(updated) && updated.length ? updated[0] : null;
}

export async function createCheckin(payload) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/event_checkins`, {
    method: 'POST',
    headers: { ...jsonHeaders(KEY), Prefer: 'return=representation' },
    body: JSON.stringify(payload)
  });

  const raw = await res.text().catch(() => '');
  if (!res.ok) throw new Error('Failed to save check-in: ' + raw);

  let created = null;
  try { created = raw ? JSON.parse(raw) : null; } catch {}
  return Array.isArray(created) && created.length ? created[0] : null;
}
