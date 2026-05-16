import { KEY, SUPABASE_URL } from '../core/config.js';
import { authHeaders, jsonHeaders } from '../core/utils.js';
import { fetchJson } from './http.js';

const SMART_SIGN_INVENTORY_SELECT = [
  'id',
  'public_code',
  'inventory_type',
  'qr_url',
  'is_printed',
  'claimed_at',
  'smart_sign_id',
  'notes',
  'created_at'
].join(',');

function normalizeInventoryType(value) {
  return value === 'event_pass' ? 'event_pass' : 'smart_sign';
}

function withInventoryAlias(sign, inventory, publicCode) {
  if (!sign) return null;
  if (!inventory) return sign;
  return {
    ...sign,
    inventory_id: inventory.id,
    inventory_public_code: inventory.public_code,
    inventory_type: normalizeInventoryType(inventory.inventory_type),
    public_code_alias: publicCode
  };
}

export async function getSmartSignInventoryByPublicCode(publicCode) {
  if (!publicCode) return null;
  const rows = await fetchJson(
    `${SUPABASE_URL}/rest/v1/smart_sign_inventory?public_code=eq.${encodeURIComponent(publicCode)}&select=${SMART_SIGN_INVENTORY_SELECT}&limit=1`,
    { headers: authHeaders(KEY) }
  );
  const inventory = Array.isArray(rows) && rows.length ? rows[0] : null;
  return inventory
    ? {
        ...inventory,
        inventory_type: normalizeInventoryType(inventory.inventory_type)
      }
    : null;
}

export async function getSmartSignById(signId) {
  if (!signId) return null;
  const rows = await fetchJson(
    `${SUPABASE_URL}/rest/v1/smart_signs?id=eq.${encodeURIComponent(signId)}&select=*&limit=1`,
    { headers: authHeaders(KEY) }
  );
  return Array.isArray(rows) && rows.length ? rows[0] : null;
}

async function getSmartSignByLegacyPublicCode(publicCode) {
  if (!publicCode) return null;
  const rows = await fetchJson(
    `${SUPABASE_URL}/rest/v1/smart_signs?public_code=eq.${encodeURIComponent(publicCode)}&select=*&limit=1`,
    { headers: authHeaders(KEY) }
  );
  return Array.isArray(rows) && rows.length ? rows[0] : null;
}

export async function resolveSmartSignPublicCode(publicCode, options = {}) {
  const { allowSignPublicCodeFallback = true } = options;
  if (!publicCode) return { inventory: null, sign: null };

  const inventory = await getSmartSignInventoryByPublicCode(publicCode).catch(() => null);
  let sign = inventory?.smart_sign_id
    ? await getSmartSignById(inventory.smart_sign_id).catch(() => null)
    : null;

  if (!sign && allowSignPublicCodeFallback) {
    sign = await getSmartSignByLegacyPublicCode(publicCode).catch(() => null);
  }

  return {
    inventory,
    sign: withInventoryAlias(sign, inventory, publicCode)
  };
}

export async function getSmartSignByPublicCode(publicCode) {
  const result = await resolveSmartSignPublicCode(publicCode, {
    allowSignPublicCodeFallback: true
  });
  return result.sign || null;
}

export async function getActiveSmartSignEvent(signId) {
  if (!signId) return null;
  const rows = await fetchJson(
    `${SUPABASE_URL}/rest/v1/open_house_events?smart_sign_id=eq.${encodeURIComponent(signId)}&ended_at=is.null&select=*&order=created_at.desc&limit=1`,
    { headers: authHeaders(KEY) }
  );
  return Array.isArray(rows) && rows.length ? rows[0] : null;
}

export async function getSmartSignsByAssignedAgent(agentSlug) {
  if (!agentSlug) return [];
  const rows = await fetchJson(
    `${SUPABASE_URL}/rest/v1/smart_signs?assigned_agent_slug=eq.${encodeURIComponent(agentSlug)}&select=*&order=assigned_slot.asc.nullslast,created_at.desc`,
    { headers: authHeaders(KEY) }
  );
  return Array.isArray(rows) ? rows : [];
}

export async function updateSmartSign(signId, payload) {
  if (!signId) throw new Error('Missing sign id');
  const res = await fetch(`${SUPABASE_URL}/rest/v1/smart_signs?id=eq.${encodeURIComponent(signId)}`, {
    method: 'PATCH',
    headers: { ...jsonHeaders(KEY), Prefer: 'return=representation' },
    body: JSON.stringify(payload)
  });

  const raw = await res.text().catch(() => '');
  if (!res.ok) throw new Error('Failed to update smart sign: ' + raw);

  let updated = null;
  try { updated = raw ? JSON.parse(raw) : null; } catch {}
  return Array.isArray(updated) && updated.length ? updated[0] : null;
}

export async function assignSmartSignToAgent(signId, agentSlug, assignedSlot) {
  if (!signId) throw new Error('Missing sign id');
  if (!agentSlug) throw new Error('Missing agent slug');
  if (!assignedSlot) throw new Error('Missing assigned sign slot');

  return updateSmartSign(signId, {
    assigned_agent_slug: agentSlug,
    assigned_slot: assignedSlot,
    assigned_at: new Date().toISOString()
  });
}
