'use strict';
const crypto = require('node:crypto');
const { supabaseRest } = require('./admin-auth');
const { resolveSession } = require('./app-auth');
const { requireSession: requireNfc } = require('./agent-nfc-session');
const { requirePhoneSession } = require('../api/agent-phone-lock');
const fail = (status, message) => { throw Object.assign(new Error(message), { status }); };
const RECEIPT_TTL = 86400;
function receiptSecret() {
  const value = process.env.DISCLOSURE_RECEIPT_SECRET || process.env.AGENT_NFC_SESSION_SECRET || process.env.AGENT_PHONE_LOCK_SECRET || process.env.KEY_RESET_ADMIN_TOKEN || process.env.ADMIN_TOKEN;
  if (!value) fail(503, 'Secure check-in receipts are not configured');
  return value;
}
function cookies(req) {
  const result = {};
  for (const part of String(req.headers?.cookie || '').split(';')) { const i = part.indexOf('='); if (i < 1) continue; try { result[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim()); } catch (_) {} }
  return result;
}
const cookieName = id => `rel8tion_disclosure_${crypto.createHash('sha256').update(String(id)).digest('hex').slice(0, 16)}`;
function receiptSignature(payload) { return crypto.createHmac('sha256', receiptSecret()).update(`disclosure-receipt-v1:${payload}`).digest('base64url'); }
function setReceiptCookie(req, res, checkin) {
  const now = Math.floor(Date.now() / 1000);
  const payload = Buffer.from(JSON.stringify({ purpose: 'disclosure-receipt', checkinId: checkin.id, eventId: checkin.open_house_event_id, iat: now, exp: now + RECEIPT_TTL })).toString('base64url');
  const secure = !/^(localhost|127\.0\.0\.1)(:\d+)?$/.test(req.headers?.host || '') ? '; Secure' : '';
  const cookie = `${cookieName(checkin.id)}=${payload}.${receiptSignature(payload)}; Path=/api; Max-Age=${RECEIPT_TTL}; HttpOnly; SameSite=Strict${secure}`;
  const prior = res.getHeader?.('Set-Cookie'); res.setHeader('Set-Cookie', [...(Array.isArray(prior) ? prior : prior ? [prior] : []), cookie]);
}
function readReceipt(req, checkinId) {
  const token = cookies(req)[cookieName(checkinId)]; if (!token || token.length > 2000) return null;
  const [payload, signature, extra] = token.split('.'); if (!payload || !signature || extra) return null;
  const expected = receiptSignature(payload), a = Buffer.from(signature), b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const claim = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')), now = Math.floor(Date.now() / 1000);
    return claim.purpose === 'disclosure-receipt' && claim.checkinId === checkinId && claim.eventId && Number.isInteger(claim.exp) && Number.isInteger(claim.iat) && claim.iat <= now && claim.exp > now && claim.exp - claim.iat <= RECEIPT_TTL ? claim : null;
  } catch (_) { return null; }
}
function assertSameOrigin(req) {
  const site = req.headers?.['sec-fetch-site']; if (site && !['same-origin', 'none'].includes(site)) fail(403, 'Same-origin request required');
  const origin = req.headers?.origin;
  if (origin) {
    const protocol = /^(localhost|127\.0\.0\.1)(:\d+)?$/.test(req.headers?.host || '') ? 'http' : 'https';
    if (origin !== `${protocol}://${req.headers?.host}`) fail(403, 'Same-origin request required');
  }
}
function createAccess({ rest = supabaseRest, session = resolveSession, nfc = requireNfc, phone = requirePhoneSession, receipt = readReceipt } = {}) {
  return {
    async principal(req, res, checkinId) {
      const claim = receipt(req, checkinId); if (claim) return { kind: 'receipt', claim };
      const jar = cookies(req);
      const context = await session(req, res);
      if (context) {
        const role = context.activeWorkspace?.role;
        if (!['agent', 'broker', 'platform_admin'].includes(role) || !context.permissions?.includes('compliance.read')) fail(403, 'Disclosure access is not granted to this workspace');
        return { kind: 'workspace', context };
      }
      for (const [present, verify] of [[jar.rel8tion_agent_phone_session, phone], [jar.rel8tion_agent_nfc_session, nfc]]) {
        if (!present) continue;
        try { const value = await verify(req); return { kind: 'agent', slug: value.slug }; }
        catch (error) { if (![401, 403].includes(error.status) && !(error instanceof URIError)) throw error; }
      }
      fail(401, 'Sign in or use your check-in receipt to access this disclosure');
    },
    async authorize(principal, context, generate = false) {
      if (principal.kind === 'receipt') {
        if (principal.claim.checkinId !== context.checkin.id || principal.claim.eventId !== context.eventId) fail(403, 'Receipt does not match this record');
        if (generate && Date.now() / 1000 - principal.claim.iat > 900) fail(403, 'Initial archive creation window has expired; ask the host for assistance');
        return;
      }
      if (principal.kind === 'agent') {
        if (!principal.slug || principal.slug !== context.event?.host_agent_slug) fail(403, 'Disclosure is outside this agent’s event scope'); return;
      }
      const { activeWorkspace: workspace, permissions } = principal.context;
      if (workspace.role === 'broker' && !workspace.organization?.id) fail(403, 'An active brokerage organization is required');
      if (generate && !permissions.includes('compliance.generate')) fail(403, 'Archive creation is not granted to this workspace');
      // Platform operators still need an authenticated, explicitly granted role.
      if (workspace.role === 'platform_admin' && permissions.includes('platform.audit.read')) return;
      const assignments = await rest(`app_domain_assignments?workspace_id=eq.${encodeURIComponent(workspace.id)}&status=eq.active&select=resource_type,resource_id,relationship_type`);
      const allowed = (Array.isArray(assignments) ? assignments : []).some(a => workspace.role === 'agent'
        ? a.resource_type === 'agent_slug' && a.resource_id === context.event?.host_agent_slug
        : a.resource_type === 'open_house_event' && a.resource_id === context.eventId && a.relationship_type === 'compliance');
      if (!allowed) fail(403, 'Disclosure is outside this workspace’s assigned scope');
    }
  };
}
module.exports = { createAccess, receiptSecret, setReceiptCookie, readReceipt, assertSameOrigin, cookieName };
