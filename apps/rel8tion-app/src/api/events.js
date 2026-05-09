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
      status: 'ended',
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

export async function updateCheckinMetadata(checkinId, metadata) {
  if (!checkinId) return null;
  const res = await fetch(`${SUPABASE_URL}/rest/v1/event_checkins?id=eq.${encodeURIComponent(checkinId)}`, {
    method: 'PATCH',
    headers: { ...jsonHeaders(KEY), Prefer: 'return=representation' },
    body: JSON.stringify({ metadata })
  });

  const raw = await res.text().catch(() => '');
  if (!res.ok) throw new Error('Failed to update check-in preference: ' + raw);

  let updated = null;
  try { updated = raw ? JSON.parse(raw) : null; } catch {}
  return Array.isArray(updated) && updated.length ? updated[0] : null;
}

export function getDisclosurePreviewUrl(eventId) {
  if (!eventId) return '';
  return `/api/compliance/ny-disclosure?event=${encodeURIComponent(eventId)}`;
}

export function getSignedDisclosurePdfUrl(checkinId) {
  if (!checkinId) return '';
  return `/api/compliance/ny-disclosure?checkin=${encodeURIComponent(checkinId)}&download=1`;
}

export async function generateSignedDisclosurePdf(checkinId) {
  if (!checkinId) return null;
  const res = await fetch('/api/compliance/ny-disclosure', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ checkin_id: checkinId })
  });

  const raw = await res.text().catch(() => '');
  let payload = null;
  try { payload = raw ? JSON.parse(raw) : null; } catch {}
  if (!res.ok) throw new Error(payload?.error || raw || 'Failed to generate signed NYS disclosure PDF.');
  return payload;
}

export async function getLiveLoanOfficerSession(eventId) {
  if (!eventId) return null;
  const rows = await fetchJson(
    `${SUPABASE_URL}/rest/v1/event_loan_officer_sessions?open_house_event_id=eq.${encodeURIComponent(eventId)}&status=eq.live&select=*&order=signed_in_at.desc&limit=1`,
    { headers: authHeaders(KEY) }
  );
  return Array.isArray(rows) && rows.length ? rows[0] : null;
}

export async function upsertLiveLoanOfficerSession(eventId, profile, uid) {
  if (!eventId || !profile?.uid) return null;

  const existing = await getLiveLoanOfficerSession(eventId);
  if (existing?.id) {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/event_loan_officer_sessions?id=eq.${encodeURIComponent(existing.id)}`, {
      method: 'PATCH',
      headers: { ...jsonHeaders(KEY), Prefer: 'return=representation' },
      body: JSON.stringify({
        verified_profile_uid: profile.uid,
        loan_officer_uid: uid || profile.uid,
        loan_officer_slug: profile.slug || '',
        loan_officer_name: profile.full_name || '',
        loan_officer_title: profile.title || '',
        loan_officer_company: profile.company_name || '',
        loan_officer_phone: profile.phone || '',
        loan_officer_email: profile.email || '',
        loan_officer_photo_url: profile.photo_url || '',
        loan_officer_cta_url: profile.cta_url || '',
        loan_officer_calendar_url: profile.calendar_url || '',
        status: 'live',
        signed_out_at: null,
        last_seen_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      })
    });

    const raw = await res.text().catch(() => '');
    if (!res.ok) throw new Error('Failed to update loan officer session: ' + raw);
    const updated = raw ? JSON.parse(raw) : null;
    return Array.isArray(updated) && updated.length ? updated[0] : null;
  }

  const res = await fetch(`${SUPABASE_URL}/rest/v1/event_loan_officer_sessions`, {
    method: 'POST',
    headers: { ...jsonHeaders(KEY), Prefer: 'return=representation' },
    body: JSON.stringify({
      open_house_event_id: eventId,
      verified_profile_uid: profile.uid,
      loan_officer_uid: uid || profile.uid,
      loan_officer_slug: profile.slug || '',
      loan_officer_name: profile.full_name || '',
      loan_officer_title: profile.title || '',
      loan_officer_company: profile.company_name || '',
      loan_officer_phone: profile.phone || '',
      loan_officer_email: profile.email || '',
      loan_officer_photo_url: profile.photo_url || '',
      loan_officer_cta_url: profile.cta_url || '',
      loan_officer_calendar_url: profile.calendar_url || '',
      status: 'live'
    })
  });

  const raw = await res.text().catch(() => '');
  if (!res.ok) throw new Error('Failed to create loan officer session: ' + raw);
  const created = raw ? JSON.parse(raw) : null;
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

  const activeHost = activeEvent.host_agent_slug || activeEvent.agent_slug || activeEvent.setup_context?.agent_slug || '';
  const requestHost = request.host_agent_slug || request.agent_slug || '';
  const sameHost = activeHost && requestHost && activeHost === requestHost;
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
