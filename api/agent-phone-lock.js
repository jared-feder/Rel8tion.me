const crypto = require('crypto');
const { sendJson, supabaseRest } = require('../lib/admin-auth');

const SESSION_COOKIE = 'rel8tion_agent_phone_session';
const OTP_TTL_MS = 10 * 60 * 1000;
const SESSION_TTL_SECONDS = 30 * 24 * 60 * 60;
const RESEND_WAIT_MS = 60 * 1000;
const MAX_ATTEMPTS = 5;

function enc(value) { return encodeURIComponent(String(value || '').trim()); }
function one(rows) { return Array.isArray(rows) ? rows[0] || null : null; }
function clean(value, max = 300) { return String(value || '').trim().slice(0, max); }
function parseBody(req) {
  if (!req.body) return {};
  if (typeof req.body === 'object') return req.body;
  try { return JSON.parse(req.body); } catch (_) { return {}; }
}
function secret() {
  const value = process.env.AGENT_PHONE_LOCK_SECRET || process.env.KEY_RESET_ADMIN_TOKEN || process.env.ADMIN_TOKEN;
  if (!value) throw new Error('Agent phone-lock secret is not configured.');
  return value;
}
function b64url(value) { return Buffer.from(value).toString('base64url'); }
function hmac(value) { return crypto.createHmac('sha256', secret()).update(value).digest('base64url'); }
function codeHash(code, salt, slug, uid) { return hmac(`${salt}:${slug}:${uid}:${code}`); }
function safeEqual(left, right) {
  const a = Buffer.from(String(left || ''));
  const b = Buffer.from(String(right || ''));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
function normalizePhone(value) {
  let digits = String(value || '').replace(/\D/g, '');
  if (digits.length === 10) digits = `1${digits}`;
  return digits.length === 11 && digits.startsWith('1') ? `+${digits}` : '';
}
function cookies(req) {
  return String(req.headers?.cookie || '').split(';').reduce((map, item) => {
    const index = item.indexOf('=');
    if (index > 0) map[item.slice(0, index).trim()] = decodeURIComponent(item.slice(index + 1).trim());
    return map;
  }, {});
}
function makeSession(slug, uid) {
  const payload = b64url(JSON.stringify({ slug, uid, exp: Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS }));
  return `${payload}.${hmac(payload)}`;
}
function readSession(req) {
  const token = cookies(req)[SESSION_COOKIE] || '';
  const [payload, signature] = token.split('.');
  if (!payload || !signature || !safeEqual(hmac(payload), signature)) return null;
  try {
    const parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    return parsed.exp > Math.floor(Date.now() / 1000) ? parsed : null;
  } catch (_) { return null; }
}
function setSessionCookie(res, slug, uid) {
  res.setHeader('Set-Cookie', `${SESSION_COOKIE}=${encodeURIComponent(makeSession(slug, uid))}; Max-Age=${SESSION_TTL_SECONDS}; Path=/; HttpOnly; Secure; SameSite=Strict`);
}
async function claimedSubject(slug, uid) {
  if (!slug || !uid) {
    const error = new Error('Missing agent or NFC UID.'); error.status = 400; throw error;
  }
  const key = one(await supabaseRest(`keys?uid=eq.${enc(uid)}&agent_slug=eq.${enc(slug)}&claimed=eq.true&select=uid,agent_slug&limit=1`));
  if (!key) { const error = new Error('This NFC chip is not claimed by this agent.'); error.status = 403; throw error; }
  const agent = one(await supabaseRest(`agents?slug=eq.${enc(slug)}&select=slug,name,phone,phone_normalized&limit=1`));
  const phone = normalizePhone(agent?.phone_normalized || agent?.phone);
  if (!agent || !phone) { const error = new Error('This agent does not have a verified mobile number on file.'); error.status = 409; throw error; }
  return { key, agent, phone };
}
async function sendOtp(phone, name, code, metadata) {
  const url = clean(process.env.SUPABASE_URL, 500).replace(/\/$/, '');
  const key = clean(process.env.SUPABASE_SERVICE_ROLE_KEY, 2000);
  const response = await fetch(`${url}/functions/v1/send-lead-sms`, {
    method: 'POST',
    headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      agent_phone: phone,
      buyer_phone: phone,
      buyer_name: name || 'REL8TION agent',
      category: 'event_transactional',
      message: `REL8TION verification code: ${code}. Use it to protect your private agent dashboard. This code expires in 10 minutes.`,
      metadata
    })
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload?.error) throw new Error(payload?.error || `Verification SMS failed: ${response.status}`);
  return payload;
}

