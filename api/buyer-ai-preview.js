'use strict';
const { randomBytes } = require('node:crypto');
const { BuyerAiService } = require('../lib/buyer-ai/service');
const { AGENTS } = require('../lib/buyer-ai/fixtures');
const loopback = host => ['127.0.0.1', 'localhost', '[::1]'].includes(String(host || '').replace(/:\d+$/, ''));
function createHandler({ enabled = false, sessions = new Map() } = {}) {
  return async (req, res) => {
    res.setHeader('Cache-Control', 'private, no-store'); res.setHeader('Content-Type', 'application/json');
    const send = (status, payload) => { res.statusCode = status; res.end(JSON.stringify(payload)); };
    // Vercel/production always fails closed; this endpoint is only mounted by the
    // dedicated loopback fixture server. It imports no application/provider auth.
    if (!enabled || process.env.VERCEL || !loopback(req.headers?.host) || !['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket?.remoteAddress)) return send(404, { error: 'Not found' });
    if (req.headers.origin && req.headers.origin !== `http://${req.headers.host}`) return send(403, { error: 'Same-origin preview required' });
    try {
      if (!['GET', 'POST'].includes(req.method)) return send(405, { error: 'Method not allowed' });
      for (const [key, value] of sessions) if (value.expires < Date.now()) sessions.delete(key);
      const token = String(req.headers.cookie || '').match(/(?:^|;\s*)buyer_ai_fixture=([a-f0-9]{48})(?:;|$)/)?.[1];
      let session = sessions.get(token);
      const url = new URL(req.url, `http://${req.headers.host}`);
      if (req.method === 'GET' && (!session || url.searchParams.has('workspace'))) {
        const agentId = url.searchParams.get('workspace') || 'demo-maya'; if (!AGENTS.some(x => x.id === agentId)) return send(400, { error: 'Unknown synthetic workspace' });
        if (sessions.size >= 50) return send(429, { error: 'Preview session limit reached; restart the local fixture server' });
        const next = randomBytes(24).toString('hex'); session = { agentId, csrf: randomBytes(24).toString('hex'), service: new BuyerAiService({ agentId }), expires: Date.now() + 3600000 }; sessions.set(next, session);
        res.setHeader('Set-Cookie', `buyer_ai_fixture=${next}; Path=/api/buyer-ai-preview; HttpOnly; SameSite=Strict; Max-Age=3600`);
      }
      if (!session) return send(401, { error: 'Open the synthetic workspace first' });
      if (req.method === 'POST') {
        if (req.headers['x-preview-csrf'] !== session.csrf) return send(403, { error: 'Preview session mismatch' });
        const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
        if (!body || JSON.stringify(body).length > 4000) return send(400, { error: 'Invalid preview action' });
        await session.service.act(session.agentId, body);
      }
      send(200, { ok: true, csrf: session.csrf, workspaces: AGENTS.map(({ id, name }) => ({ id, name })), ...session.service.snapshot(session.agentId) });
    } catch (error) { send(error.status || 500, { ok: false, error: error.status ? error.message : 'Preview processing failed; no real message was sent' }); }
  };
}
module.exports = createHandler(); // disabled even if accidentally deployed
module.exports.createHandler = createHandler;
