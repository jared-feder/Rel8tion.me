const { sendJson, supabaseRest } = require('../lib/admin-auth');

const LOGO_URL = 'https://rel8tion.me/wp-content/uploads/2026/04/logo150x100trans.png';

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

function readHeader(req, name) {
  return req.headers?.[name] || req.headers?.[name.toLowerCase()] || req.headers?.[name.toUpperCase()] || '';
}

function requestOrigin(req) {
  const host = readHeader(req, 'x-forwarded-host') || readHeader(req, 'host') || 'app.rel8tion.me';
  const proto = readHeader(req, 'x-forwarded-proto') || 'https';
  return `${proto}://${host}`;
}

function cleanToken(value) {
  return String(value || '')
    .trim()
    .replace(/^\/+|\/+$/g, '')
    .replace(/[^a-zA-Z0-9_-]/g, '')
    .slice(0, 120);
}

function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || ''));
}

function isOutreachCode(value) {
  return /^[a-z0-9_-]{6,8}$/i.test(String(value || ''));
}

function esc(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function firstPresent(...values) {
  return values.find((value) => value !== undefined && value !== null && String(value).trim() !== '') || '';
}

function validHttpUrl(value) {
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

function formatOpenHouse(openStart, openEnd) {
  const start = openStart ? new Date(openStart) : null;
  const end = openEnd ? new Date(openEnd) : null;
  if (!start || Number.isNaN(start.getTime())) return '';

  const date = new Intl.DateTimeFormat('en-US', {
    weekday: 'long',
    month: 'short',
    day: 'numeric',
    timeZone: 'America/New_York'
  }).format(start);

  const startTime = new Intl.DateTimeFormat('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    timeZone: 'America/New_York'
  }).format(start).replace(':00', '');

  const endTime = end && !Number.isNaN(end.getTime())
    ? new Intl.DateTimeFormat('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
      timeZone: 'America/New_York'
    }).format(end).replace(':00', '')
    : '';

  return `${date} at ${startTime}${endTime ? `-${endTime}` : ''}`;
}

function shortAddress(address) {
  const raw = String(address || '').trim();
  if (!raw) return 'Open house';
  return raw.replace(/,\s*[A-Z]{2}\s+\d{5}(?:-\d{4})?$/i, '').trim();
}

async function fetchQueueRow(filter) {
  const select = [
    'id',
    'outreach_code',
    'open_house_id',
    'agent_name',
    'brokerage',
    'address',
    'city',
    'state',
    'zip',
    'open_start',
    'open_end',
    'listing_photo_url',
    'mockup_image_url',
    'agent_photo_url',
    'selected_sms',
    'followup_sms',
    'template_key',
    'review_status',
    'initial_send_status',
    'followup_send_status'
  ].join(',');

  const rows = await supabaseRest(
    `agent_outreach_queue?${filter}&select=${select}&limit=1`
  );
  return Array.isArray(rows) && rows.length ? rows[0] : null;
}

async function loadQueueRow(token) {
  const clean = String(token || '').trim();

  if (isOutreachCode(clean)) {
    const byCode = await fetchQueueRow(`outreach_code=eq.${encodeURIComponent(clean.toLowerCase())}`);
    if (byCode) return byCode;
  }

  if (isUuid(clean)) {
    return fetchQueueRow(`id=eq.${encodeURIComponent(clean)}`);
  }

  return null;
}

function previewToken(row) {
  return row.outreach_code || row.id;
}

