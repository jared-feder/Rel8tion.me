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

export async function closeEvent(eventId) {
  if (!eventId) return null;
  const res = await fetch(`${SUPABASE_URL}/rest/v1/open_house_events?id=eq.${encodeURIComponent(eventId)}`, {
    method: 'PATCH',
    headers: { ...jsonHeaders(KEY), Prefer: 'return=representation' },
    body: JSON.stringify({
      ended_at: new Date().toISOString(),
      last_activity_at: new Date().toISOString()
    })
  });

  const raw = await res.text().catch(() => '');
  if (!res.ok) throw new Error('Failed to close event: ' + raw);

  let updated = null;
  try { updated = raw ? JSON.parse(raw) : null; } catch {}
  return Array.isArray(updated) && updated.length ? updated[0] : null;
}

export async function createOpenHouseEvent(payload) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/open_house_events`, {
    method: 'POST',
    headers: { ...jsonHeaders(KEY), Prefer: 'return=representation' },
    body: JSON.stringify(payload)
  });

  const raw = await res.text().catch(() => '');
  if (!res.ok) throw new Error('Failed to create open house event: ' + raw);

  let created = null;
  try { created = raw ? JSON.parse(raw) : null; } catch {}
  return Array.isArray(created) && created.length ? created[0] : null;
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

export function resolveEventLifecycle({ activeEvent, request, now = new Date() }) {
  if (!activeEvent) {
    return { action: 'create_new', reason: 'no_active_event' };
  }

  const sameSign = activeEvent.smart_sign_id && request.smart_sign_id
    && activeEvent.smart_sign_id === request.smart_sign_id;
  if (!sameSign) {
    return { action: 'create_new', reason: 'different_sign' };
  }

  const sameHost = activeEvent.agent_slug && request.agent_slug
    && activeEvent.agent_slug === request.agent_slug;
  const sameProperty = activeEvent.open_house_source_id && request.open_house_source_id
    && activeEvent.open_house_source_id === request.open_house_source_id;

  const eventDate = new Date(activeEvent.created_at || now);
  const nowDate = new Date(now);
  const sameDay = eventDate.getUTCFullYear() === nowDate.getUTCFullYear()
    && eventDate.getUTCMonth() === nowDate.getUTCMonth()
    && eventDate.getUTCDate() === nowDate.getUTCDate();

  if (sameHost && sameProperty && sameDay) {
    return { action: 'resume', reason: 'same_sign_host_property_day' };
  }

  if (!sameProperty) {
    return { action: 'close_and_create_new', reason: 'property_changed' };
  }

  return { action: 'prompt_resume_or_new', reason: 'active_event_exists' };
}
