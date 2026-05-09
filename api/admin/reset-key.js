const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ADMIN_TOKEN = process.env.KEY_RESET_ADMIN_TOKEN;
const BETA_KEYCHAIN_UID = '7ce5a51b-8202-4178-afc7-40a2e10e2a4d';
const BETA_AGENT_SLUG = 'main-beta';
const BETA_SIGN_PUBLIC_CODE = '0e4b015f3782';
const BETA_SIGN_FRONT_UID = 'f005e166-70b3-407c-ba24-b91464a3d22a';
const BETA_SIGN_REAR_UID = 'b70d2bde-d185-43ee-8962-083b64fa4347';
const BETA_ALLOWED_UIDS = new Set([
  BETA_KEYCHAIN_UID,
  BETA_SIGN_FRONT_UID,
  BETA_SIGN_REAR_UID
]);

function send(res, status, payload) {
  res.status(status).json(payload);
}

function authOk(req) {
  if (!ADMIN_TOKEN) return false;
  const headerToken = req.headers['x-admin-token'];
  const bearer = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  return headerToken === ADMIN_TOKEN || bearer === ADMIN_TOKEN;
}

function assertConfig() {
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
    throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.');
  }
  if (!ADMIN_TOKEN) {
    throw new Error('Missing KEY_RESET_ADMIN_TOKEN.');
  }
}

async function supabaseRequest(path, options = {}) {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...options,
    headers: {
      apikey: SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json',
      ...(options.headers || {})
    }
  });

  const raw = await response.text().catch(() => '');
  if (!response.ok) {
    throw new Error(raw || `Supabase request failed: ${response.status}`);
  }
  return raw ? JSON.parse(raw) : null;
}

function normalizeUid(uid) {
  return String(uid || '').trim();
}

function assertBetaUid(uid) {
  if (!BETA_ALLOWED_UIDS.has(uid)) {
    throw new Error('This reset tool is restricted to the dedicated beta keychain and beta sign only.');
  }
}

function assertBetaPublicCode(publicCode) {
  if (publicCode && publicCode !== BETA_SIGN_PUBLIC_CODE) {
    throw new Error('This reset tool can only reset the dedicated beta sign code.');
  }
}

async function lookupUid(uid) {
  assertBetaUid(uid);
  const encoded = encodeURIComponent(uid);
  const [keys, signMatches] = await Promise.all([
    supabaseRequest(`keys?uid=eq.${encoded}&select=*&limit=1`),
    supabaseRequest(
      `smart_signs?or=(uid_primary.eq.${encoded},uid_secondary.eq.${encoded},activation_uid_primary.eq.${encoded},activation_uid_secondary.eq.${encoded})&select=id,public_code,status,owner_agent_slug,active_event_id,uid_primary,uid_secondary,activation_uid_primary,activation_uid_secondary,primary_device_type,secondary_device_type&limit=5`
    )
  ]);

  return {
    key: Array.isArray(keys) ? keys[0] || null : null,
    signMatches: Array.isArray(signMatches) ? signMatches : []
  };
}

async function deleteKey(uid) {
  assertBetaUid(uid);
  return supabaseRequest(`keys?uid=eq.${encodeURIComponent(uid)}`, {
    method: 'DELETE',
    headers: { Prefer: 'return=representation' }
  });
}

async function unclaimKey(uid) {
  assertBetaUid(uid);
  return supabaseRequest(`keys?uid=eq.${encodeURIComponent(uid)}`, {
    method: 'PATCH',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify({
      claimed: false,
      agent_slug: null
    })
  });
}

function signContainsUid(sign, uid) {
  return [
    sign.uid_primary,
    sign.uid_secondary,
    sign.activation_uid_primary,
    sign.activation_uid_secondary
  ].includes(uid);
}

function isProtectedFieldSign(sign) {
  const owner = String(sign?.owner_agent_slug || sign?.assigned_agent_slug || '').toLowerCase();
  return owner.includes('elena') || owner.includes('galluzzo');
}