function renderPreviewPage({ req, row }) {
  const origin = requestOrigin(req);
  const pageUrl = `${origin}/o/${encodeURIComponent(previewToken(row))}`;
  const address = shortAddress(row.address);
  const when = formatOpenHouse(row.open_start, row.open_end);
  const agentName = firstPresent(row.agent_name, 'the listing agent');
  const brokerage = firstPresent(row.brokerage);
  const previewImage = validHttpUrl(row.mockup_image_url) || validHttpUrl(row.listing_photo_url) || LOGO_URL;
  const listingImage = validHttpUrl(row.listing_photo_url);
  const title = `${address} | Rel8tion Open House Preview`;
  const description = [
    'Rel8tion open-house support preview',
    agentName ? `for ${agentName}` : '',
    when ? `on ${when}` : ''
  ].filter(Boolean).join(' ');
  const displayMeta = [when, brokerage, agentName].filter(Boolean).join(' | ');
  const message = firstPresent(row.selected_sms, row.followup_sms);

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${esc(title)}</title>
  <meta name="description" content="${esc(description)}">
  <meta property="og:type" content="website">
  <meta property="og:site_name" content="Rel8tion">
  <meta property="og:url" content="${esc(pageUrl)}">
  <meta property="og:title" content="${esc(title)}">
  <meta property="og:description" content="${esc(description)}">
  <meta property="og:image" content="${esc(previewImage)}">
  <meta property="og:image:secure_url" content="${esc(previewImage)}">
  <meta property="og:image:alt" content="${esc(`Rel8tion outreach preview for ${address}`)}">
  <meta property="og:image:width" content="1200">
  <meta property="og:image:height" content="630">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="${esc(title)}">
  <meta name="twitter:description" content="${esc(description)}">
  <meta name="twitter:image" content="${esc(previewImage)}">
  <style>
    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-height: 100vh;
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      color: #17224f;
      background: linear-gradient(180deg, #69d9f6 0%, #eaf9ff 38%, #f4fbff 100%);
    }
    main { width: min(920px, calc(100% - 28px)); margin: 0 auto; padding: 28px 0 42px; }
    .brand { display: flex; align-items: center; justify-content: space-between; gap: 16px; margin-bottom: 18px; }
    .brand img { height: 44px; width: auto; }
    .pill { border: 1px solid rgba(255,255,255,.8); border-radius: 999px; background: rgba(255,255,255,.68); padding: 10px 14px; font-size: 12px; font-weight: 900; letter-spacing: .12em; text-transform: uppercase; color: #475569; }
    .card { overflow: hidden; border: 1px solid rgba(255,255,255,.78); border-radius: 32px; background: rgba(255,255,255,.84); box-shadow: 0 24px 64px rgba(31,42,90,.14); }
    .hero { width: 100%; aspect-ratio: 16 / 10; background: #e2e8f0; object-fit: cover; display: block; }
    .body { padding: 24px; }
    h1 { margin: 0 0 12px; font-size: clamp(34px, 8vw, 64px); line-height: .94; letter-spacing: 0; color: #1f2a5a; }
    .sub { font-size: 17px; font-weight: 800; line-height: 1.45; color: #475569; }
    .mockup { margin-top: 22px; border: 1px solid #e2e8f0; border-radius: 22px; overflow: hidden; background: #fff; }
    .mockup img { width: 100%; display: block; object-fit: cover; }
    .message { margin-top: 18px; border-radius: 20px; background: #f8fafc; border: 1px solid #e2e8f0; padding: 16px; color: #334155; font-size: 15px; font-weight: 700; line-height: 1.48; white-space: pre-wrap; }
    .note { margin-top: 14px; font-size: 12px; font-weight: 800; color: #64748b; line-height: 1.4; }
    @media (min-width: 720px) { .body { padding: 34px; } }
  </style>
</head>
<body>
  <main>
    <div class="brand">
      <img src="${esc(LOGO_URL)}" alt="Rel8tion">
      <div class="pill">Open House Preview</div>
    </div>
    <section class="card">
      <img class="hero" src="${esc(previewImage)}" alt="${esc(`Rel8tion outreach preview for ${address}`)}">
      <div class="body">
        <h1>${esc(address)}</h1>
        ${displayMeta ? `<div class="sub">${esc(displayMeta)}</div>` : ''}
        ${listingImage && listingImage !== previewImage ? `<div class="mockup"><img src="${esc(listingImage)}" alt="${esc(address)}"></div>` : ''}
        ${message ? `<div class="message">${esc(message)}</div>` : ''}
        <div class="note">Rel8tion preview links are used so SMS apps can display the open-house image preview when rich link previews are supported.</div>
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

    const token = cleanToken(readQuery(req, 'id'));
    if (!token) {
      return sendJson(res, 400, { ok: false, error: 'Missing outreach preview code.' });
    }

    const row = await loadQueueRow(token);
    if (!row) {
      return sendJson(res, 404, { ok: false, error: 'No outreach preview was found.' });
    }

    const pageUrl = `${requestOrigin(req)}/o/${encodeURIComponent(previewToken(row))}`;
    const previewImage = validHttpUrl(row.mockup_image_url) || validHttpUrl(row.listing_photo_url) || LOGO_URL;

    if (readQuery(req, 'format') === 'json') {
      return sendJson(res, 200, {
        ok: true,
        id: row.id,
        outreach_code: row.outreach_code || null,
        url: pageUrl,
        og_image: previewImage,
        address: row.address || '',
        agent_name: row.agent_name || '',
        brokerage: row.brokerage || '',
        open_start: row.open_start || null,
      });
    }

    res.setHeader('Cache-Control', 'public, max-age=300, s-maxage=3600');
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.status(200).send(renderPreviewPage({ req, row }));
  } catch (error) {
    return sendJson(res, error.status || 500, {
      ok: false,
      error: error.message || 'Unable to render outreach preview.'
    });
  }
};
