const { sendJson, supabaseRest } = require('../lib/admin-auth');

const clean = (value, max = 2000) => String(value || '').trim().slice(0, max);
const enc = (value) => encodeURIComponent(clean(value));

module.exports = async function handler(req, res) {
  try {
    if (req.method !== 'GET') {
      res.setHeader('Allow', 'GET');
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
    const userResponse = await fetch(`${url}/auth/v1/user`, {
      headers:{ apikey:key, Authorization:`Bearer ${token}` }
    });
    const user = await userResponse.json().catch(() => ({}));
    if (!userResponse.ok || !user?.email) {
      sendJson(res, 401, { ok:false, error:'Your sign-in has expired. Please sign in again.' });
      return;
    }
    const rows = await supabaseRest(`verified_profiles?email=ilike.${enc(user.email)}&is_active=eq.true&select=uid,slug,full_name,email,title,company_name,industry&limit=1`);
    const profile = Array.isArray(rows) ? rows[0] || null : null;
    if (!profile?.uid || !/loan|mortgage/i.test(`${profile.industry || ''} ${profile.title || ''}`)) {
      sendJson(res, 403, { ok:false, error:'No approved loan officer profile matches this email.' });
      return;
    }
    sendJson(res, 200, { ok:true, profile });
  } catch (error) {
    sendJson(res, error.status || 500, { ok:false, error:error.message || 'Unable to open loan officer account.' });
  }
};
