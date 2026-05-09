import { KEY, PROFILE_BUCKET, SUPABASE_URL } from '../core/config.js';
import { state, setPrefilledAgent } from '../core/state.js';
import { authHeaders, jsonHeaders } from '../core/utils.js';
import { fetchJson } from './http.js';

export async function findAgentByPhoneNormalized(phoneNormalized) {
  if (!phoneNormalized) return null;
  const matches = await fetchJson(`${SUPABASE_URL}/rest/v1/agents?phone_normalized=eq.${encodeURIComponent(phoneNormalized)}&select=*`, {
    headers: authHeaders(KEY)
  });
  return Array.isArray(matches) && matches.length ? matches[0] : null;
}

export async function findListingAgentsByOpenHouse(openHouseId) {
  if (!openHouseId) return [];
  const rows = await fetchJson(`${SUPABASE_URL}/rest/v1/listing_agents?select=*&open_house_id=eq.${encodeURIComponent(openHouseId)}`, {
    headers: authHeaders(KEY)
  });
  return Array.isArray(rows) ? rows.map((row) => normalizeListingAgent(row)).filter(Boolean) : [];
}

export async function findAgentByEmail(email) {
  if (!email) return null;
  const matches = await fetchJson(`${SUPABASE_URL}/rest/v1/agents?email=eq.${encodeURIComponent(email)}&select=*`, {
    headers: authHeaders(KEY)
  });
  return Array.isArray(matches) && matches.length ? matches[0] : null;
}

export async function getAgentBySlug(slug) {
  if (!slug) return null;
  const rows = await fetchJson(`${SUPABASE_URL}/rest/v1/agents?slug=eq.${encodeURIComponent(slug)}&select=*`, {
    headers: authHeaders(KEY)
  });
  return Array.isArray(rows) && rows.length ? rows[0] : null;
}

function cleanText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

export function isGenericAgentNameValue(value) {
  const normalized = cleanText(value).toLowerCase();
  return !normalized
    || normalized === 'agent'
    || normalized === 'listing agent'
    || normalized === 'unknown agent'
    || normalized === 'real estate agent';
}

function nameFromParts(row = {}) {
  return cleanText([
    row.first_name,
    row.middle_name,
    row.last_name
  ].filter(Boolean).join(' '));
}

export function pickAgentDisplayName(...sources) {
  const candidates = [];
  sources.forEach((source) => {
    if (!source) return;
    if (typeof source === 'string') {
      candidates.push(source);
      return;
    }
    candidates.push(
      source.name,
      source.agent_name,
      source.full_name,
      source.display_name,
      source.member_name,
      source.listing_agent_name,
      nameFromParts(source)
    );
  });

  return cleanText(candidates.find((candidate) => !isGenericAgentNameValue(candidate)) || '');
}

export function normalizeListingAgent(row = {}, fallback = {}) {
  if (!row && !fallback) return null;
  const name = pickAgentDisplayName(row, fallback);
  const phone = cleanText(row.phone || row.agent_phone || fallback.phone || fallback.agent_phone || '');
  const email = cleanText(row.email || row.agent_email || fallback.email || fallback.agent_email || '');
  const brokerage = cleanText(row.brokerage || row.office_name || row.company || fallback.brokerage || '');
  const primaryPhoto = row.primary_photo_url || row.photo_url || row.image_url || fallback.primary_photo_url || fallback.image_url || '';
  const directoryPhoto = row.directory_photo_url || row.profile_photo_url || fallback.directory_photo_url || '';

  return {
    ...row,
    name,
    phone,
    email,
    brokerage,
    primary_photo_url: primaryPhoto || null,
    directory_photo_url: directoryPhoto || null
  };
}

function bestListingAgent(rows, fallback = {}) {
  const normalized = (Array.isArray(rows) ? rows : [])
    .map((row) => normalizeListingAgent(row, fallback))
    .filter((row) => row?.name || row?.phone || row?.email || row?.primary_photo_url || row?.directory_photo_url);

  return normalized.find((row) => row.name && (row.primary_photo_url || row.directory_photo_url))
    || normalized.find((row) => row.name)
    || normalized.find((row) => row.primary_photo_url || row.directory_photo_url)
    || normalized[0]
    || null;
}

