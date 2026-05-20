const { sendJson, supabaseRest } = require('../lib/admin-auth');

function first(rows) {
  return Array.isArray(rows) && rows.length ? rows[0] : null;
}

function readQuery(req, name) {
  const value = req.query?.[name];
  if (Array.isArray(value)) return value[0] || '';
  if (value) return value;

  try {
    const url = new URL(req.url || '', 'https://rel8tion.local');
    return url.searchParams.get(name) || '';
  } catch {
    return '';
  }
}

function cleanId(value) {
  return String(value || '')
    .trim()
    .replace(/^\/+|\/+$/g, '')
    .slice(0, 120);
}

function validExternalUrl(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';

  try {
    const url = new URL(raw);
    if (!['http:', 'https:'].includes(url.protocol)) return '';
    return url.toString();
  } catch {
    return '';
  }
}

function setupContextUrl(event) {
  const context = event?.setup_context || {};
  return validExternalUrl(
    context.listing_url ||
    context.listing_link ||
    context.mls_url ||
    context.link ||
    context.url
  );
}

async function loadOpenHouse(openHouseId) {
  if (!openHouseId) return null;
  const rows = await supabaseRest(
    `open_houses?id=eq.${encodeURIComponent(openHouseId)}&select=id,address,link,source&limit=1`
  );
  return first(rows);
}

async function loadEvent(eventId) {
  if (!eventId) return null;
  const rows = await supabaseRest(
    `open_house_events?id=eq.${encodeURIComponent(eventId)}&select=id,open_house_source_id,setup_context&limit=1`
  );
  return first(rows);
}

async function resolveListingUrl(id) {
  const directHouse = await loadOpenHouse(id).catch(() => null);
  const directUrl = validExternalUrl(directHouse?.link);
  if (directUrl) return directUrl;

  const event = await loadEvent(id).catch(() => null);
  const eventContextUrl = setupContextUrl(event);
  if (eventContextUrl) return eventContextUrl;

  const eventHouse = await loadOpenHouse(event?.open_house_source_id).catch(() => null);
  return validExternalUrl(eventHouse?.link);
}

module.exports = async function handler(req, res) {
  try {
    if (!['GET', 'HEAD'].includes(req.method || 'GET')) {
      res.setHeader('Allow', 'GET, HEAD');
      return sendJson(res, 405, { ok: false, error: 'Method not allowed.' });
    }

    const id = cleanId(readQuery(req, 'id'));
    if (!id) {
      return sendJson(res, 400, { ok: false, error: 'Missing listing id.' });
    }

    const targetUrl = await resolveListingUrl(id);
    if (!targetUrl) {
      return sendJson(res, 404, { ok: false, error: 'No listing link is saved for this open house.' });
    }

    res.setHeader('Cache-Control', 'public, max-age=300, s-maxage=300');
    res.writeHead(302, { Location: targetUrl });
    return res.end();
  } catch (error) {
    return sendJson(res, error.status || 500, {
      ok: false,
      error: error.message || 'Unable to open listing link.'
    });
  }
};
