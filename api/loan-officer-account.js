const { sendJson, supabaseRest } = require('../lib/admin-auth');
const crypto = require('crypto');

const clean = (value, max = 2000) => String(value || '').trim().slice(0, max);
const enc = (value) => encodeURIComponent(clean(value));
const validEmail = (value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clean(value, 320));

function bodyOf(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  try { return JSON.parse(req.body || '{}'); } catch (_) { return {}; }
}

async function authUser(token, url, key) {
  const response = await fetch(`${url}/auth/v1/user`, { headers:{ apikey:key, Authorization:`Bearer ${token}` } });
  const user = await response.json().catch(() => ({}));
  if (!response.ok || !user?.email) {
    const error = new Error('Your sign-in has expired. Please sign in again.');
    error.status = 401;
    throw error;
  }
  return user;
}

async function uploadHeadshot(dataUrl, profileUid, url, key) {
  if (!dataUrl) return '';
  const match = clean(dataUrl, 1500000).match(/^data:image\/(jpeg|jpg|png|webp);base64,([A-Za-z0-9+/=]+)$/);
  if (!match) throw Object.assign(new Error('Choose a valid JPG, PNG, or WebP headshot.'), { status:400 });
  const bytes = Buffer.from(match[2], 'base64');
  if (!bytes.length || bytes.length > 700000) throw Object.assign(new Error('The compressed headshot is too large.'), { status:400 });
  const type = match[1] === 'jpg' ? 'jpeg' : match[1];
  const extension = type === 'jpeg' ? 'jpg' : type;
  const path = `headshots/${profileUid}-${crypto.randomUUID()}.${extension}`;
  const response = await fetch(`${url}/storage/v1/object/verified-assets/${path}`, {
    method:'POST', headers:{ apikey:key, Authorization:`Bearer ${key}`, 'Content-Type':`image/${type}`, 'x-upsert':'false' }, body:bytes
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload?.message || payload?.error || 'Unable to upload the profile headshot.');
  return `${url}/storage/v1/object/public/verified-assets/${path}`;
}

async function profileForEmail(email) {
  const rows = await supabaseRest(`verified_profiles?email=ilike.${enc(email)}&is_active=eq.true&select=*&limit=1`);
  const profile = Array.isArray(rows) ? rows[0] || null : null;
  if (!profile?.uid || !/loan|mortgage/i.test(`${profile.industry || ''} ${profile.title || ''}`)) {
    const error = new Error('No approved loan officer profile matches this email.');
    error.status = 403;
    throw error;
  }
  return profile;
}

async function visitContexts(profile, rawIds) {
  const ids = [...new Set(clean(rawIds, 4000).split(',').map((id) => id.trim()).filter(Boolean))].slice(0, 50);
  if (!ids.length) return [];
  const participants = await supabaseRest(`field_demo_visit_participants?participant_profile_id=eq.${enc(profile.uid)}&field_demo_visit_id=in.(${ids.map(enc).join(',')})&select=field_demo_visit_id`);
  const allowed = new Set((Array.isArray(participants) ? participants : []).map((row) => row.field_demo_visit_id));
  if (!allowed.size) return [];
  const visits = await supabaseRest(`field_demo_visits?id=in.(${[...allowed].map(enc).join(',')})&select=id,outreach_queue_id,open_house_id,agent_name,agent_phone,agent_email,brokerage,notes`);
  const queueIds = [...new Set((Array.isArray(visits) ? visits : []).map((row) => row.outreach_queue_id).filter(Boolean))];
  const queues = queueIds.length ? await supabaseRest(`agent_outreach_queue?id=in.(${queueIds.map(enc).join(',')})&select=id,address,listing_photo_url,agent_name,agent_phone,agent_email,brokerage,open_house_id`) : [];
  const byQueue = new Map((Array.isArray(queues) ? queues : []).map((row) => [row.id, row]));
  return (Array.isArray(visits) ? visits : []).map((visit) => ({ visit_id:visit.id, ...byQueue.get(visit.outreach_queue_id), ...Object.fromEntries(Object.entries(visit).filter(([,value]) => value)) }));
}

module.exports = async function handler(req, res) {
  try {
    if (!['GET', 'PATCH'].includes(req.method)) {
      res.setHeader('Allow', 'GET, PATCH');
      sendJson(res, 405, { ok:false, error:'Method not allowed.' });
      return;
    }
    const token = clean(req.headers?.authorization, 4000).replace(/^Bearer\s+/i, '');
    if (!token) {
      sendJson(res, 401, { ok:false, error:'Sign in is required.' });
      return;
    }
    const url = clean(process.env.SUPABASE_URL, 500).replace(/\/$/, '');
    const key = clean(process.env.SUPABASE_SERVICE_ROLE_KEY, 2000);
    if (!url || !key) throw new Error('Supabase Auth is not configured.');
    const user = await authUser(token, url, key);
    let profile = await profileForEmail(user.email);
    if (req.method === 'GET') {
      const visitIds = clean(req.query?.visit_ids || new URL(req.url, 'https://rel8tion.local').searchParams.get('visit_ids'), 4000);
      const contexts = visitIds ? await visitContexts(profile, visitIds) : [];
      sendJson(res, 200, { ok:true, profile, visit_contexts:contexts });
      return;
    }
    const body = bodyOf(req);
    const nextEmail = clean(body.email || profile.email, 320).toLowerCase();
    if (!validEmail(nextEmail)) throw Object.assign(new Error('Enter a valid email address.'), { status:400 });
    const photoUrl = await uploadHeadshot(clean(body.photo_data_url, 1500000), profile.uid, url, key) || profile.photo_url || null;
    const update = {
      full_name:clean(body.full_name || profile.full_name, 160), email:nextEmail,
      phone:clean(body.phone || profile.phone, 80), company_name:clean(body.company_name || profile.company_name, 180),
      title:clean(body.title || profile.title || 'Loan Officer', 160), photo_url:photoUrl, updated_at:new Date().toISOString()
    };
    if (nextEmail !== clean(user.email, 320).toLowerCase()) {
      const authResponse = await fetch(`${url}/auth/v1/admin/users/${encodeURIComponent(user.id)}`, {
        method:'PUT', headers:{ apikey:key, Authorization:`Bearer ${key}`, 'Content-Type':'application/json' },
        body:JSON.stringify({ email:nextEmail, email_confirm:true })
      });
      const authPayload = await authResponse.json().catch(() => ({}));
      if (!authResponse.ok) throw new Error(authPayload?.message || authPayload?.msg || 'Unable to update the login email.');
    }
    const rows = await supabaseRest(`verified_profiles?uid=eq.${enc(profile.uid)}`, { method:'PATCH', headers:{ Prefer:'return=representation' }, body:JSON.stringify(update) });
    profile = Array.isArray(rows) ? rows[0] || profile : profile;
    sendJson(res, 200, { ok:true, profile, email_changed:nextEmail !== clean(user.email, 320).toLowerCase() });
  } catch (error) {
    sendJson(res, error.status || 500, { ok:false, error:error.message || 'Unable to open loan officer account.' });
  }
};
