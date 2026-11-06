'use strict';
const { randomBytes } = require('node:crypto');
const { PDFDocument } = require('pdf-lib');
const { BrokerWorkspace, ORG } = require('../lib/broker-workspace');
function createHandler({ enabled = false, sessions = new Map() } = {}) {
  return async (req, res) => {
    res.setHeader('Cache-Control', 'private, no-store'); res.setHeader('Content-Type', 'application/json');
    const send = (status, value) => { res.statusCode = status; res.end(JSON.stringify(value)); };
    if (!enabled || process.env.VERCEL || !/^(127\.0\.0\.1|localhost):\d+$/.test(req.headers?.host || '') || !['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket?.remoteAddress)) return send(404, { error: 'Not found' });
    if (req.headers.origin && req.headers.origin !== `http://${req.headers.host}`) return send(403, { error: 'Same-origin preview required' });
    try {
      if (!['GET', 'POST'].includes(req.method)) return send(405, { error: 'Method not allowed' });
      for (const [id, s] of sessions) if (s.expires < Date.now()) sessions.delete(id);
      const id = String(req.headers.cookie || '').match(/(?:^|;\s*)broker_fixture=([a-f0-9]{48})(?:;|$)/)?.[1];
      let session = sessions.get(id);
      if (!session && req.method === 'GET') {
        if (sessions.size >= 30) return send(429, { error: 'Preview session limit reached' });
        const token = randomBytes(24).toString('hex'); session = { csrf: randomBytes(24).toString('hex'), actor: { userId: 'demo-broker', role: 'broker', organizationId: ORG }, service: new BrokerWorkspace(), expires: Date.now() + 3600000 }; sessions.set(token, session);
        res.setHeader('Set-Cookie', `broker_fixture=${token}; Path=/api/broker-preview; HttpOnly; SameSite=Strict; Max-Age=3600`);
      }
      if (!session) return send(401, { error: 'Open the synthetic broker workspace first' });
      const url = new URL(req.url, `http://${req.headers.host}`);
      if (req.method === 'POST') {
        if (req.headers['x-preview-csrf'] !== session.csrf) return send(403, { error: 'Preview session mismatch' });
        const action = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
        if (!action || JSON.stringify(action).length > 2900000) return send(400, { error: 'Invalid preview action' });
        if (action.type === 'upload_form') {
          if (typeof action.base64 !== 'string' || !/^[A-Za-z0-9+/]+={0,2}$/.test(action.base64)) return send(400, { error: 'Invalid PDF encoding' });
          const bytes = Buffer.from(action.base64, 'base64');
          if (bytes.length > 2 * 1024 * 1024) return send(400, { error: 'PDF exceeds 2 MB' });
          try {
            const pdf = await PDFDocument.load(bytes);
            if (pdf.getPageCount() < 1 || pdf.getPageCount() > 200 || !bytes.subarray(-1024).toString('latin1').includes('%%EOF')) throw new Error('Invalid PDF structure');
          } catch (_) { return send(400, { error: 'PDF could not be read; use a valid unencrypted PDF with 1–200 pages' }); }
          session.service.addDraft(session.actor, { title: action.title, bytes });
        } else session.service.act(session.actor, action);
      }
      if (url.searchParams.has('archive')) return send(200, session.service.archiveManifest(session.actor, url.searchParams.get('archive')));
      send(200, { ok: true, csrf: session.csrf, ...session.service.snapshot(session.actor, { start: url.searchParams.get('start'), end: url.searchParams.get('end') }) });
    } catch (error) { send(error.status || 500, { error: error.status ? error.message : 'Preview processing failed' }); }
  };
}
module.exports = createHandler();
module.exports.createHandler = createHandler;
