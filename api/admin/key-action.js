const { adminAuthorized, assertAdminConfig, sendJson, supabaseRest } = require('../../lib/admin-auth');

function parseBody(req) {
  if (!req.body) return {};
  if (typeof req.body === 'object') return req.body;
  try {
    return JSON.parse(req.body);
  } catch (_) {
    return {};
  }
}

function enc(value) {
  return encodeURIComponent(String(value || '').trim());
}

function cleanUid(value) {
  return String(value || '').trim();
}

function unique(values) {
  return [...new Set((values || []).map(cleanUid).filter(Boolean))];
}

function httpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

async function list(path) {
  const rows = await supabaseRest(path);
  return Array.isArray(rows) ? rows : [];
}

async function safeRest(path, options = {}) {
  try {
    const rows = await supabaseRest(path, options);
    return { ok: true, rows: Array.isArray(rows) ? rows : rows ? [rows] : [] };
  } catch (error) {
    return {
      ok: false,
      warning: error.message || String(error),
      details: error.payload || null
    };
  }
}

async function patchRows(path, payload) {
  return safeRest(path, {
    method: 'PATCH',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify(payload)
  });
}

async function deleteRows(path) {
  return safeRest(path, {
    method: 'DELETE',
    headers: { Prefer: 'return=representation' }
  });
}

async function unclaimKey(uid) {
  return supabaseRest(`keys?uid=eq.${enc(uid)}`, {
    method: 'PATCH',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify({
      claimed: false,
      agent_slug: null,
      device_role: null,
      assigned_slot: null
    })
  });
}

async function cancelSessionsForUid(uid) {
  return supabaseRest(`smart_sign_activation_sessions?agent_key_uid=eq.${enc(uid)}&status=eq.pending`, {
    method: 'PATCH',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify({
      status: 'cancelled',
      stage: 'cancelled',
      updated_at: new Date().toISOString(),
      expires_at: new Date().toISOString()
    })
  }).catch((error) => ({ warning: error.message || String(error) }));
}

async function unclaimKeys(uids, confirmation) {
  if (String(confirmation || '').trim() !== 'REL8TION') {
    const error = new Error('Type REL8TION to unclaim keychains.');
    error.status = 400;
    throw error;
  }

  const targetUids = unique(uids);
  if (!targetUids.length) {
    const error = new Error('Missing keychain UIDs.');
    error.status = 400;
    throw error;
  }

  const changed = [];
  const sessions = [];
  for (const uid of targetUids) {
    const rows = await unclaimKey(uid);
    changed.push({ uid, rows: Array.isArray(rows) ? rows : [] });
    sessions.push({ uid, result: await cancelSessionsForUid(uid) });
  }
  return { changed, sessions };
}

function uniqueById(rows) {
  const seen = new Set();
  return (rows || []).filter((row) => {
    if (!row?.id || seen.has(row.id)) return false;
    seen.add(row.id);
    return true;
  });
}

function signUidFilter(uid) {
  const encoded = enc(uid);
  return `or=(uid_primary.eq.${encoded},uid_secondary.eq.${encoded},activation_uid_primary.eq.${encoded},activation_uid_secondary.eq.${encoded})`;
}

function eventUidFilter(uid) {
  const encoded = enc(uid);
  return `or=(activation_uid_primary.eq.${encoded},activation_uid_secondary.eq.${encoded})`;
}

