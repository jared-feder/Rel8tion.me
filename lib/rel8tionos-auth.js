const crypto = require('crypto');

const API_VERSION = '2026-07-15';

function clean(value) {
  return String(value || '').trim();
}

function readHeader(req, name) {
  return req.headers?.[name] || req.headers?.[name.toLowerCase()] || req.headers?.[name.toUpperCase()] || '';
}

function bearerToken(req) {
  return clean(readHeader(req, 'authorization')).replace(/^Bearer\s+/i, '').trim();
}

function apiToken(req) {
  return clean(readHeader(req, 'x-rel8tionos-key')) || bearerToken(req);
}

function secureEqual(left, right) {
  const leftHash = crypto.createHash('sha256').update(clean(left)).digest();
  const rightHash = crypto.createHash('sha256').update(clean(right)).digest();
  return crypto.timingSafeEqual(leftHash, rightHash);
}

function configuredKeys() {
  return [
    { id: 'primary', value: clean(process.env.REL8TIONOS_API_KEY) },
    { id: 'previous', value: clean(process.env.REL8TIONOS_API_PREVIOUS_KEY) }
  ].filter((item) => item.value);
}

function authorizeRel8tionOs(req) {
  const keys = configuredKeys();
  if (!keys.length) {
    return { ok: false, status: 503, error: 'Rel8tionOS API is not configured.' };
  }

  const token = apiToken(req);
  if (!token) {
    return { ok: false, status: 401, error: 'Missing Rel8tionOS API credential.' };
  }

  const matched = keys.find((item) => secureEqual(token, item.value));
  if (!matched) {
    return { ok: false, status: 401, error: 'Unauthorized.' };
  }

  return { ok: true, key_id: matched.id };
}

function requestId(req) {
  return clean(readHeader(req, 'x-request-id')).slice(0, 120) || crypto.randomUUID();
}

function sendJson(res, status, payload, id) {
  res.setHeader('Cache-Control', 'no-store, no-cache, max-age=0, must-revalidate');
  res.setHeader('Vary', 'Authorization, X-Rel8tionOS-Key');
  res.setHeader('X-Rel8tionOS-API-Version', API_VERSION);
  if (id) res.setHeader('X-Request-Id', id);
  res.status(status).json({
    api_version: API_VERSION,
    request_id: id || null,
    ...payload
  });
}

function authorizeOrRespond(req, res, id) {
  const auth = authorizeRel8tionOs(req);
  if (auth.ok) return auth;
  sendJson(res, auth.status || 401, { ok: false, error: auth.error }, id);
  return null;
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

function readQuery(req, name) {
  const value = req.query?.[name];
  if (Array.isArray(value)) return value[0] || '';
  return value || '';
}

function httpError(status, message, code = '') {
  const error = new Error(message);
  error.status = status;
  error.code = code || undefined;
  error.expose = true;
  return error;
}

function sendError(res, error, id) {
  const sourceStatus = Number(error?.status) || 500;
  const exposed = error?.expose === true;
  const status = exposed ? sourceStatus : sourceStatus === 401 || sourceStatus === 403 ? sourceStatus : 502;
  sendJson(res, status, {
    ok: false,
    error: exposed ? error.message : 'REL8TION could not complete the request.',
    code: exposed ? error?.code || undefined : 'upstream_error'
  }, id);
}

module.exports = {
  API_VERSION,
  authorizeOrRespond,
  authorizeRel8tionOs,
  httpError,
  readJsonBody,
  readQuery,
  requestId,
  sendError,
  sendJson
};
