const { adminAuthorized, assertAdminConfig, sendJson, supabaseRest } = require('../../lib/admin-auth');

const SETTING_KEY = 'outreach_operator_mode';

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

function normalizeMode(value) {
  const mode = String(value || '').trim().toLowerCase();
  return mode === 'away' ? 'away' : 'live';
}

async function readMode() {
  const rows = await supabaseRest(`rel8tion_runtime_settings?key=eq.${enc(SETTING_KEY)}&select=key,value,updated_at,updated_by&limit=1`);
  const row = Array.isArray(rows) ? rows[0] || null : null;
  const mode = normalizeMode(row?.value?.mode || row?.value);
  return {
    mode,
    updated_at: row?.updated_at || null,
    updated_by: row?.updated_by || null
  };
}

async function writeMode(mode, updatedBy) {
  const payload = {
    key: SETTING_KEY,
    value: { mode },
    updated_by: updatedBy || 'admin'
  };
  const rows = await supabaseRest('rel8tion_runtime_settings', {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates,return=representation' },
    body: JSON.stringify(payload)
  });
  const row = Array.isArray(rows) ? rows[0] || null : null;
  return {
    mode: normalizeMode(row?.value?.mode || mode),
    updated_at: row?.updated_at || null,
    updated_by: row?.updated_by || updatedBy || 'admin'
  };
}

module.exports = async function handler(req, res) {
  try {
    if (req.method !== 'GET' && req.method !== 'POST') {
      res.setHeader('Allow', 'GET, POST');
      sendJson(res, 405, { ok: false, error: 'Method not allowed.' });
      return;
    }

    assertAdminConfig();
    const auth = adminAuthorized(req);
    if (!auth.ok) {
      sendJson(res, 401, { ok: false, error: auth.error });
      return;
    }

    if (req.method === 'GET') {
      sendJson(res, 200, { ok: true, outreach_operator: await readMode() });
      return;
    }

    const body = parseBody(req);
    const mode = normalizeMode(body.mode);
    const updatedBy = auth.uid || auth.method || 'admin';
    sendJson(res, 200, { ok: true, outreach_operator: await writeMode(mode, updatedBy) });
  } catch (error) {
    sendJson(res, error.status || 500, {
      ok: false,
      error: error.message || 'Unable to update outreach operator mode.',
      details: error.payload || null
    });
  }
};
