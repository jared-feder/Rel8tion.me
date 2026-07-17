const crypto = require('crypto');
const { adminAuthorized, assertAdminConfig, sendJson, supabaseRest } = require('../../lib/admin-auth');

const clean = (value, max = 2000) => String(value || '').trim().slice(0, max);
const enc = (value) => encodeURIComponent(clean(value));
const one = (rows) => Array.isArray(rows) ? rows[0] || null : null;
const htmlEscape = (value) => clean(value, 2000).replace(/[&<>"']/g, (char) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#039;' }[char]));

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
        p_photo_url: clean(request.metadata?.photo_url, 1000), p_logo_url: '', p_cta_url: '', p_calendar_url: '',
        p_bio: clean(request.experience, 2000),
        p_areas: clean(request.coverage_areas, 1000).split(',').map((item) => item.trim()).filter(Boolean)
      })
    }));
  } else if (!profile.photo_url && request.metadata?.photo_url) {
    profile = one(await supabaseRest(`verified_profiles?uid=eq.${enc(profile.uid)}`, {
      method:'PATCH', headers:{ Prefer:'return=representation' },
      body:JSON.stringify({ photo_url:clean(request.metadata.photo_url, 1000) })
    })) || profile;
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

function appBaseUrl() {
  return clean(process.env.PUBLIC_APP_URL || process.env.REL8TION_APP_URL || 'https://app.rel8tion.me', 500).replace(/\/$/, '');
}

async function sendPasswordSetupInvite(request, profile) {
  const url = clean(process.env.SUPABASE_URL, 500).replace(/\/$/, '');
  const key = clean(process.env.SUPABASE_SERVICE_ROLE_KEY, 2000);
  const email = clean(request.email, 320).toLowerCase();
  if (!url || !key || !email) return { channel:'auth_email', status:'not_configured', warning:'Supabase Auth invitation is not configured.' };
  const redirectTo = `${appBaseUrl()}/loan-officer-account?mode=setup`;
  const inviteResponse = await fetch(`${url}/auth/v1/invite?redirect_to=${encodeURIComponent(redirectTo)}`, {
    method:'POST',
    headers:{ apikey:key, Authorization:`Bearer ${key}`, 'Content-Type':'application/json' },
    body:JSON.stringify({
      email,
      data:{ full_name:clean(request.full_name, 160), verified_profile_uid:profile.uid, account_role:'loan_officer' }
    })
  });
  const inviteData = await inviteResponse.json().catch(() => ({}));
  if (inviteResponse.ok) return { channel:'auth_email', status:'sent', mode:'invite', user_id:inviteData?.id || inviteData?.user?.id || null };

  if (!/already|registered|exists/i.test(inviteData?.message || inviteData?.msg || inviteData?.error_description || '')) {
    throw new Error(inviteData?.message || inviteData?.msg || inviteData?.error_description || `Password invitation failed: ${inviteResponse.status}`);
  }

  const recoveryResponse = await fetch(`${url}/auth/v1/recover?redirect_to=${encodeURIComponent(redirectTo)}`, {
    method:'POST',
    headers:{ apikey:key, Authorization:`Bearer ${key}`, 'Content-Type':'application/json' },
    body:JSON.stringify({ email })
  });
  const recoveryData = await recoveryResponse.json().catch(() => ({}));
  if (!recoveryResponse.ok) throw new Error(recoveryData?.message || recoveryData?.msg || recoveryData?.error_description || `Password setup email failed: ${recoveryResponse.status}`);
  return { channel:'auth_email', status:'sent', mode:'recovery' };
}

async function sendApprovalSms(request, activationUrl) {
  const url = clean(process.env.SUPABASE_URL, 500).replace(/\/$/, '');
  const key = clean(process.env.SUPABASE_SERVICE_ROLE_KEY, 2000);
  if (!url || !key) return { channel:'sms', status:'not_configured', warning:'Supabase SMS is not configured.' };
  const message = `REL8TION: ${clean(request.full_name, 80)}, your loan officer registration was approved. Complete your verified profile and open your dashboard here: ${activationUrl} Reply STOP to opt out.`;
  const response = await fetch(`${url}/functions/v1/send-lead-sms`, {
    method:'POST',
    headers:{ apikey:key, Authorization:`Bearer ${key}`, 'Content-Type':'application/json' },
    body:JSON.stringify({
      agent_phone:request.phone, buyer_phone:request.phone, buyer_name:request.full_name,
      message, category:'event_transactional',
      metadata:{ mode:'loan_officer_registration_approved', request_id:request.id }
    })
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data?.error) throw new Error(data?.error || `Approval SMS failed: ${response.status}`);
  return { channel:'sms', status:'sent', provider_id:data.sid || data.id || null };
}

async function sendApprovalEmail(request, activationUrl) {
  const apiKey = clean(process.env.RESEND_API_KEY, 500);
  if (!apiKey) return { channel:'email', status:'not_configured', warning:'RESEND_API_KEY is not configured.' };
  const from = clean(process.env.REL8TION_FROM_EMAIL || process.env.RESEND_FROM_EMAIL || 'REL8TION <onboarding@resend.dev>', 320);
  const subject = 'Your REL8TION loan officer registration is approved';
  const text = `${request.full_name}, your loan officer registration was approved. Complete your verified profile and open your dashboard: ${activationUrl}`;
  const html = `<h2>Your loan officer registration is approved</h2><p>${htmlEscape(clean(request.full_name, 160))}, complete your verified profile to open your REL8TION loan officer dashboard.</p><p><a href="${htmlEscape(activationUrl)}">Complete profile and open dashboard</a></p>`;
  const response = await fetch('https://api.resend.com/emails', {
    method:'POST',
    headers:{ Authorization:`Bearer ${apiKey}`, 'Content-Type':'application/json', 'Idempotency-Key':`lo-registration-approved-${request.id}` },
    body:JSON.stringify({ from, to:request.email, subject, text, html })
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data?.message || data?.error?.message || `Approval email failed: ${response.status}`);
  return { channel:'email', status:'sent', provider_id:data.id || null };
}

async function notifyApproval(request, profile, activationUrl) {
  const settle = async (channel, task) => {
    try { return await task(); }
    catch (error) { return { channel, status:'failed', error:error.message || String(error) }; }
  };
  return Promise.all([
    request.email ? settle('auth_email', () => sendPasswordSetupInvite(request, profile)) : Promise.resolve({ channel:'auth_email', status:'skipped', warning:'Applicant email is missing.' }),
    request.phone ? settle('sms', () => sendApprovalSms(request, activationUrl)) : Promise.resolve({ channel:'sms', status:'skipped', warning:'Applicant phone is missing.' }),
    request.email ? settle('email', () => sendApprovalEmail(request, activationUrl)) : Promise.resolve({ channel:'email', status:'skipped', warning:'Applicant email is missing.' })
  ]);
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
    const sourceRequest = await loadRequest(body.request_id);
    const result = await approve(sourceRequest);
    const activationUrl = `${appBaseUrl()}/loan-officer-account?mode=setup`;
    const notifications = body.notify === false ? [] : await notifyApproval(sourceRequest, result.profile, activationUrl);
    sendJson(res, 200, {
      ok:true, ...result, notifications,
      activation_url:activationUrl,
      dashboard_url:`${appBaseUrl()}/loan-officer-dashboard?uid=${encodeURIComponent(result.profile.uid)}`
    });
  } catch (error) {
    sendJson(res, error.status || 500, { ok:false, error:error.message || 'Unable to approve loan officer application.', details:error.payload || null });
  }
};
