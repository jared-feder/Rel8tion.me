const { adminAuthorized, assertAdminConfig, sendJson, supabaseRest } = require('../../lib/admin-auth');

const EDITABLE_FIELDS = new Set([
  'name',
  'title',
  'brokerage',
  'email',
  'phone',
  'bio',
  'photo_url',
  'hero_image_url',
  'about_image_url',
  'facebook_url',
  'instagram_url',
  'linkedin_url'
]);

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

function cleanText(value, maxLength) {
  if (value === null) return null;
  return String(value ?? '').trim().slice(0, maxLength);
}

function cleanPhone(value) {
  const text = cleanText(value, 40);
  const digits = String(text || '').replace(/\D/g, '');
  if (digits && digits.length !== 10 && !(digits.length === 11 && digits.startsWith('1'))) {
    const error = new Error('Phone must contain 10 digits.');
    error.status = 400;
    throw error;
  }
  return text;
}

function cleanUrl(value) {
  const text = cleanText(value, 1200);
  if (!text) return null;
  try {
    const url = new URL(text);
    if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Invalid protocol');
    return url.toString();
  } catch (_) {
    const error = new Error(`Invalid URL: ${text}`);
    error.status = 400;
    throw error;
  }
}

function buildUpdates(fields) {
  const updates = {};
  for (const [key, value] of Object.entries(fields || {})) {
    if (!EDITABLE_FIELDS.has(key)) continue;
    if (key === 'phone') updates[key] = cleanPhone(value);
    else if (key.endsWith('_url')) updates[key] = cleanUrl(value);
    else updates[key] = cleanText(value, key === 'bio' ? 6000 : 500);
  }
  if (!Object.keys(updates).length) {
    const error = new Error('No editable website fields were provided.');
    error.status = 400;
    throw error;
  }
  updates.updated_at = new Date().toISOString();
  return updates;
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
    const websiteId = String(body.website_id || '').trim();
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(websiteId)) {
      const error = new Error('A valid website id is required.');
      error.status = 400;
      throw error;
    }

    const updates = buildUpdates(body.fields);
    const rows = await supabaseRest(`agent_websites?id=eq.${enc(websiteId)}`, {
      method: 'PATCH',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify(updates)
    });
    const website = Array.isArray(rows) ? rows[0] || null : null;
    if (!website) {
      const error = new Error('Agent website not found.');
      error.status = 404;
      throw error;
    }

    if (Object.prototype.hasOwnProperty.call(updates, 'phone')) {
      await supabaseRest(`agent_website_listings?agent_website_id=eq.${enc(websiteId)}`, {
        method: 'PATCH',
        body: JSON.stringify({ agent_phone: updates.phone, updated_at: updates.updated_at })
      });
    }

    const coreUpdates = {};
    for (const key of ['name', 'phone', 'email', 'brokerage']) {
      if (Object.prototype.hasOwnProperty.call(updates, key)) coreUpdates[key] = updates[key];
    }
    if (Object.prototype.hasOwnProperty.call(updates, 'photo_url')) coreUpdates.image_url = updates.photo_url;
    if (Object.prototype.hasOwnProperty.call(updates, 'phone')) {
      const digits = String(updates.phone || '').replace(/\D/g, '').replace(/^1(?=\d{10}$)/, '');
      coreUpdates.phone_normalized = digits || null;
    }
    if (Object.keys(coreUpdates).length && website.custom_domain) {
      await supabaseRest(`agents?website=eq.${enc(`https://${website.custom_domain}`)}`, {
        method: 'PATCH',
        body: JSON.stringify(coreUpdates)
      });
    }

    sendJson(res, 200, { ok: true, website });
  } catch (error) {
    sendJson(res, error.status || 500, {
      ok: false,
      error: error.message || 'Unable to update agent website.',
      details: error.payload || null
    });
  }
};
