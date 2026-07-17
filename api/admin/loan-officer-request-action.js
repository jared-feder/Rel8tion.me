const crypto = require('crypto');
const { adminAuthorized, assertAdminConfig, sendJson, supabaseRest } = require('../../lib/admin-auth');

const clean = (value, max = 2000) => String(value || '').trim().slice(0, max);
const enc = (value) => encodeURIComponent(clean(value));
const one = (rows) => Array.isArray(rows) ? rows[0] || null : null;

function bodyOf(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  try { return JSON.parse(req.body || '{}'); } catch (_) { return {}; }
}

async function loadRequest(id) {
  const row = one(await supabaseRest(`loan_officer_support_requests?id=eq.${enc(id)}&select=*&limit=1`));
  if (!row) {
    const error = new Error('Loan officer application not found.');
    error.status = 404;
    throw error;
  }
  return row;
}

async function approve(request) {
  let profile = request.email
    ? one(await supabaseRest(`verified_profiles?email=ilike.${enc(request.email)}&select=*&limit=1`).catch(() => []))
    : null;
  if (!profile) {
    profile = one(await supabaseRest('rpc/verified_profiles_activate_or_create', {
      method: 'POST',
      body: JSON.stringify({
        p_uid: crypto.randomUUID(),
        p_industry: 'loan',
        p_full_name: clean(request.full_name, 160),
        p_title: 'Loan Officer',
        p_company_name: clean(request.company_name, 180),
        p_phone: clean(request.phone, 80),
        p_email: clean(request.email, 320),
        p_photo_url: '', p_logo_url: '', p_cta_url: '', p_calendar_url: '',
        p_bio: clean(request.experience, 2000),
        p_areas: clean(request.coverage_areas, 1000).split(',').map((item) => item.trim()).filter(Boolean)
      })
    }));
  }
  if (!profile?.uid) throw new Error('Profile approval did not return a loan officer UID.');
  const now = new Date().toISOString();
  const rows = await supabaseRest(`loan_officer_support_requests?id=eq.${enc(request.id)}`, {
    method: 'PATCH',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify({
      status: 'approved', updated_at: now,
      metadata: { ...(request.metadata && typeof request.metadata === 'object' ? request.metadata : {}), approved_at:now, verified_profile_uid:profile.uid, verified_profile_slug:profile.slug || '' }
    })
  });
  return { request:one(rows), profile };
}

module.exports = async function handler(req, res) {
  try {
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST');
      sendJson(res, 405, { ok:false, error:'Method not allowed.' });
      return;
    }
    assertAdminConfig();
    const auth = adminAuthorized(req);
    if (!auth.ok) {
      sendJson(res, 401, { ok:false, error:auth.error });
      return;
    }
    const body = bodyOf(req);
    if (clean(body.action) !== 'approve') {
      sendJson(res, 400, { ok:false, error:'Unsupported loan officer request action.' });
      return;
    }
    const result = await approve(await loadRequest(body.request_id));
    sendJson(res, 200, { ok:true, ...result, activation_url:`/nmb-activate?uid=${encodeURIComponent(result.profile.uid)}`, dashboard_url:`/loan-officer-dashboard?uid=${encodeURIComponent(result.profile.uid)}` });
  } catch (error) {
    sendJson(res, error.status || 500, { ok:false, error:error.message || 'Unable to approve loan officer application.', details:error.payload || null });
  }
};
