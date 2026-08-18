const crypto = require('crypto');
const { supabaseRest } = require('./admin-auth');

const SESSION_COOKIE = 'rel8tion_agent_nfc_session';
const SESSION_TTL_SECONDS = 30 * 60;
const ALLOWED_ROLES = new Set(['keychain', 'chip', 'event_pass_keychain']);

function clean(value, max = 300) {
  return String(value || '').trim().slice(0, max);
}

function enc(value) {
  return encodeURIComponent(clean(value));
}

function one(rows) {
  return Array.isArray(rows) ? rows[0] || null : null;
}

function sessionSecret() {
  const value = process.env.AGENT_NFC_SESSION_SECRET
    || process.env.AGENT_PHONE_LOCK_SECRET
    || process.env.KEY_RESET_ADMIN_TOKEN
    || process.env.ADMIN_TOKEN;
  if (!value) throw new Error('Agent NFC session secret is not configured.');
  return value;
}

function safeEqual(left, right) {
  const a = Buffer.from(String(left || ''));
  const b = Buffer.from(String(right || ''));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function signature(value) {
  return crypto.createHmac('sha256', sessionSecret()).update(value).digest('base64url');
}

function parseCookies(req) {
  return String(req.headers?.cookie || '').split(';').reduce((result, item) => {
    const index = item.indexOf('=');
    if (index > 0) result[item.slice(0, index).trim()] = decodeURIComponent(item.slice(index + 1).trim());
    return result;
  }, {});
}

function makeSession(agentSlug, uid, role) {
  const payload = Buffer.from(JSON.stringify({
    slug: clean(agentSlug, 160),
    uid: clean(uid, 180),
    role: clean(role, 80),
    exp: Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS
  })).toString('base64url');
  return `${payload}.${signature(payload)}`;
}

function readSession(req) {
  const token = parseCookies(req)[SESSION_COOKIE] || '';
  const [payload, suppliedSignature] = token.split('.');
  if (!payload || !suppliedSignature || !safeEqual(signature(payload), suppliedSignature)) return null;
  try {
    const parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (!parsed.slug || !parsed.uid || Number(parsed.exp || 0) <= Math.floor(Date.now() / 1000)) return null;
    return parsed;
  } catch (_) {
    return null;
  }
}

function setSessionCookie(res, subject) {
  const token = makeSession(subject.agent_slug, subject.uid, subject.device_role);
  res.setHeader('Set-Cookie', `${SESSION_COOKIE}=${encodeURIComponent(token)}; Max-Age=${SESSION_TTL_SECONDS}; Path=/; HttpOnly; Secure; SameSite=Strict`);
}

async function loadClaimedDevice(agentSlug, uid) {
  const slug = clean(agentSlug, 160);
  const keyUid = clean(uid, 180);
  if (!slug || !keyUid) {
    const error = new Error('Tap the claimed agent NFC device to open this private dashboard.');
    error.status = 400;
    throw error;
  }
  const key = one(await supabaseRest(
    `keys?uid=eq.${enc(keyUid)}&agent_slug=eq.${enc(slug)}&claimed=eq.true&select=uid,agent_slug,device_role&limit=1`
  ));
  const role = clean(key?.device_role, 80).toLowerCase();
  if (!key || (role && !ALLOWED_ROLES.has(role))) {
    const error = new Error('This NFC device is not currently claimed by this agent.');
    error.status = 403;
    throw error;
  }
  return { uid: key.uid, agent_slug: key.agent_slug, device_role: role || 'keychain' };
}

async function requireSession(req, expectedAgentSlug = '') {
  const session = readSession(req);
  const expected = clean(expectedAgentSlug, 160);
  if (!session || (expected && session.slug !== expected)) {
    const error = new Error('Tap the claimed agent NFC device again to open this private dashboard.');
    error.status = 401;
    throw error;
  }
  const subject = await loadClaimedDevice(session.slug, session.uid);
  return { ...session, role: subject.device_role };
}

module.exports = {
  SESSION_COOKIE,
  SESSION_TTL_SECONDS,
  loadClaimedDevice,
  makeSession,
  readSession,
  requireSession,
  setSessionCookie
};
