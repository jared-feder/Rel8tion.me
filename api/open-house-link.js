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

function esc(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
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

function firstPresent(...values) {
  return values.find((value) => value !== undefined && value !== null && String(value).trim() !== '') || '';
}

function money(value) {
  const number = Number(String(value || '').replace(/[$,]/g, ''));
  if (!Number.isFinite(number) || number <= 0) return '';
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0
  }).format(number);
}

function eventWindow(house, event) {
  const startValue = firstPresent(house?.open_start, event?.start_time);
  const endValue = firstPresent(house?.open_end, event?.end_time);
  const start = startValue ? new Date(startValue) : null;
  const end = endValue ? new Date(endValue) : null;
  if (!start || Number.isNaN(start.getTime())) return '';

  const date = new Intl.DateTimeFormat('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    timeZone: 'America/New_York'
  }).format(start);
  const startTime = new Intl.DateTimeFormat('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'America/New_York'
  }).format(start).replace(':00', '');
  const endTime = end && !Number.isNaN(end.getTime())
    ? new Intl.DateTimeFormat('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      timeZone: 'America/New_York'
    }).format(end).replace(':00', '')
    : '';

  return `${date} ${startTime}${endTime ? ` - ${endTime}` : ''}`;
}

function propertyImage(house) {
  return validExternalUrl(firstPresent(
    house?.image,
    house?.image_url,
    house?.listing_photo_url,
    house?.primary_photo_url,
    house?.photo_url,
    house?.thumbnail_url
  ));
}

async function loadOpenHouse(openHouseId) {
  if (!openHouseId) return null;
  const select = [
    'id',
    'address',
    'link',
    'source',
    'image',
    'price',
    'beds',
    'baths',
    'sqft',
    'open_start',
    'open_end',
    'brokerage',
    'agent',
    'agent_phone',
    'description'
  ].join(',');
  const rows = await supabaseRest(
    `open_houses?id=eq.${encodeURIComponent(openHouseId)}&select=${select}&limit=1`
  );
  return first(rows);
}

async function loadEvent(eventId) {
  if (!eventId) return null;
  const rows = await supabaseRest(
    `open_house_events?id=eq.${encodeURIComponent(eventId)}&select=id,open_house_source_id,host_agent_slug,setup_context,start_time,end_time&limit=1`
  );
  return first(rows);
}

async function resolveListing(id) {
  const directHouse = await loadOpenHouse(id).catch(() => null);
  if (directHouse) {
    return {
      house: directHouse,
      event: null,
      targetUrl: validExternalUrl(directHouse.link)
    };
  }

  const event = await loadEvent(id).catch(() => null);
  const eventHouse = await loadOpenHouse(event?.open_house_source_id).catch(() => null);
  return {
    house: eventHouse,
    event,
    targetUrl: setupContextUrl(event) || validExternalUrl(eventHouse?.link)
  };
}

