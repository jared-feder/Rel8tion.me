const { sendJson, supabaseRest } = require('../lib/admin-auth');

const clean = (value, max = 2000) => String(value || '').trim().slice(0, max);
const enc = (value) => encodeURIComponent(clean(value));
const one = (rows) => Array.isArray(rows) ? rows[0] || null : null;
const htmlEscape = (value) => clean(value).replace(/[&<>"']/g, (char) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#039;' }[char]));

function bodyOf(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  try { return JSON.parse(req.body || '{}'); } catch (_) { return {}; }
}

async function authenticatedUser(req) {
  const bearer = clean(req.headers?.authorization, 3000).replace(/^Bearer\s+/i, '');
  if (!bearer) return null;
  const url = clean(process.env.SUPABASE_URL, 500).replace(/\/$/, '');
  const key = clean(process.env.SUPABASE_SERVICE_ROLE_KEY, 2000);
  const response = await fetch(`${url}/auth/v1/user`, {
    headers:{ apikey:key, Authorization:`Bearer ${bearer}` }
  });
  if (!response.ok) return null;
  return response.json().catch(() => null);
}

async function loadRelationship(uid, agentKey) {
  const participants = await supabaseRest(
    `field_demo_visit_participants?or=(participant_profile_id.eq.${enc(uid)},participant_uid.eq.${enc(uid)})&select=id,field_demo_visits(*)&limit=250`
  ).catch(() => []);
  const normalized = clean(agentKey).toLowerCase();
  for (const row of Array.isArray(participants) ? participants : []) {
    const visit = row.field_demo_visits || {};
    const keys = [visit.agent_slug, visit.agent_email, visit.agent_phone, visit.agent_name].map((value) => clean(value).toLowerCase()).filter(Boolean);
    if (keys.includes(normalized)) return visit;
  }
  return null;
}

function offerMessage(profile, agent) {
  const first = clean(agent.agent_name || 'there', 100).split(/\s+/)[0] || 'there';
  const loName = clean(profile.full_name || 'your loan officer', 140);
  return `Hi ${first}, it’s ${loName}. I’d like to support your next open house with a REL8TION Event Pass and live financing help for buyers who opt in. I can cover it remotely, so I do not need to be physically present. Would you like me to set it up? Reply STOP to opt out.`;
}

async function sendSms(profile, agent, message) {
  const url = clean(process.env.SUPABASE_URL, 500).replace(/\/$/, '');
  const key = clean(process.env.SUPABASE_SERVICE_ROLE_KEY, 2000);
  if (!agent.agent_phone) return { channel:'sms', status:'skipped', warning:'Agent phone is missing.' };
  const response = await fetch(`${url}/functions/v1/send-lead-sms`, {
    method:'POST',
    headers:{ apikey:key, Authorization:`Bearer ${key}`, 'Content-Type':'application/json' },
    body:JSON.stringify({
      agent_phone:agent.agent_phone, buyer_phone:agent.agent_phone, buyer_name:agent.agent_name || 'Agent',
      message, category:'event_transactional',
      metadata:{ mode:'loan_officer_agent_support_offer', loan_officer_uid:profile.uid, agent_slug:agent.agent_slug || null }
    })
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data?.error) throw new Error(data?.error || `Agent offer SMS failed: ${response.status}`);
  return { channel:'sms', status:'sent', provider_id:data.sid || data.id || null };
}

async function sendEmail(profile, agent, message) {
  if (!agent.agent_email) return { channel:'email', status:'skipped', warning:'Agent email is missing.' };
  const apiKey = clean(process.env.RESEND_API_KEY, 500);
  if (!apiKey) return { channel:'email', status:'not_configured', warning:'Email setup is not complete.' };
  const from = clean(process.env.REL8TION_FROM_EMAIL || process.env.RESEND_FROM_EMAIL || 'REL8TION <onboarding@resend.dev>', 320);
  const response = await fetch('https://api.resend.com/emails', {
    method:'POST',
    headers:{ Authorization:`Bearer ${apiKey}`, 'Content-Type':'application/json' },
    body:JSON.stringify({
      from, to:agent.agent_email,
      subject:`Open house support from ${clean(profile.full_name || 'your loan officer', 140)}`,
      text:message,
      html:`<p>${htmlEscape(message)}</p>`
    })
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data?.message || data?.error?.message || `Agent offer email failed: ${response.status}`);
  return { channel:'email', status:'sent', provider_id:data.id || null };
}

module.exports = async function handler(req, res) {
  try {
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST');
      sendJson(res, 405, { ok:false, error:'Method not allowed.' });
      return;
    }
    const body = bodyOf(req);
    const user = await authenticatedUser(req);
    if (!user?.email) {
      sendJson(res, 401, { ok:false, error:'Loan officer sign-in required.' });
      return;
    }
    const profile = one(await supabaseRest(`verified_profiles?uid=eq.${enc(body.loan_officer_uid)}&is_active=eq.true&select=*&limit=1`));
    if (!profile) {
      sendJson(res, 403, { ok:false, error:'Active loan officer profile required.' });
      return;
    }
    if (clean(profile.email, 320).toLowerCase() !== clean(user.email, 320).toLowerCase()) {
      sendJson(res, 403, { ok:false, error:'This signed-in account does not own that loan officer profile.' });
      return;
    }
    const agent = await loadRelationship(profile.uid, body.agent_key);
    if (!agent) {
      sendJson(res, 403, { ok:false, error:'This agent is not in the loan officer’s worked-agent list.' });
      return;
    }
    const message = offerMessage(profile, agent);
    const settle = async (channel, task) => {
      try { return await task(); } catch (error) { return { channel, status:'failed', error:error.message || String(error) }; }
    };
    const results = await Promise.all([
      settle('sms', () => sendSms(profile, agent, message)),
      settle('email', () => sendEmail(profile, agent, message))
    ]);
    sendJson(res, 200, { ok:true, agent:{ name:agent.agent_name, slug:agent.agent_slug }, message, results });
  } catch (error) {
    sendJson(res, error.status || 500, { ok:false, error:error.message || 'Unable to send agent support offer.' });
  }
};
