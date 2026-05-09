import { SUPABASE_URL, KEY, PROFILE_BUCKET } from '../core/config.js';
import { state, setCurrentBrand, setKeyRecord, setPrefilledAgent } from '../core/state.js';
import { authHeaders, jsonHeaders, debug } from '../core/utils.js';
import { fetchJson } from './http.js';

export async function applyBranding(name) {
  const neutralBrand = {
    name: name || '',
    logo_url: null,
    primary_color: '#38bdf8',
    accent_color: '#2563eb',
    bg_color: '#ffffff',
    text_color: '#0f172a',
    font_family: 'Inter',
    button_style: 'rounded'
  };

  if (!name) {
    setCurrentBrand(neutralBrand);
    return neutralBrand;
  }

  try {
    const all = await fetchJson(`${SUPABASE_URL}/rest/v1/brokerages?select=*`, {
      headers: authHeaders(KEY)
    });

    const clean = String(name).toLowerCase().trim();
    const brand = all.find((x) => {
      const brandName = String(x.name || '').toLowerCase().trim();
      if (brandName && clean === brandName) return true;
      if (brandName && clean.includes(brandName)) return true;
      if (Array.isArray(x.match_keywords)) {
        return x.match_keywords.some((k) => clean.includes(String(k || '').toLowerCase().trim()));
      }
      return false;
    });

    const result = brand ? { ...neutralBrand, ...brand, name } : neutralBrand;
    setCurrentBrand(result);
    return result;
  } catch (e) {
    debug('BRANDING LOOKUP FAILED', { message: e?.message || String(e) });
    setCurrentBrand(neutralBrand);
    return neutralBrand;
  }
}

export async function loadAgentFromUID() {
  if (!state.uid) return null;

  const keyData = await fetchJson(`${SUPABASE_URL}/rest/v1/keys?uid=eq.${encodeURIComponent(state.uid)}&select=*`, {
    headers: authHeaders(KEY)
  });

  if (!Array.isArray(keyData) || !keyData.length) return null;

  setKeyRecord(keyData[0]);

  if (keyData[0].agent_slug) {
    const agentData = await fetchJson(`${SUPABASE_URL}/rest/v1/agents?slug=eq.${encodeURIComponent(keyData[0].agent_slug)}&select=*`, {
      headers: authHeaders(KEY)
    });

    if (Array.isArray(agentData) && agentData.length) {
      setPrefilledAgent(agentData[0]);
      if (agentData[0].brokerage) await applyBranding(agentData[0].brokerage);
      return agentData[0];
    }
  }

  return null;
}

export async function findNearestOpenHouses(lat, lng) {
  return fetchJson(`${SUPABASE_URL}/rest/v1/rpc/find_nearest_open_house`, {
    method: 'POST',
    headers: jsonHeaders(KEY),
    body: JSON.stringify({ user_lat: lat, user_lng: lng })
  });
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

export async function linkKeyToAgent(slug) {
  if (!state.uid) throw new Error('Missing chip uid');

  const existingRows = await fetchJson(`${SUPABASE_URL}/rest/v1/keys?uid=eq.${encodeURIComponent(state.uid)}&select=*`, {
    headers: authHeaders(KEY)
  });

  if (Array.isArray(existingRows) && existingRows.length) {
    const patchRes = await fetch(`${SUPABASE_URL}/rest/v1/keys?uid=eq.${encodeURIComponent(state.uid)}`, {
      method: 'PATCH',
      headers: { ...jsonHeaders(KEY), Prefer: 'return=representation' },
      body: JSON.stringify({ agent_slug: slug, claimed: true })
    });
    const raw = await patchRes.text().catch(() => '');
    if (!patchRes.ok) throw new Error('Failed patching existing key row: ' + raw);
  } else {
    const insertRes = await fetch(`${SUPABASE_URL}/rest/v1/keys`, {
      method: 'POST',
      headers: { ...jsonHeaders(KEY), Prefer: 'return=representation' },
      body: JSON.stringify({ uid: state.uid, agent_slug: slug, claimed: true })
    });
    const raw = await insertRes.text().catch(() => '');
    if (!insertRes.ok) throw new Error('Failed inserting new key row: ' + raw);
  }

  const verify = await fetchJson(`${SUPABASE_URL}/rest/v1/keys?uid=eq.${encodeURIComponent(state.uid)}&select=*`, {
    headers: authHeaders(KEY)
  });

  const keyRow = Array.isArray(verify) ? verify[0] : null;
  if (!keyRow) throw new Error('Key row missing after save');
  if (keyRow.claimed !== true) throw new Error('Key row did not save claimed=true');
  if (keyRow.agent_slug !== slug) throw new Error(`Key row did not save correct slug. Expected ${slug}, got ${keyRow.agent_slug}`);
  setKeyRecord(keyRow);
  return keyRow;
}

export async function sendActivationSMS(phone, slug, name) {
  if (!phone) return;
  try {
    await fetch(`${SUPABASE_URL}/functions/v1/send-lead-sms`, {
      method: 'POST',
      headers: jsonHeaders(KEY),
      body: JSON.stringify({
        agent_phone: phone,
        buyer_phone: phone,
        buyer_name: name || 'Agent',
        message: `Your Rel8tionChip is live 💯\n\n${location.origin}/a?agent=${slug}`
      })
    });
  } catch (e) {
    debug('SMS SEND FAILED', { message: e?.message || String(e) });
  }
}

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