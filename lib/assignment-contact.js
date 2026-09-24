const crypto = require('crypto');
const { supabaseRest } = require('./admin-auth');

const enc = encodeURIComponent;
const one = (rows) => Array.isArray(rows) ? rows[0] || {} : {};
const uuid = (value) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value || '');

function signature(payload) {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error('Contact signing is not configured.');
  return crypto.createHmac('sha256', key).update(`rel8tion-assignment-contact-v1:${payload}`).digest('base64url');
}

function contactUrl(visitId, profileUid, now = Date.now()) {
  if (!uuid(visitId) || !uuid(profileUid)) throw new Error('Invalid contact assignment.');
  const payload = Buffer.from(JSON.stringify([visitId, profileUid, Math.floor(now / 1000) + 30 * 86400])).toString('base64url');
  return `https://app.rel8tion.me/api/assignment-contact?token=${payload}.${signature(payload)}`;
}

function verifyContactToken(token, now = Date.now()) {
  const [payload, supplied, extra] = String(token || '').split('.');
  if (!payload || !supplied || extra || token.length > 800 || !/^[A-Za-z0-9_-]{43}$/.test(supplied)) return null;
  const expected = signature(payload);
  if (supplied.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(supplied), Buffer.from(expected))) return null;
  try {
    const [visitId, profileUid, expires] = JSON.parse(Buffer.from(payload, 'base64url').toString());
    return uuid(visitId) && uuid(profileUid) && Number.isInteger(expires) && expires > now / 1000
      ? { visitId, profileUid } : null;
  } catch (_) { return null; }
}

async function assignmentContext(visit) {
  const [queue, house, event] = await Promise.all([
    visit.outreach_queue_id ? supabaseRest(`agent_outreach_queue?id=eq.${enc(visit.outreach_queue_id)}&select=address,listing_photo_url&limit=1`).then(one) : {},
    visit.open_house_id ? supabaseRest(`open_houses?id=eq.${enc(visit.open_house_id)}&select=*&limit=1`).then(one) : {},
    visit.open_house_event_id ? supabaseRest(`open_house_events?id=eq.${enc(visit.open_house_event_id)}&select=setup_context&limit=1`).then(one) : {}
  ]);
  const context = event.setup_context || {};
  return {
    ...visit,
    address: visit.address || queue.address || house.address || context.address || '',
    listing_photo_url: visit.listing_photo_url || queue.listing_photo_url || house.listing_photo_url || house.photo_url || context.listing_photo_url || ''
  };
}

function agentVcard(visit) {
  const escape = (value) => String(value || '').replace(/\\/g, '\\\\').replace(/\r\n|\r|\n/g, '\\n').replace(/;/g, '\\;').replace(/,/g, '\\,');
  const lines = ['BEGIN:VCARD', 'VERSION:3.0', `FN:${escape(visit.agent_name || 'Hosting Agent')}`, 'N:;;;;'];
  if (visit.brokerage) lines.push(`ORG:${escape(visit.brokerage)}`);
  if (visit.agent_phone) lines.push(`TEL;TYPE=WORK,VOICE:${escape(visit.agent_phone)}`);
  if (visit.agent_email) lines.push(`EMAIL;TYPE=INTERNET,WORK:${escape(visit.agent_email)}`);
  if (visit.agent_slug) lines.push(`URL:https://app.rel8tion.me/b?agent=${enc(visit.agent_slug)}`);
  lines.push('END:VCARD');
  // Fold at 75 UTF-8 octets without splitting a Unicode character (RFC 2425).
  return lines.map((line) => {
    let folded = '', size = 0;
    for (const char of line) {
      const bytes = Buffer.byteLength(char);
      if (size + bytes > 75) { folded += '\r\n '; size = 1; }
      folded += char; size += bytes;
    }
    return folded;
  }).join('\r\n') + '\r\n';
}

module.exports = { contactUrl, verifyContactToken, assignmentContext, agentVcard };