async function resetSmartSignPairing(uid, publicCode, forceActive = false) {
  assertBetaUid(uid);
  assertBetaPublicCode(publicCode);
  const encodedUid = encodeURIComponent(uid);
  const uidFilter = `or=(uid_primary.eq.${encodedUid},uid_secondary.eq.${encodedUid},activation_uid_primary.eq.${encodedUid},activation_uid_secondary.eq.${encodedUid})`;
  const rows = await supabaseRequest(
    `smart_signs?${uidFilter}&select=*`
  );
  const matches = Array.isArray(rows) ? rows.filter((row) => signContainsUid(row, uid)) : [];
  const normalizedCode = normalizeUid(publicCode);
  const sign = normalizedCode
    ? matches.find((row) => row.public_code === normalizedCode)
    : matches.length === 1 ? matches[0] : null;
  if (!sign?.id) {
    if (matches.length > 1) {
      throw new Error(`This UID matches multiple smart signs. Choose one public code: ${matches.map((row) => row.public_code).filter(Boolean).join(', ')}`);
    }
    throw new Error('No matching smart sign was found for that UID.');
  }

  if (isProtectedFieldSign(sign)) {
    throw new Error('Refusing to reset the protected Elena/Galluzzo field sign from this beta cleanup tool.');
  }

  const isActive = sign.status === 'active' || Boolean(sign.active_event_id);
  if (isActive && !forceActive) {
    throw new Error('This smart sign is active. Confirm the active reset before removing the pairing.');
  }

  const signId = encodeURIComponent(sign.id);
  const encodedCode = encodeURIComponent(sign.public_code || normalizedCode);
  await supabaseRequest(`smart_signs?id=eq.${signId}`, {
    method: 'PATCH',
    body: JSON.stringify({
      active_event_id: null,
      status: 'inactive',
      owner_agent_slug: null,
      assigned_agent_slug: null
    })
  }).catch(() => null);
  const events = await supabaseRequest(`open_house_events?smart_sign_id=eq.${signId}&select=id`).catch(() => []);
  for (const event of Array.isArray(events) ? events : []) {
    if (!event?.id) continue;
    await deleteEventDependents(event.id);
    await supabaseRequest(`open_house_events?id=eq.${encodeURIComponent(event.id)}`, { method: 'DELETE' }).catch(() => null);
  }
  await supabaseRequest(`smart_sign_activation_sessions?or=(sign_id.eq.${signId},public_code.eq.${encodedCode})`, {
    method: 'DELETE'
  }).catch(() => null);
  await supabaseRequest(`smart_sign_inventory?public_code=eq.${encodedCode}`, {
    method: 'PATCH',
    body: JSON.stringify({
      smart_sign_id: null,
      claimed_at: null
    })
  }).catch(() => null);
  await supabaseRequest(`smart_sign_inventory?smart_sign_id=eq.${signId}`, {
    method: 'PATCH',
    body: JSON.stringify({
      smart_sign_id: null,
      claimed_at: null
    })
  }).catch(() => null);
  const deleted = await supabaseRequest(`smart_signs?id=eq.${signId}`, {
    method: 'DELETE',
    headers: { Prefer: 'return=representation' }
  });

  return Array.isArray(deleted) ? deleted : [];
}

async function restoreBetaKeychain() {
  const existing = await supabaseRequest(`keys?uid=eq.${encodeURIComponent(BETA_KEYCHAIN_UID)}&select=uid&limit=1`);
  const payload = {
    uid: BETA_KEYCHAIN_UID,
    agent_slug: BETA_AGENT_SLUG,
    claimed: true
  };

  if (Array.isArray(existing) && existing.length) {
    const updated = await supabaseRequest(`keys?uid=eq.${encodeURIComponent(BETA_KEYCHAIN_UID)}`, {
      method: 'PATCH',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify(payload)
    });
    return Array.isArray(updated) ? updated[0] || null : null;
  }

  const inserted = await supabaseRequest('keys', {
    method: 'POST',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify(payload)
  });
  return Array.isArray(inserted) ? inserted[0] || null : null;
}

function betaSignMatchFilter() {
  const code = encodeURIComponent(BETA_SIGN_PUBLIC_CODE);
  const front = encodeURIComponent(BETA_SIGN_FRONT_UID);
  const rear = encodeURIComponent(BETA_SIGN_REAR_UID);
  return [
    `public_code.eq.${code}`,
    `uid_primary.eq.${front}`,
    `uid_secondary.eq.${front}`,
    `activation_uid_primary.eq.${front}`,
    `activation_uid_secondary.eq.${front}`,
    `uid_primary.eq.${rear}`,
    `uid_secondary.eq.${rear}`,
    `activation_uid_primary.eq.${rear}`,
    `activation_uid_secondary.eq.${rear}`
  ].join(',');
}

async function deleteEventDependents(eventId) {
  const encodedEventId = encodeURIComponent(eventId);
  await supabaseRequest(`event_loan_officer_sessions?open_house_event_id=eq.${encodedEventId}`, {
    method: 'DELETE'
  }).catch(() => null);
  await supabaseRequest(`event_checkins?open_house_event_id=eq.${encodedEventId}`, {
    method: 'DELETE'
  }).catch(() => null);
}