function renderListingPage({ id, house, event, targetUrl }) {
  const context = event?.setup_context || {};
  const address = firstPresent(house?.address, context.address, 'Open house listing');
  const price = money(firstPresent(house?.price, context.price));
  const beds = firstPresent(house?.beds, context.beds);
  const baths = firstPresent(house?.baths, context.baths);
  const sqft = firstPresent(house?.sqft, context.sqft);
  const brokerage = firstPresent(house?.brokerage, context.detected_brokerage, context.brokerage);
  const agent = firstPresent(house?.agent, context.agent_name, event?.host_agent_slug);
  const windowText = eventWindow(house, event);
  const image = propertyImage(house);
  const details = [
    price,
    beds ? `${beds} beds` : '',
    baths ? `${baths} baths` : '',
    sqft ? `${sqft} sqft` : ''
  ].filter(Boolean).join(' | ');

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${esc(address)} | REL8TION</title>
  <style>
    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-height: 100vh;
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      color: #17224f;
      background: linear-gradient(180deg, #69d9f6 0%, #eaf9ff 38%, #f4fbff 100%);
    }
    main { width: min(920px, calc(100% - 28px)); margin: 0 auto; padding: 28px 0 38px; }
    .brand { display: flex; align-items: center; justify-content: space-between; gap: 16px; margin-bottom: 18px; }
    .brand img { height: 44px; width: auto; }
    .pill { border: 1px solid rgba(255,255,255,.8); border-radius: 999px; background: rgba(255,255,255,.68); padding: 10px 14px; font-size: 12px; font-weight: 900; letter-spacing: .12em; text-transform: uppercase; color: #475569; }
    .card { overflow: hidden; border: 1px solid rgba(255,255,255,.78); border-radius: 34px; background: rgba(255,255,255,.82); box-shadow: 0 24px 64px rgba(31,42,90,.14); }
    .hero { width: 100%; aspect-ratio: 16 / 10; background: #e2e8f0; object-fit: cover; display: block; }
    .fallback { display:flex; align-items:center; justify-content:center; width:100%; aspect-ratio:16/10; background:rgba(241,245,249,.92); color:#94a3b8; font-weight:900; letter-spacing:.12em; text-transform:uppercase; }
    .body { padding: 24px; }
    h1 { margin: 0 0 12px; font-size: clamp(34px, 8vw, 64px); line-height: .94; letter-spacing: 0; color: #1f2a5a; }
    .meta { display: flex; flex-wrap: wrap; gap: 10px; margin: 18px 0; }
    .chip { border-radius: 999px; background: #f8fafc; border: 1px solid #e2e8f0; padding: 10px 13px; font-size: 14px; font-weight: 800; color: #334155; }
    .sub { font-size: 17px; font-weight: 700; line-height: 1.45; color: #475569; }
    .actions { display: grid; grid-template-columns: 1fr; gap: 12px; margin-top: 22px; }
    a.button { display: flex; align-items: center; justify-content: center; min-height: 54px; border-radius: 999px; padding: 14px 18px; text-decoration: none; font-size: 16px; font-weight: 900; }
    .primary { background: linear-gradient(90deg, #1f2a5a, #2563eb); color: white; box-shadow: 0 18px 38px rgba(37,99,235,.22); }
    .secondary { background: #fff; color: #334155; border: 1px solid #e2e8f0; }
    .note { margin-top: 14px; font-size: 12px; font-weight: 800; color: #64748b; line-height: 1.4; }
    @media (min-width: 720px) { .actions { grid-template-columns: ${targetUrl ? '1.1fr .9fr' : '1fr'}; } .body { padding: 34px; } }
  </style>
</head>
<body>
  <main>
    <div class="brand">
      <img src="https://rel8tion.me/wp-content/uploads/2026/04/logo150x100trans.png" alt="REL8TION">
      <div class="pill">Open House</div>
    </div>
    <section class="card">
      ${image ? `<img class="hero" src="${esc(image)}" alt="${esc(address)}">` : '<div class="fallback">Property</div>'}
      <div class="body">
        <h1>${esc(address)}</h1>
        <div class="sub">${esc([windowText, brokerage, agent].filter(Boolean).join(' | '))}</div>
        <div class="meta">
          ${details ? `<span class="chip">${esc(details)}</span>` : ''}
          ${house?.source ? `<span class="chip">${esc(house.source)}</span>` : ''}
          <span class="chip">REL8TION link ${esc(id)}</span>
        </div>
        <div class="actions">
          ${targetUrl ? `<a class="button primary" href="${esc(targetUrl)}" rel="noopener noreferrer">Open MLS Listing</a>` : ''}
          <a class="button secondary" href="/" rel="noopener">REL8TION</a>
        </div>
        <div class="note">${targetUrl ? 'If the MLS page is blocked or unavailable, this REL8TION page still preserves the open-house details from the check-in.' : 'No external MLS page is saved for this open house yet.'}</div>
      </div>
    </section>
  </main>
</body>
</html>`;
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

    const listing = await resolveListing(id);
    const targetUrl = listing.targetUrl || '';

    if (readQuery(req, 'direct') === '1') {
      if (!targetUrl) {
        return sendJson(res, 404, { ok: false, error: 'No listing link is saved for this open house.' });
      }
      res.setHeader('Cache-Control', 'public, max-age=300, s-maxage=300');
      res.writeHead(302, { Location: targetUrl });
      return res.end();
    }

    if (!listing.house && !listing.event) {
      return sendJson(res, 404, { ok: false, error: 'No open house was found for this link.' });
    }

    res.setHeader('Cache-Control', 'public, max-age=300, s-maxage=300');
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.status(200).send(renderListingPage({ id, ...listing }));
  } catch (error) {
    return sendJson(res, error.status || 500, {
      ok: false,
      error: error.message || 'Unable to open listing link.'
    });
  }
};