export async function findListingAgentProfile({ openHouseId = '', name = '', phone = '' } = {}) {
  const normalizedPhone = String(phone || '').replace(/\D/g, '').replace(/^1(?=\d{10}$)/, '');
  const fallback = { name, phone };
  const tryQueries = [];

  if (openHouseId && normalizedPhone) {
    tryQueries.push(`${SUPABASE_URL}/rest/v1/listing_agents?select=*&open_house_id=eq.${encodeURIComponent(openHouseId)}&phone_normalized=eq.${encodeURIComponent(normalizedPhone)}&limit=5`);
  }
  if (openHouseId) {
    tryQueries.push(`${SUPABASE_URL}/rest/v1/listing_agents?select=*&open_house_id=eq.${encodeURIComponent(openHouseId)}&limit=5`);
  }
  if (normalizedPhone) {
    tryQueries.push(`${SUPABASE_URL}/rest/v1/listing_agents?select=*&phone_normalized=eq.${encodeURIComponent(normalizedPhone)}&limit=5`);
  }
  if (name && !isGenericAgentNameValue(name)) {
    tryQueries.push(`${SUPABASE_URL}/rest/v1/listing_agents?select=*&name=eq.${encodeURIComponent(name)}&limit=5`);
  }

  for (const url of tryQueries) {
    const rows = await fetchJson(url, { headers: authHeaders(KEY) });
    const match = bestListingAgent(rows, fallback);
    if (match?.name || match?.primary_photo_url || match?.directory_photo_url) return match;
  }

  return null;
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
    const updated = { ...(existing[0] || {}), ...agent };
    setPrefilledAgent(updated);
    return updated;
  }

  const res = await fetch(`${SUPABASE_URL}/rest/v1/agents`, {
    method: 'POST',
    headers: { ...jsonHeaders(KEY), Prefer: 'return=representation' },
    body: JSON.stringify(agent)
  });
  const raw = await res.text().catch(() => '');
  if (!res.ok) throw new Error('Failed to create agent: ' + raw);

  let created = null;
  try { created = raw ? JSON.parse(raw) : null; } catch {}
  const result = Array.isArray(created) && created.length ? created[0] : agent;
  setPrefilledAgent(result);
  return result;
}

export async function findListingAgentPhoto({ openHouseId = '', name = '', phone = '' } = {}) {
  const profile = await findListingAgentProfile({ openHouseId, name, phone }).catch(() => null);
  if (profile?.primary_photo_url || profile?.directory_photo_url) {
    return profile.primary_photo_url || profile.directory_photo_url || null;
  }

  const normalizedPhone = String(phone || '').replace(/\D/g, '').replace(/^1(?=\d{10}$)/, '');
  const tryQueries = [];

  if (openHouseId && normalizedPhone) {
    tryQueries.push(`${SUPABASE_URL}/rest/v1/listing_agents?select=primary_photo_url,directory_photo_url&open_house_id=eq.${encodeURIComponent(openHouseId)}&phone_normalized=eq.${encodeURIComponent(normalizedPhone)}&limit=1`);
  }
  if (openHouseId && name) {
    tryQueries.push(`${SUPABASE_URL}/rest/v1/listing_agents?select=primary_photo_url,directory_photo_url&open_house_id=eq.${encodeURIComponent(openHouseId)}&name=eq.${encodeURIComponent(name)}&limit=1`);
  }
  if (normalizedPhone) {
    tryQueries.push(`${SUPABASE_URL}/rest/v1/listing_agents?select=primary_photo_url,directory_photo_url&phone_normalized=eq.${encodeURIComponent(normalizedPhone)}&limit=1`);
  }
  if (name) {
    tryQueries.push(`${SUPABASE_URL}/rest/v1/listing_agents?select=primary_photo_url,directory_photo_url&name=eq.${encodeURIComponent(name)}&limit=1`);
  }

  for (const url of tryQueries) {
    const rows = await fetchJson(url, { headers: authHeaders(KEY) });
    if (Array.isArray(rows) && rows.length) {
      return rows[0].primary_photo_url || rows[0].directory_photo_url || null;
    }
  }

  return null;
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
