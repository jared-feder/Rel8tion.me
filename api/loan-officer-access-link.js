const { sendJson, supabaseRest } = require('../lib/admin-auth');

const clean = (value, max = 2000) => String(value || '').trim().slice(0, max);
const enc = (value) => encodeURIComponent(clean(value));
const one = (rows) => Array.isArray(rows) ? rows[0] || null : null;

function bodyOf(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  try { return JSON.parse(req.body || '{}'); } catch (_) { return {}; }
}

function normalizePhone(value) {
  const digits = clean(value, 80).replace(/\D/g, '');
  const ten = digits.length === 11 && digits.startsWith('1') ? digits.slice(1) : digits;
  return ten.length === 10 ? `+1${ten}` : '';
}

async function generateAccountLink(profile, url, key, redirectTo) {
  const listResponse = await fetch(`${url}/auth/v1/admin/users?page=1&per_page=1000`, { headers:{ apikey:key, Authorization:`Bearer ${key}` } });
  const listPayload = await listResponse.json().catch(() => ({}));
  if (!listResponse.ok) throw new Error(listPayload?.message || 'Unable to inspect the login account.');
  const users = Array.isArray(listPayload?.users) ? listPayload.users : Array.isArray(listPayload) ? listPayload : [];
  const exists = users.some((user) => clean(user.email, 320).toLowerCase() === clean(profile.email, 320).toLowerCase());
  const response = await fetch(`${url}/auth/v1/admin/generate_link?redirect_to=${encodeURIComponent(redirectTo)}`, {
    method:'POST',
    headers:{ apikey:key, Authorization:`Bearer ${key}`, 'Content-Type':'application/json' },
    body:JSON.stringify({
      type:exists ? 'recovery' : 'invite',
      email:clean(profile.email, 320).toLowerCase(),
      data:{ full_name:profile.full_name || '', verified_profile_uid:profile.uid, account_role:'loan_officer' }
    })
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload?.action_link) throw new Error(payload?.message || payload?.msg || 'Unable to create the secure account link.');
  return { actionLink:payload.action_link, mode:exists ? 'recovery' : 'invite' };
}

async function textAccountLink(profile, link, url, key) {
  const phone = normalizePhone(profile.phone);
  if (!phone) throw Object.assign(new Error('This approved profile does not have a valid mobile number.'), { status:409 });
  const recent = await supabaseRest(`sms_message_log?to_phone=eq.${enc(phone)}&category=eq.event_transactional&metadata->>mode=eq.loan_officer_account_access&created_at=gte.${enc(new Date(Date.now() - 5 * 60 * 1000).toISOString())}&select=id&limit=1`).catch(() => []);
  if (Array.isArray(recent) && recent.length) return { status:'recently_sent' };
  const message = `REL8TION: ${profile.full_name || 'Loan officer'}, use this secure one-time link to create or reset your dashboard password: ${link} Reply STOP to opt out.`;
  const response = await fetch(`${url}/functions/v1/send-lead-sms`, {
    method:'POST',
    headers:{ apikey:key, Authorization:`Bearer ${key}`, 'Content-Type':'application/json' },
    body:JSON.stringify({
      agent_phone:phone, buyer_phone:phone, buyer_name:profile.full_name || 'Loan Officer',
      message, category:'event_transactional',
      metadata:{ mode:'loan_officer_account_access', verified_profile_uid:profile.uid }
    })
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload?.error) throw new Error(payload?.error || `Unable to send account text: ${response.status}`);
  return { status:'sent', provider_id:payload.sid || payload.id || null };
}

module.exports = async function handler(req, res) {
  try {
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST');
      sendJson(res, 405, { ok:false, error:'Method not allowed.' });
      return;
    }
    const email = clean(bodyOf(req).email, 320).toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      sendJson(res, 400, { ok:false, error:'Enter the approved email address.' });
      return;
    }
    const profile = one(await supabaseRest(`verified_profiles?email=ilike.${enc(email)}&is_active=eq.true&select=uid,full_name,email,phone,industry,title&limit=1`));
    if (!profile?.uid || !/loan|mortgage/i.test(`${profile.industry || ''} ${profile.title || ''}`)) {
      sendJson(res, 200, { ok:true, delivery:'If an approved account matches, a secure link will be sent to its saved mobile number.' });
      return;
    }
    const url = clean(process.env.SUPABASE_URL, 500).replace(/\/$/, '');
    const key = clean(process.env.SUPABASE_SERVICE_ROLE_KEY, 2000);
    if (!url || !key) throw new Error('Account access is not configured.');
    const redirectTo = `${clean(process.env.PUBLIC_APP_URL || process.env.REL8TION_APP_URL || 'https://app.rel8tion.me', 500).replace(/\/$/, '')}/loan-officer?mode=setup`;
    const generated = await generateAccountLink(profile, url, key, redirectTo);
    const delivery = await textAccountLink(profile, generated.actionLink, url, key);
    sendJson(res, 200, { ok:true, delivery:delivery.status === 'recently_sent' ? 'A secure link was already sent recently. Check your text messages.' : 'Secure account link sent by text.', mode:generated.mode });
  } catch (error) {
    sendJson(res, error.status || 500, { ok:false, error:error.message || 'Unable to send the secure account link.' });
  }
};
