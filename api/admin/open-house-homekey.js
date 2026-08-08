const crypto = require('node:crypto');
const QRCode = require('qrcode');
const { adminAuthorized, sendJson, supabaseRest } = require('../../lib/admin-auth');

function clean(value, max = 300) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, max);
}

function one(rows) {
  return Array.isArray(rows) ? rows[0] || null : null;
}

function readQuery(req, name) {
  const value = req.query?.[name];
  if (Array.isArray(value)) return value[0] || '';
  if (value) return value;
  try {
    return new URL(req.url || '', 'https://rel8tion.local').searchParams.get(name) || '';
  } catch {
    return '';
  }
}

function publicOrigin() {
  return clean(process.env.PUBLIC_APP_URL || process.env.REL8TION_APP_URL || 'https://app.rel8tion.me', 500).replace(/\/$/, '');
}

function homeKeyUrl(code) {
  return `${publicOrigin()}/h/${encodeURIComponent(code)}`;
}

function safeFilename(value) {
  return clean(value, 120)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 72) || 'homekey';
}

function attributionKey({ openHouseId, visitId, eventId, listingAgentId, listingAgentFallback, loanOfficerUid }) {
  return crypto.createHash('sha256').update([
    'homekey-v1',
    clean(openHouseId, 160),
    clean(visitId || 'no-visit', 160),
    clean(eventId || 'no-event', 160),
    clean(listingAgentId || listingAgentFallback || 'no-agent', 240).toLowerCase(),
    clean(loanOfficerUid || 'no-lo', 160)
  ].join('|')).digest('hex');
}

function randomPublicCode() {
  return crypto.randomBytes(12).toString('base64url');
}

function dateDistance(value, target) {
  const time = new Date(value || 0).getTime();
  if (!Number.isFinite(time)) return Number.MAX_SAFE_INTEGER;
  if (!Number.isFinite(target)) return -time;
  return Math.abs(time - target);
}

async function loadOpenHouse(openHouseId) {
  return one(await supabaseRest(`open_houses?id=eq.${encodeURIComponent(openHouseId)}&select=*&limit=1`));
}

async function loadPropertyProfile(openHouseId) {
  return one(await supabaseRest(`open_house_property_profiles?open_house_id=eq.${encodeURIComponent(openHouseId)}&select=address,city,state,zip,primary_image,images,agent_name,agent_phone,agent_email,brokerage,open_start&limit=1`).catch(() => []));
}

async function resolveVisit(openHouseId, requestedVisitId, targetStart) {
  if (requestedVisitId) {
    const visit = one(await supabaseRest(`field_demo_visits?id=eq.${encodeURIComponent(requestedVisitId)}&status=neq.cancelled&select=*&limit=1`));
    if (!visit || String(visit.open_house_id || '') !== String(openHouseId)) {
      const error = new Error('That field visit is not linked to this open house.');
      error.status = 409;
      throw error;
    }
    return visit;
  }

  const rows = await supabaseRest(`field_demo_visits?open_house_id=eq.${encodeURIComponent(openHouseId)}&status=neq.cancelled&select=*&order=scheduled_start.desc&limit=20`).catch(() => []);
  const target = new Date(targetStart || 0).getTime();
  return [...(rows || [])].sort((a, b) => dateDistance(a.scheduled_start, target) - dateDistance(b.scheduled_start, target))[0] || null;
}

async function resolveAttribution(house, profile, visit) {
  const agent = one(await supabaseRest(`listing_agents?open_house_id=eq.${encodeURIComponent(house.id)}&select=*&order=is_primary.desc.nullslast,created_at.asc&limit=1`).catch(() => []));
  const participant = visit?.id ? one(await supabaseRest(
    `field_demo_visit_participants?field_demo_visit_id=eq.${encodeURIComponent(visit.id)}&role=eq.loan_officer&status=neq.cancelled&select=*&order=is_primary.desc,created_at.asc&limit=1`
  ).catch(() => [])) : null;
  const session = !participant && visit?.open_house_event_id ? one(await supabaseRest(
    `event_loan_officer_sessions?open_house_event_id=eq.${encodeURIComponent(visit.open_house_event_id)}&select=*&order=signed_in_at.desc.nullslast,created_at.desc&limit=1`
  ).catch(() => [])) : null;
  const loanOfficerUid = clean(
    participant?.participant_profile_id || participant?.participant_uid || session?.verified_profile_uid || session?.loan_officer_uid,
    160
  );
  const loanOfficer = loanOfficerUid ? one(await supabaseRest(
    `verified_profiles?uid=eq.${encodeURIComponent(loanOfficerUid)}&select=*&limit=1`
  ).catch(() => [])) : null;

  return {
    listingAgent: {
      ...(agent || {}),
      id: agent?.id || null,
      name: agent?.name || profile?.agent_name || house.agent || '',
      phone: agent?.phone || profile?.agent_phone || house.agent_phone || '',
      email: agent?.email || profile?.agent_email || house.agent_email || '',
      brokerage: agent?.brokerage || profile?.brokerage || house.brokerage || ''
    },
    loanOfficer,
    loanOfficerUid: loanOfficer?.uid || loanOfficerUid || null
  };
}

