import { KEY, SUPABASE_URL } from '../core/config.js';
import { state, setKeyRecord, setPrefilledAgent } from '../core/state.js';
import { getPendingSignActivation } from '../core/hostSession.js';
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

async function getClaimedKeysForAgent(slug) {
  if (!slug) return [];
  const rows = await fetchJson(
    `${SUPABASE_URL}/rest/v1/keys?agent_slug=eq.${encodeURIComponent(slug)}&claimed=eq.true&select=uid,device_role,assigned_slot&order=assigned_slot.asc.nullslast`,
    { headers: authHeaders(KEY) }
  ).catch(() => []);
  return Array.isArray(rows) ? rows : [];
}

function isKeychainLike(row) {
  const role = String(row?.device_role || '').trim().toLowerCase();
  return !role || role === 'keychain';
}

function resolveKeychainSlot({ existingRow, agentKeys, uid }) {
  const currentSlot = Number(existingRow?.assigned_slot);
  if (currentSlot === 1 || currentSlot === 2) return currentSlot;

  const otherKeychains = (agentKeys || [])
    .filter((row) => row?.uid !== uid && isKeychainLike(row));
  const usedSlots = new Set(
    otherKeychains
      .map((row) => Number(row.assigned_slot))
      .filter((slot) => slot === 1 || slot === 2)
  );

  if (otherKeychains.length && !usedSlots.has(1)) {
    usedSlots.add(1);
  }

  if (otherKeychains.length >= 2) return null;
  if (!otherKeychains.length) return 1;
  if (!usedSlots.has(2)) return 2;
  if (!usedSlots.has(1)) return 1;
  return null;
}

function isEventPassClaim() {
  const pending = getPendingSignActivation();
  return pending?.source === 'event_pass' && !!pending?.code;
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
  const eventPassClaim = isEventPassClaim();
  const agentKeys = eventPassClaim ? [] : await getClaimedKeysForAgent(slug);
  const assignedSlot = eventPassClaim ? null : resolveKeychainSlot({ existingRow, agentKeys, uid: state.uid });
  if (!eventPassClaim && !assignedSlot) {
    throw new Error('This agent already has two active keychains.');
  }

  const payload = {
    agent_slug: slug,
    claimed: true,
    device_role: eventPassClaim ? 'event_pass_keychain' : 'keychain',
    assigned_slot: assignedSlot
  };

  if (existingRow) {
    const patchRes = await fetch(`${SUPABASE_URL}/rest/v1/keys?uid=eq.${encodeURIComponent(state.uid)}`, {
      method: 'PATCH',
      headers: { ...jsonHeaders(KEY), Prefer: 'return=representation' },
      body: JSON.stringify(payload)
    });
    const raw = await patchRes.text().catch(() => '');
    if (!patchRes.ok) throw new Error('Failed patching existing key row: ' + raw);
  } else {
    const insertRes = await fetch(`${SUPABASE_URL}/rest/v1/keys`, {
      method: 'POST',
      headers: { ...jsonHeaders(KEY), Prefer: 'return=representation' },
      body: JSON.stringify({ uid: state.uid, ...payload })
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
