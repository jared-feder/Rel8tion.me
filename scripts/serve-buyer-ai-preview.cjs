'use strict';
const http = require('node:http'), fs = require('node:fs'), path = require('node:path');
const { createHandler } = require('../api/buyer-ai-preview');
const root = path.resolve(__dirname, '..'); const handler = createHandler({ enabled: true }); const port = Number(process.env.BUYER_AI_PREVIEW_PORT || 8771);
const assets = { '/assets/buyer-ai/avatar.svg': ['assets/buyer-ai/avatar.svg', 'image/svg+xml'], '/assets/rel8tion-brand/rel8tion-logo.png': ['assets/rel8tion-brand/rel8tion-logo.png', 'image/png'], '/assets/rel8tion-brand/Inter-Regular.ttf': ['assets/rel8tion-brand/Inter-Regular.ttf', 'font/ttf'], '/assets/rel8tion-brand/PlusJakartaSans-ExtraBold.ttf': ['assets/rel8tion-brand/PlusJakartaSans-ExtraBold.ttf', 'font/ttf'] };
http.createServer(async (req, res) => {
  if (!['127.0.0.1', 'localhost'].includes(String(req.headers.host || '').split(':')[0])) { res.writeHead(403); return res.end(); }
  const url = new URL(req.url, 'http://127.0.0.1');
  if (url.pathname === '/api/buyer-ai-preview') {
    let body = ''; for await (const chunk of req) { body += chunk; if (body.length > 4000) { res.writeHead(413); return res.end(); } } req.body = body; return handler(req, res);
  }
  if (req.method !== 'GET') { res.writeHead(405); return res.end(); }
  res.setHeader('Content-Security-Policy', "default-src 'none'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; font-src 'self'; form-action 'none'; base-uri 'none'; frame-ancestors 'none'"); res.setHeader('Cache-Control', 'no-store'); res.setHeader('X-Content-Type-Options', 'nosniff');
  if (url.pathname === '/agent-home' && url.searchParams.get('buyer_ai_preview') === '1') {
    let html = fs.readFileSync(path.join(root, 'apps/rel8tion-app/agent-home.html'), 'utf8'); html = html.replace(/<link[^>]*href="https:\/\/fonts.googleapis.com[^>]*>/, '').replaceAll('https://rel8tion.me/wp-content/uploads/2026/04/logo150x100trans.png', '/assets/rel8tion-brand/rel8tion-logo.png');
    res.setHeader('Content-Type', 'text/html; charset=utf-8'); return res.end(html);
  }
  let asset = assets[url.pathname];
  if (['/apps/rel8tion-app/src/core/config.js', '/apps/rel8tion-app/src/api/chipQr.js', '/apps/rel8tion-app/src/modules/buyerAi/workspace.js'].includes(url.pathname)) asset = [url.pathname.slice(1), 'text/javascript'];
  if (!asset) { res.writeHead(404); return res.end('No production routes or records are mounted'); }
  res.setHeader('Content-Type', asset[1]); fs.createReadStream(path.join(root, asset[0])).pipe(res);
}).listen(port, '127.0.0.1', () => console.log(`Actual paid agent app with synthetic buyer AI: http://127.0.0.1:${port}/agent-home?agent=maya-brooks&uid=demo-keychain&buyer_ai_preview=1#buyer-ai`));