module.exports = async function handler(req, res) {
  try {
    if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return sendJson(res, 405, { ok: false, error: 'Method not allowed.' }); }
    const body = parseBody(req);
    const action = clean(body.action, 40);
    const slug = clean(body.agent_slug, 120);
    const uid = clean(body.uid, 160);
    const subject = await claimedSubject(slug, uid);

    if (action === 'status') {
      const session = readSession(req);
      return sendJson(res, 200, { ok: true, verified: Boolean(session && session.slug === slug && session.uid === uid) });
    }

    if (action === 'request_code') {
      const latest = one(await supabaseRest(
        `agent_phone_verifications?agent_slug=eq.${enc(slug)}&key_uid=eq.${enc(uid)}&select=id,created_at&order=created_at.desc&limit=1`
      ));
      if (latest && Date.now() - new Date(latest.created_at).getTime() < RESEND_WAIT_MS) {
        const error = new Error('Please wait one minute before requesting another code.'); error.status = 429; throw error;
      }
      const code = String(crypto.randomInt(100000, 1000000));
      const salt = crypto.randomBytes(18).toString('base64url');
      const created = one(await supabaseRest('agent_phone_verifications', {
        method: 'POST', headers: { Prefer: 'return=representation' },
        body: JSON.stringify({
          agent_slug: slug, key_uid: uid, code_hash: codeHash(code, salt, slug, uid), code_salt: salt,
          phone_last_four: subject.phone.slice(-4), expires_at: new Date(Date.now() + OTP_TTL_MS).toISOString()
        })
      }));
      try {
        await sendOtp(subject.phone, subject.agent.name, code, { mode: 'agent_phone_lock_otp', verification_id: created.id, agent_slug: slug });
      } catch (error) {
        await supabaseRest(`agent_phone_verifications?id=eq.${enc(created.id)}`, { method: 'DELETE' }).catch(() => null);
        throw error;
      }
      return sendJson(res, 200, { ok: true, verification_id: created.id, phone_last_four: subject.phone.slice(-4), expires_in: 600 });
    }

    if (action === 'verify_code') {
      const id = clean(body.verification_id, 100);
      const code = clean(body.code, 10);
      const row = one(await supabaseRest(`agent_phone_verifications?id=eq.${enc(id)}&agent_slug=eq.${enc(slug)}&key_uid=eq.${enc(uid)}&select=*&limit=1`));
      if (!row || row.verified_at || new Date(row.expires_at).getTime() <= Date.now()) {
        const error = new Error('That verification code has expired. Request a new one.'); error.status = 409; throw error;
      }
      if (row.attempts >= MAX_ATTEMPTS) { const error = new Error('Too many incorrect attempts. Request a new code.'); error.status = 429; throw error; }
      const matches = /^\d{6}$/.test(code) && safeEqual(codeHash(code, row.code_salt, slug, uid), row.code_hash);
      const attempts = Number(row.attempts || 0) + 1;
      await supabaseRest(`agent_phone_verifications?id=eq.${enc(row.id)}`, {
        method: 'PATCH', body: JSON.stringify(matches ? { attempts, verified_at: new Date().toISOString() } : { attempts })
      });
      if (!matches) { const error = new Error('That code did not match.'); error.status = 401; throw error; }
      setSessionCookie(res, slug, uid);
      return sendJson(res, 200, { ok: true, verified: true });
    }

    return sendJson(res, 400, { ok: false, error: 'Unsupported action.' });
  } catch (error) {
    return sendJson(res, error.status || 500, { ok: false, error: error.message || 'Phone verification failed.' });
  }
};
