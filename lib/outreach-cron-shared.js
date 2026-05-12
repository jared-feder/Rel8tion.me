const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

function send(res, status, payload) {
  res.status(status).json(payload);
}

function readJsonBody(req) {
  if (!req.body) return {};
  if (typeof req.body === 'object') return req.body;
  try {
    return JSON.parse(req.body);
  } catch {
    return {};
  }
}

function cronAuthorized(req) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return { ok: false, error: 'Missing CRON_SECRET. Refusing to expose outreach cron publicly.' };
  }
  const header = req.headers?.authorization || req.headers?.Authorization || '';
  if (header !== `Bearer ${secret}`) {
    return { ok: false, error: 'Unauthorized.' };
  }
  return { ok: true };
}

function requireSupabaseConfig() {
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
    throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.');
  }
}

function edgeFunctionUrl(functionName, overrideEnvName) {
  requireSupabaseConfig();
  const override = overrideEnvName ? process.env[overrideEnvName] : '';
  return override || `${SUPABASE_URL.replace(/\/$/, '')}/functions/v1/${functionName}`;
}

async function callSupabaseFunction(functionName, body = {}, overrideEnvName = '') {
  const response = await fetch(edgeFunctionUrl(functionName, overrideEnvName), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SERVICE_ROLE_KEY}`
    },
    body: JSON.stringify(body)
  });
  const raw = await response.text().catch(() => '');
  let payload = null;
  try {
    payload = raw ? JSON.parse(raw) : null;
  } catch {
    payload = { raw };
  }
  if (!response.ok) {
    const error = new Error(payload?.error || raw || `Function ${functionName} failed: ${response.status}`);
    error.status = response.status;
    error.payload = payload;
    throw error;
  }
  return payload;
}

async function supabaseRest(path, options = {}) {
  requireSupabaseConfig();
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
  if (!response.ok) throw new Error(raw || `Supabase request failed: ${response.status}`);
  return raw ? JSON.parse(raw) : null;
}

module.exports = {
  callSupabaseFunction,
  cronAuthorized,
  readJsonBody,
  send,
  supabaseRest
};
