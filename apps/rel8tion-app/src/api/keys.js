import { KEY, SUPABASE_URL } from '../core/config.js';
import { state, setKeyRecord, setPrefilledAgent } from '../core/state.js';
import { authHeaders, jsonHeaders } from '../core/utils.js';
import { fetchJson } from './http.js';
import { applyBranding } from './brokerages.js';

export async function getKeyByUid(uid) {
  if (!uid) return null;
  const rows = await fetchJson(`${SUPABASE_URL}/rest/v1/keys?uid=eq.${encodeURIComponent(uid)}&select=*`, {
    headers: authHeaders(KEY)
  });
  return Array.isArray(rows) && rows.length ? rows[0] : null;
}

export async function loadAgentFromUID() {
  if (!state.uid) return null;

  const keyRow = await getKeyByUid(state.uid);
  if (!keyRow) return null;

  setKeyRecord(keyRow);

  if (keyRow.agent_slug) {
    const agentData = await fetchJson(`${SUPABASE_URL}/rest/v1/agents?slug=eq.${encodeURIComponent(keyRow.agent_slug)}&select=*`, {
      headers: authHeaders(KEY)
    });

    if (Array.isArray(agentData) && agentData.length) {
      setPrefilledAgent(agentData[0]);
      if (agentData[0].brokerage) {
        await applyBranding(agentData[0].brokerage);
      }
      return agentData[0];
    }
  }

  return null;
}

export async function linkKeyToAgent(slug) {
  if (!state.uid) throw new Error('Missing chip uid');

  const existingRow = await getKeyByUid(state.uid);

  if (existingRow) {
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

  const keyRow = await getKeyByUid(state.uid);
  if (!keyRow) throw new Error('Key row missing after save');
  if (keyRow.claimed !== true) throw new Error('Key row did not save claimed=true');
  if (keyRow.agent_slug !== slug) {
    throw new Error(`Key row did not save correct slug. Expected ${slug}, got ${keyRow.agent_slug}`);
  }

  setKeyRecord(keyRow);
  return keyRow;
}
