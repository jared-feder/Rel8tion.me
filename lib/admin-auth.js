const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ADMIN_TOKEN = process.env.KEY_RESET_ADMIN_TOKEN || process.env.ADMIN_TOKEN || '';

function parseAdminUids() {
  return new Set(
    String(process.env.ADMIN_KEYCHAIN_UIDS || '')
      .split(/[\s,;]+/)
      .map((value) => value.trim())
      .filter(Boolean)
  );
}

function readHeader(req, name) {
  return req.headers?.[name] || req.headers?.[name.toLowerCase()] || req.headers?.[name.toUpperCase()] || '';
}

function readQuery(req, name) {
  const query = req.query || {};
  const value = query[name];
  if (Array.isArray(value)) return value[0] || '';
  if (value) return value;

  try {
    const url = new URL(req.url || '', 'https://rel8tion.local');
    return url.searchParams.get(name) || '';
  } catch {
    return '';
  }
}

function bearerToken(req) {
  return String(readHeader(req, 'authorization')).replace(/^Bearer\s+/i, '').trim();
}

function adminCredential(req) {
  const uid =
    String(readHeader(req, 'x-admin-uid') || readQuery(req, 'uid') || readQuery(req, 'admin_uid') || '')
      .trim();
  const token =
    String(readHeader(req, 'x-admin-token') || bearerToken(req) || readQuery(req, 'token') || readQuery(req, 'admin_token') || '')
      .trim();

  return { uid, token };
}

function adminAuthorized(req) {
  const { uid, token } = adminCredential(req);
  const allowedUids = parseAdminUids();

  if (ADMIN_TOKEN && token && token === ADMIN_TOKEN) {
    return { ok: true, method: 'token', uid: uid || null };
  }

  if (uid && allowedUids.has(uid)) {
    return { ok: true, method: 'uid', uid };
  }

  return { ok: false, error: 'Unauthorized.' };
}

function assertAdminConfig() {
  if (!ADMIN_TOKEN && parseAdminUids().size === 0) {
    throw new Error('Missing KEY_RESET_ADMIN_TOKEN or ADMIN_KEYCHAIN_UIDS.');
  }
}

function assertSupabaseConfig() {
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
    throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.');
  }
}

function sendJson(res, status, payload) {
  res.status(status).json(payload);
}

async function supabaseRest(path, options = {}) {
  assertSupabaseConfig();

  const response = await fetch(`${SUPABASE_URL.replace(/\/$/, '')}/rest/v1/${path}`, {
    ...options,
    headers: {
      apikey: SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json',
      ...(options.headers || {})
    }
  });

  const raw = await response.text().catch(() => '');
  let payload = null;
  try {
    payload = raw ? JSON.parse(raw) : null;
  } catch {
    payload = { raw };
  }

  if (!response.ok) {
    const error = new Error(payload?.message || payload?.error || raw || `Supabase request failed: ${response.status}`);
    error.status = response.status;
    error.payload = payload;
    throw error;
  }

  return payload;
}

module.exports = {
  adminAuthorized,
  assertAdminConfig,
  sendJson,
  supabaseRest
};
