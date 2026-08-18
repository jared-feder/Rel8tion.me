const { sendJson } = require('../lib/admin-auth');
const { loadClaimedDevice, requireSession, setSessionCookie } = require('../lib/agent-nfc-session');

function clean(value, max = 300) {
  return String(value || '').trim().slice(0, max);
}

function body(req) {
  if (!req.body) return {};
  if (typeof req.body === 'object') return req.body;
  try { return JSON.parse(req.body); } catch (_) { return {}; }
}

module.exports = async function handler(req, res) {
  try {
    if (req.method === 'GET') {
      const agentSlug = clean(req.query?.agent_slug || req.query?.agent, 160);
      const session = await requireSession(req, agentSlug);
      return sendJson(res, 200, { ok: true, verified: true, agent_slug: session.slug, expires_at: session.exp });
    }
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'GET, POST');
      return sendJson(res, 405, { ok: false, error: 'Method not allowed.' });
    }
    const input = body(req);
    const subject = await loadClaimedDevice(
      clean(input.agent_slug || input.agent, 160),
      clean(input.uid, 180)
    );
    setSessionCookie(res, subject);
    return sendJson(res, 200, {
      ok: true,
      verified: true,
      agent_slug: subject.agent_slug,
      expires_in: 30 * 60
    });
  } catch (error) {
    return sendJson(res, error.status || 500, { ok: false, error: error.message || 'NFC session verification failed.' });
  }
};
