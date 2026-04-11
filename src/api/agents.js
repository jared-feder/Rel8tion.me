import { KEY, PROFILE_BUCKET, SUPABASE_URL } from '../core/config.js';
import { state } from '../core/state.js';
import { authHeaders, jsonHeaders } from '../core/utils.js';
import { fetchJson } from './http.js';

export async function findAgentByPhoneNormalized(phoneNormalized) {
  if (!phoneNormalized) return null;
  const matches = await fetchJson(`${SUPABASE_URL}/rest/v1/agents?phone_normalized=eq.${encodeURIComponent(phoneNormalized)}&select=*`, {
    headers: authHeaders(KEY)
  });
  return Array.isArray(matches) && matches.length ? matches[0] : null;
}

export async function findAgentByEmail(email) {
  if (!email) return null;
  const matches = await fetchJson(`${SUPABASE_URL}/rest/v1/agents?email=eq.${encodeURIComponent(email)}&select=*`, {
    headers: authHeaders(KEY)
  });
  return Array.isArray(matches) && matches.length ? matches[0] : null;
}

export async function upsertAgent(agent) {
  const existing = await fetchJson(`${SUPABASE_URL}/rest/v1/agents?slug=eq.${encodeURIComponent(agent.slug)}&select=*`, {
    headers: authHeaders(KEY)
  });

  if (Array.isArray(existing) && existing.length) {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/agents?slug=eq.${encodeURIComponent(agent.slug)}`, {
      method: 'PATCH',
      headers: { ...jsonHeaders(KEY), Prefer: 'return=representation' },
      body: JSON.stringify(agent)
    });
    const raw = await res.text().catch(() => '');
    if (!res.ok) throw new Error('Failed to update agent: ' + raw);
    state.prefilledAgent = { ...(existing[0] || {}), ...agent };
    return state.prefilledAgent;
  }

  const res = await fetch(`${SUPABASE_URL}/rest/v1/agents`, {
    method: 'POST',
    headers: { ...jsonHeaders(KEY), Prefer: 'return=representation' },
    body: JSON.stringify(agent)
  });
  const raw = await res.text().catch(() => '');
  if (!res.ok) throw new Error('Failed to create agent: ' + raw);

  let created = null;
  try { created = raw ? JSON.parse(raw) : null; } catch (e) {}
  state.prefilledAgent = Array.isArray(created) && created.length ? created[0] : agent;
  return state.prefilledAgent;
}

export async function uploadFullProfilePhoto(slug) {
  const photo = document.getElementById('full_photo');
  const file = photo?.files?.[0];
  if (!file) return state.prefilledAgent?.image_url || null;

  const ext = (file.name.split('.').pop() || 'jpg').toLowerCase();
  const path = `${slug}.${ext}`;

  const res = await fetch(`${SUPABASE_URL}/storage/v1/object/${PROFILE_BUCKET}/${path}`, {
    method: 'POST',
    headers: {
      apikey: KEY,
      Authorization: 'Bearer ' + KEY,
      'x-upsert': 'true',
      'Content-Type': file.type || 'application/octet-stream'
    },
    body: file
  });

  const raw = await res.text().catch(() => '');
  if (!res.ok) throw new Error('Photo upload failed: ' + raw);
  return `${SUPABASE_URL}/storage/v1/object/public/${PROFILE_BUCKET}/${path}`;
}
