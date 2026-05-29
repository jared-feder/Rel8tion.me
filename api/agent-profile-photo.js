const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const PROFILE_BUCKET = process.env.SUPABASE_AGENT_IMAGE_BUCKET || 'agent-images';

function sendJson(res, status, payload) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(payload));
}

async function readBody(req) {
  if (req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body)) return req.body;
  if (Buffer.isBuffer(req.body)) return JSON.parse(req.body.toString('utf8') || '{}');
  if (typeof req.body === 'string') return JSON.parse(req.body || '{}');

  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
}

function assertConfig() {
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
    throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.');
  }
}

function cleanSlug(value) {
  const slug = String(value || '').trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9-]{0,90}$/.test(slug)) return '';
  return slug;
}

function cleanUid(value) {
  return String(value || '').trim().slice(0, 120);
}

function fileExt({ fileName = '', contentType = '' }) {
  const fromName = String(fileName || '').split('.').pop().toLowerCase();
  if (['jpg', 'jpeg', 'png', 'webp', 'heic'].includes(fromName)) return fromName === 'jpeg' ? 'jpg' : fromName;
  if (/png/i.test(contentType)) return 'png';
  if (/webp/i.test(contentType)) return 'webp';
  if (/heic|heif/i.test(contentType)) return 'heic';
  return 'jpg';
}

function decodePhoto(value) {
  const raw = String(value || '');
  const base64 = raw.includes(',') ? raw.split(',').pop() : raw;
  if (!base64) throw new Error('Missing photo data.');
  return Buffer.from(base64, 'base64');
}

async function supabaseFetch(path, options = {}) {
  assertConfig();
  const response = await fetch(`${SUPABASE_URL.replace(/\/$/, '')}${path}`, {
    ...options,
    headers: {
      apikey: SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
      ...(options.headers || {})
    }
  });
  const raw = await response.text().catch(() => '');
  let payload = null;
  try { payload = raw ? JSON.parse(raw) : null; } catch { payload = { raw }; }
  if (!response.ok) {
    const error = new Error(payload?.message || payload?.error || raw || `Supabase request failed: ${response.status}`);
    error.status = response.status;
    error.payload = payload;
    throw error;
  }
  return payload;
}

async function assertUidCanWriteSlug(uid, slug) {
  if (!uid) return;
  const rows = await supabaseFetch(`/rest/v1/keys?uid=eq.${encodeURIComponent(uid)}&select=uid,claimed,agent_slug&limit=1`);
  const key = Array.isArray(rows) && rows.length ? rows[0] : null;
  if (key?.claimed === true && key.agent_slug && key.agent_slug !== slug) {
    const error = new Error('This chip is already claimed to a different profile.');
    error.status = 409;
    throw error;
  }
}

async function patchAgentPhoto(slug, publicUrl) {
  await supabaseFetch(`/rest/v1/agents?slug=eq.${encodeURIComponent(slug)}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      Prefer: 'return=minimal'
    },
    body: JSON.stringify({ image_url: publicUrl })
  }).catch(() => null);
}

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    res.setHeader('Allow', 'POST, OPTIONS');
    return sendJson(res, 200, { ok: true });
  }
  if (req.method !== 'POST') return sendJson(res, 405, { ok: false, error: 'Method not allowed.' });

  try {
    assertConfig();
    const body = await readBody(req);
    const slug = cleanSlug(body.slug);
    const uid = cleanUid(body.uid);
    const contentType = String(body.contentType || 'image/jpeg').toLowerCase();
    if (!slug) return sendJson(res, 400, { ok: false, error: 'Missing or invalid slug.' });
    if (!/^image\/(jpeg|jpg|png|webp|heic|heif)$/i.test(contentType)) {
      return sendJson(res, 400, { ok: false, error: 'Unsupported image type.' });
    }

    await assertUidCanWriteSlug(uid, slug);

    const buffer = decodePhoto(body.photo || body.dataUrl || body.base64);
    if (!buffer.length) return sendJson(res, 400, { ok: false, error: 'Missing photo data.' });
    if (buffer.length > 6 * 1024 * 1024) {
      return sendJson(res, 413, { ok: false, error: 'Photo is too large. Please choose a smaller image.' });
    }

    const ext = fileExt({ fileName: body.fileName, contentType });
    const storagePath = `${slug}.${ext}`;
    await supabaseFetch(`/storage/v1/object/${encodeURIComponent(PROFILE_BUCKET)}/${encodeURIComponent(storagePath)}`, {
      method: 'POST',
      headers: {
        'Content-Type': contentType,
        'x-upsert': 'true',
        'Cache-Control': '3600'
      },
      body: buffer
    });

    const publicUrl = `${SUPABASE_URL.replace(/\/$/, '')}/storage/v1/object/public/${encodeURIComponent(PROFILE_BUCKET)}/${encodeURIComponent(storagePath)}?v=${Date.now()}`;
    await patchAgentPhoto(slug, publicUrl);
    return sendJson(res, 200, { ok: true, publicUrl, path: storagePath });
  } catch (error) {
    const status = error.status || 500;
    return sendJson(res, status, { ok: false, error: error.message || 'Photo upload failed.' });
  }
};
