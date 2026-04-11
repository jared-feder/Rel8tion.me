import { KEY, SUPABASE_URL } from '../core/config.js';
import { authHeaders, jsonHeaders } from '../core/utils.js';
import { fetchJson } from './http.js';

export async function createScanEvent(payload) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/smart_sign_scan_events`, {
    method: 'POST',
    headers: { ...jsonHeaders(KEY), Prefer: 'return=representation' },
    body: JSON.stringify(payload)
  });

  const raw = await res.text().catch(() => '');
  if (!res.ok) throw new Error('Failed to create scan event: ' + raw);

  let created = null;
  try { created = raw ? JSON.parse(raw) : null; } catch (e) {}
  return Array.isArray(created) && created.length ? created[0] : null;
}

export async function getRecentScanEventsByAgentSlug(agentSlug, minutes = 10) {
  if (!agentSlug) return [];
  const since = new Date(Date.now() - minutes * 60 * 1000).toISOString();
  return fetchJson(
    `${SUPABASE_URL}/rest/v1/smart_sign_scan_events?agent_slug=eq.${encodeURIComponent(agentSlug)}&scanned_at=gte.${encodeURIComponent(since)}&select=*&order=scanned_at.desc`,
    { headers: authHeaders(KEY) }
  );
}

export async function getRecentScanEventsByUid(uid, minutes = 10) {
  if (!uid) return [];
  const since = new Date(Date.now() - minutes * 60 * 1000).toISOString();
  return fetchJson(
    `${SUPABASE_URL}/rest/v1/smart_sign_scan_events?uid=eq.${encodeURIComponent(uid)}&scanned_at=gte.${encodeURIComponent(since)}&select=*&order=scanned_at.desc`,
    { headers: authHeaders(KEY) }
  );
}