async function resetBetaLane() {
  const signs = await supabaseRequest(`smart_signs?or=(${betaSignMatchFilter()})&select=*`);
  const betaSigns = Array.isArray(signs) ? signs.filter((sign) => !isProtectedFieldSign(sign)) : [];
  const changed = {
    restoredKey: null,
    deletedEventIds: [],
    deletedSignIds: [],
    inventoryReset: false
  };

  for (const sign of betaSigns) {
    if (!sign?.id) continue;
    const signId = encodeURIComponent(sign.id);

    await supabaseRequest(`smart_signs?id=eq.${signId}`, {
      method: 'PATCH',
      body: JSON.stringify({
        active_event_id: null,
        status: 'inactive',
        owner_agent_slug: null,
        assigned_agent_slug: null
      })
    }).catch(() => null);

    const events = await supabaseRequest(`open_house_events?smart_sign_id=eq.${signId}&select=id`);
    for (const event of Array.isArray(events) ? events : []) {
      if (!event?.id) continue;
      await deleteEventDependents(event.id);
      await supabaseRequest(`open_house_events?id=eq.${encodeURIComponent(event.id)}`, { method: 'DELETE' }).catch(() => null);
      changed.deletedEventIds.push(event.id);
    }

    await supabaseRequest(`smart_sign_activation_sessions?sign_id=eq.${signId}`, { method: 'DELETE' }).catch(() => null);
    await supabaseRequest(`smart_sign_inventory?smart_sign_id=eq.${signId}`, {
      method: 'PATCH',
      body: JSON.stringify({
        smart_sign_id: null,
        claimed_at: null
      })
    }).catch(() => null);
    const deleted = await supabaseRequest(`smart_signs?id=eq.${signId}`, {
      method: 'DELETE',
      headers: { Prefer: 'return=representation' }
    }).catch(() => []);
    if (Array.isArray(deleted)) {
      deleted.forEach((row) => row?.id && changed.deletedSignIds.push(row.id));
    }
  }

  await supabaseRequest(`smart_sign_activation_sessions?public_code=eq.${encodeURIComponent(BETA_SIGN_PUBLIC_CODE)}`, {
    method: 'DELETE'
  }).catch(() => null);

  await supabaseRequest(`smart_sign_inventory?public_code=eq.${encodeURIComponent(BETA_SIGN_PUBLIC_CODE)}`, {
    method: 'PATCH',
    body: JSON.stringify({
      smart_sign_id: null,
      claimed_at: null
    })
  }).then(() => {
    changed.inventoryReset = true;
  }).catch(() => null);

  changed.restoredKey = await restoreBetaKeychain();
  return changed;
}

module.exports = async function handler(req, res) {
  try {
    assertConfig();

    if (!authOk(req)) {
      return send(res, 401, { ok: false, error: 'Unauthorized.' });
    }

    if (req.method === 'GET') {
      const uid = normalizeUid(req.query.uid);
      if (!uid) return send(res, 400, { ok: false, error: 'Missing uid.' });
      return send(res, 200, { ok: true, uid, ...(await lookupUid(uid)) });
    }

    if (req.method !== 'POST') {
      res.setHeader('Allow', 'GET, POST');
      return send(res, 405, { ok: false, error: 'Method not allowed.' });
    }

    const uid = normalizeUid(req.body?.uid);
    const action = String(req.body?.action || 'delete').trim();
    if (!uid) return send(res, 400, { ok: false, error: 'Missing uid.' });
    if (!['delete', 'unclaim', 'reset_sign_pairing', 'restore_beta_keychain', 'reset_beta_lane'].includes(action)) {
      return send(res, 400, { ok: false, error: 'Invalid action.' });
    }

    const before = await lookupUid(uid);
    let changed = [];
    if (action === 'reset_beta_lane') {
      changed = await resetBetaLane();
    } else if (action === 'restore_beta_keychain') {
      changed = await restoreBetaKeychain();
    } else if (action === 'reset_sign_pairing') {
      const publicCode = normalizeUid(req.body?.publicCode);
      if (!publicCode) return send(res, 400, { ok: false, error: 'Missing publicCode.' });
      changed = await resetSmartSignPairing(uid, publicCode, req.body?.forceActive === true);
    } else {
      changed = action === 'unclaim' ? await unclaimKey(uid) : await deleteKey(uid);
    }
    const after = await lookupUid(uid);

    return send(res, 200, {
      ok: true,
      uid,
      action,
      changed,
      before,
      after
    });
  } catch (error) {
    console.error('[reset-key] failed', error);
    return send(res, 500, {
      ok: false,
      error: error.message || 'Key reset failed.'
    });
  }
};