async function findHomeKey(key) {
  return one(await supabaseRest(`property_keepsakes?attribution_key=eq.${encodeURIComponent(key)}&select=*&limit=1`).catch(() => []));
}

async function createHomeKey(payload) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return one(await supabaseRest('property_keepsakes', {
        method: 'POST',
        headers: { Prefer: 'return=representation' },
        body: JSON.stringify({ ...payload, public_code: randomPublicCode() })
      }));
    } catch (error) {
      const existing = await findHomeKey(payload.attribution_key);
      if (existing) return existing;
      if (attempt === 2) throw error;
    }
  }
  return null;
}

async function buildHomeKey(openHouseId, requestedVisitId, auth) {
  const [house, profile] = await Promise.all([
    loadOpenHouse(openHouseId),
    loadPropertyProfile(openHouseId)
  ]);
  if (!house) {
    const error = new Error('Open house not found.');
    error.status = 404;
    throw error;
  }

  const visit = await resolveVisit(openHouseId, requestedVisitId, profile?.open_start || house.open_start);
  const attribution = await resolveAttribution(house, profile, visit);
  const key = attributionKey({
    openHouseId,
    visitId: visit?.id,
    eventId: visit?.open_house_event_id,
    listingAgentId: attribution.listingAgent?.id,
    listingAgentFallback: `${attribution.listingAgent?.name || ''}|${attribution.listingAgent?.phone || ''}`,
    loanOfficerUid: attribution.loanOfficerUid
  });
  let homekey = await findHomeKey(key);
  const reused = Boolean(homekey);
  if (!homekey) {
    homekey = await createHomeKey({
      attribution_key: key,
      open_house_id: house.id,
      open_house_event_id: visit?.open_house_event_id || null,
      field_demo_visit_id: visit?.id || null,
      listing_agent_id: attribution.listingAgent?.id || null,
      loan_officer_uid: attribution.loanOfficerUid || null,
      status: 'active',
      created_by: auth.uid ? `admin_uid:${auth.uid}` : `admin_${auth.method || 'credential'}`
    });
  }
  if (!homekey?.public_code) throw new Error('HomeKey creation did not return a public code.');

  const url = homeKeyUrl(homekey.public_code);
  const qrDataUrl = await QRCode.toDataURL(url, {
    errorCorrectionLevel: 'H',
    margin: 4,
    width: 560,
    color: { dark: '#17224f', light: '#ffffff' }
  });
  return {
    reused,
    homekey,
    url,
    qr_data_url: qrDataUrl,
    property: {
      address: profile?.address || house.address || '',
      city: profile?.city || house.city || '',
      state: profile?.state || house.state || '',
      zip: profile?.zip || house.zip || '',
      photo_url: profile?.primary_image || house.image || ''
    },
    listing_agent: attribution.listingAgent,
    loan_officer: attribution.loanOfficer
  };
}

async function downloadPng(code, res) {
  const homekey = one(await supabaseRest(`property_keepsakes?public_code=eq.${encodeURIComponent(code)}&select=*&limit=1`));
  if (!homekey) return sendJson(res, 404, { ok: false, error: 'HomeKey not found.' });
  const house = await loadOpenHouse(homekey.open_house_id).catch(() => null);
  const url = homeKeyUrl(code);
  const png = await QRCode.toBuffer(url, {
    type: 'png',
    errorCorrectionLevel: 'H',
    margin: 4,
    width: 1600,
    color: { dark: '#17224f', light: '#ffffff' }
  });
  res.setHeader('Cache-Control', 'no-store, no-cache, max-age=0, must-revalidate');
  res.setHeader('Content-Type', 'image/png');
  res.setHeader('Content-Disposition', `attachment; filename="${safeFilename(house?.address || code)}-homekey-qr.png"`);
  res.setHeader('Content-Length', String(png.length));
  return res.status(200).send(png);
}

async function handler(req, res) {
  try {
    if (!['GET', 'POST'].includes(req.method || 'GET')) {
      res.setHeader('Allow', 'GET, POST');
      return sendJson(res, 405, { ok: false, error: 'Method not allowed.' });
    }
    const auth = adminAuthorized(req);
    if (!auth.ok) return sendJson(res, 401, { ok: false, error: auth.error });

    if (req.method === 'GET' && readQuery(req, 'format') === 'png') {
      const code = clean(readQuery(req, 'code'), 120);
      if (!code) return sendJson(res, 400, { ok: false, error: 'Missing HomeKey code.' });
      return downloadPng(code, res);
    }

    const openHouseId = clean(req.body?.open_house_id, 160);
    const fieldVisitId = clean(req.body?.field_visit_id, 160);
    if (!openHouseId) return sendJson(res, 400, { ok: false, error: 'Missing open_house_id.' });
    const result = await buildHomeKey(openHouseId, fieldVisitId, auth);
    return sendJson(res, 200, { ok: true, ...result });
  } catch (error) {
    return sendJson(res, error.status || 500, {
      ok: false,
      error: error.message || 'Unable to create the HomeKey.'
    });
  }
}

module.exports = handler;
module.exports.__test = { attributionKey, homeKeyUrl, publicOrigin, safeFilename };