function clearedToken(prefix = 'cleared') {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

async function loadSignsForUid(uid) {
  return list(
    `smart_signs?${signUidFilter(uid)}&select=id,public_code,status,owner_agent_slug,assigned_agent_slug,assigned_slot,active_event_id,uid_primary,uid_secondary,activation_uid_primary,activation_uid_secondary,activation_method,primary_device_type,secondary_device_type,updated_at,created_at`
  );
}

async function loadEventsForUidAndSign(uid, signId) {
  const eventSelect = 'id,host_agent_slug,smart_sign_id,status,ended_at,last_activity_at,activation_uid_primary,activation_uid_secondary,created_at';
  const rows = [];
  rows.push(...await list(`open_house_events?${eventUidFilter(uid)}&select=${eventSelect}`));
  if (signId) {
    rows.push(...await list(`open_house_events?smart_sign_id=eq.${enc(signId)}&select=${eventSelect}`));
  }
  return uniqueById(rows);
}

async function endLiveLoanOfficerCoverage(eventId, now) {
  return patchRows(
    `event_loan_officer_sessions?open_house_event_id=eq.${enc(eventId)}&status=eq.live`,
    {
      status: 'ended',
      signed_out_at: now,
      updated_at: now
    }
  );
}

async function closeAndScrubEvent(event, uid, now) {
  const payload = {};
  if (event.activation_uid_primary === uid) payload.activation_uid_primary = null;
  if (event.activation_uid_secondary === uid) payload.activation_uid_secondary = null;

  if (event.status !== 'ended' || !event.ended_at) {
    payload.status = 'ended';
    payload.ended_at = event.ended_at || now;
    payload.last_activity_at = now;
  } else if (Object.keys(payload).length) {
    payload.last_activity_at = now;
  }

  const coverage = await endLiveLoanOfficerCoverage(event.id, now);
  const updated = Object.keys(payload).length
    ? await patchRows(`open_house_events?id=eq.${enc(event.id)}`, payload)
    : { ok: true, rows: [event] };

  return { event_before: event, event: updated, loan_officer_coverage: coverage };
}

async function clearSignForUid(sign, uid, now) {
  const cleanup = {
    sign_before: sign,
    inventory_by_sign: null,
    inventory_by_code: null,
    sessions_by_sign: null,
    sessions_by_code: null,
    deleted_sign: null,
    patched_sign: null
  };

  cleanup.inventory_by_sign = await patchRows(
    `smart_sign_inventory?smart_sign_id=eq.${enc(sign.id)}`,
    { smart_sign_id: null, claimed_at: null }
  );

  if (sign.public_code) {
    cleanup.inventory_by_code = await patchRows(
      `smart_sign_inventory?public_code=eq.${enc(sign.public_code)}`,
      { smart_sign_id: null, claimed_at: null }
    );
    cleanup.sessions_by_code = await deleteRows(
      `smart_sign_activation_sessions?public_code=eq.${enc(sign.public_code)}`
    );
  }

  cleanup.sessions_by_sign = await deleteRows(
    `smart_sign_activation_sessions?sign_id=eq.${enc(sign.id)}`
  );

  cleanup.deleted_sign = await deleteRows(`smart_signs?id=eq.${enc(sign.id)}`);
  if (cleanup.deleted_sign.ok && cleanup.deleted_sign.rows.length) {
    return cleanup;
  }

  const signPatch = {
    public_code: sign.public_code ? clearedToken('cleared-code') : sign.public_code,
    active_event_id: null,
    status: 'inactive',
    owner_agent_slug: null,
    assigned_agent_slug: null,
    assigned_slot: null,
    activation_uid_primary: sign.activation_uid_primary === uid ? null : sign.activation_uid_primary || null,
    activation_uid_secondary: sign.activation_uid_secondary === uid ? null : sign.activation_uid_secondary || null,
    deactivated_at: now,
    updated_at: now
  };

  if (sign.uid_primary === uid) {
    signPatch.uid_primary = clearedToken('cleared-uid');
    signPatch.primary_device_type = 'event_pass_qr';
  }
  if (sign.uid_secondary === uid) {
    signPatch.uid_secondary = null;
    signPatch.secondary_device_type = null;
  }

  cleanup.patched_sign = await patchRows(`smart_signs?id=eq.${enc(sign.id)}`, signPatch);
  return cleanup;
}

async function freshUidEverywhere(uid, confirmation) {
  if (String(confirmation || '').trim() !== 'REL8TION') {
    throw httpError(400, 'Type REL8TION to make this UID fresh everywhere.');
  }

  const targetUid = cleanUid(uid);
  if (!targetUid) {
    throw httpError(400, 'Missing UID.');
  }

  const now = new Date().toISOString();
  const before = {
    key: await list(`keys?uid=eq.${enc(targetUid)}&select=uid,agent_slug,claimed,device_role,assigned_slot&limit=5`).catch(() => []),
    signs: await loadSignsForUid(targetUid).catch(() => []),
    events: await list(`open_house_events?${eventUidFilter(targetUid)}&select=id,host_agent_slug,smart_sign_id,status,ended_at,activation_uid_primary,activation_uid_secondary,created_at`).catch(() => []),
    sessions: await list(`smart_sign_activation_sessions?agent_key_uid=eq.${enc(targetUid)}&select=id,public_code,sign_id,agent_slug,agent_key_uid,status,stage,updated_at&limit=25`).catch(() => [])
  };

  const key = await patchRows(`keys?uid=eq.${enc(targetUid)}`, {
    claimed: false,
    agent_slug: null,
    device_role: null,
    assigned_slot: null
  });

  const sessionsByUid = await deleteRows(
    `smart_sign_activation_sessions?agent_key_uid=eq.${enc(targetUid)}`
  );

  const signs = await loadSignsForUid(targetUid);
  const eventResults = [];
  const signResults = [];
  const seenEventIds = new Set();

  for (const sign of signs) {
    const events = await loadEventsForUidAndSign(targetUid, sign.id);
    for (const event of events) {
      if (!event?.id || seenEventIds.has(event.id)) continue;
      seenEventIds.add(event.id);
      eventResults.push(await closeAndScrubEvent(event, targetUid, now));
    }
    signResults.push(await clearSignForUid(sign, targetUid, now));
  }

  for (const event of await loadEventsForUidAndSign(targetUid, null)) {
    if (!event?.id || seenEventIds.has(event.id)) continue;
    seenEventIds.add(event.id);
    eventResults.push(await closeAndScrubEvent(event, targetUid, now));
  }

  const aliases = await deleteRows(`smart_sign_chip_aliases?uid=eq.${enc(targetUid)}`);
  const after = {
    key: await list(`keys?uid=eq.${enc(targetUid)}&select=uid,agent_slug,claimed,device_role,assigned_slot&limit=5`).catch(() => []),
    signs: await loadSignsForUid(targetUid).catch(() => []),
    events: await list(`open_house_events?${eventUidFilter(targetUid)}&select=id,host_agent_slug,smart_sign_id,status,ended_at,activation_uid_primary,activation_uid_secondary,created_at`).catch(() => []),
    sessions: await list(`smart_sign_activation_sessions?agent_key_uid=eq.${enc(targetUid)}&select=id,public_code,sign_id,agent_slug,agent_key_uid,status,stage,updated_at&limit=25`).catch(() => []),
    aliases: await list(`smart_sign_chip_aliases?uid=eq.${enc(targetUid)}&select=id,uid,smart_sign_id,active&limit=25`).catch(() => [])
  };

  return {
    uid: targetUid,
    before,
    key,
    sessions_by_uid: sessionsByUid,
    events: eventResults,
    signs: signResults,
    aliases,
    after
  };
}

module.exports = async function handler(req, res) {
  try {
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST');
      sendJson(res, 405, { ok: false, error: 'Method not allowed.' });
      return;
    }

    assertAdminConfig();
    const auth = adminAuthorized(req);
    if (!auth.ok) {
      sendJson(res, 401, { ok: false, error: auth.error });
      return;
    }

    const body = parseBody(req);
    const action = String(body.action || '').trim();
    if (!['unclaim_keys', 'fresh_uid_everywhere'].includes(action)) {
      sendJson(res, 400, { ok: false, error: 'Unsupported key action.' });
      return;
    }

    const result = action === 'fresh_uid_everywhere'
      ? await freshUidEverywhere(body.uid, body.confirmation)
      : await unclaimKeys(body.uids, body.confirmation);
    sendJson(res, 200, { ok: true, action, ...result });
  } catch (error) {
    sendJson(res, error.status || 500, {
      ok: false,
      error: error.message || 'Unable to update keychains.',
      details: error.payload || null
    });
  }
};
