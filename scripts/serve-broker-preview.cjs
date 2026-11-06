'use strict';
const http = require('node:http'), fs = require('node:fs'), path = require('node:path');
const { createHandler } = require('../api/broker-preview');
const root = path.resolve(__dirname, '..'), handler = createHandler({ enabled: true });
const workspace = { id: 'demo-broker-workspace', role: 'broker', role_label: 'Broker / Team Leader', organization: { id: 'demo-harbor', name: 'Harbor Realty · fictional office' } };
const permissions = ['app.home', 'team.read', 'team.manage', 'team.invite', 'events.read', 'reports.read', 'contacts.read', 'settings.manage'];
const session = { authenticated: true, user: { id: 'demo-broker', name: 'Morgan Taylor', email: 'morgan@example.test' }, active_workspace: workspace, workspaces: [workspace], permissions };
const home = { ok: true, user: session.user, workspace, workspaces: [workspace], permissions, hero: { eyebrow: 'Broker workspace', title: 'Your office, working together.', description: 'Open-house results, team coordination and evidence in one place.' }, today: [], relationships: [], quick_actions: [], activity: [], data_status: { live: false, warnings: [] } };
http.createServer(async (req, res) => {
  if (!/^(127\.0\.0\.1|localhost):\d+$/.test(req.headers.host || '')) { res.writeHead(403); return res.end(); }
  const url = new URL(req.url, 'http://127.0.0.1');
  res.setHeader('Cache-Control', 'no-store'); res.setHeader('X-Content-Type-Options', 'nosniff'); res.setHeader('Referrer-Policy', 'no-referrer');
  if (url.pathname === '/api/broker-preview') {
    let body = ''; for await (const chunk of req) { body += chunk; if (body.length > 2900000) { res.writeHead(413); return res.end(); } } req.body = body; return handler(req, res);
  }
  if (req.method !== 'GET') { res.writeHead(405); return res.end(); }
  res.setHeader('Content-Security-Policy', "default-src 'none'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; font-src 'self'; form-action 'none'; base-uri 'none'; frame-ancestors 'none'");
  if (url.pathname === '/api/app/session' || url.pathname === '/api/app/home') { res.setHeader('Content-Type', 'application/json'); return res.end(JSON.stringify(url.pathname.endsWith('session') ? session : home)); }
  if (['/', '/broker', '/events', '/reports', '/team', '/compliance', '/leaderboard', '/contacts'].includes(url.pathname) && url.searchParams.get('broker_preview') === '1') {
    const html = fs.readFileSync(path.join(root, 'apps/rel8tion-app/app.html'), 'utf8').replaceAll('https://rel8tion.me/wp-content/uploads/2026/04/logo150x100trans.png', '/assets/rel8tion-brand/rel8tion-logo.png');
    res.setHeader('Content-Type', 'text/html; charset=utf-8'); return res.end(html);
  }
  const assets = { '/apps/rel8tion-app/src/modules/broker/workspace.js': ['apps/rel8tion-app/src/modules/broker/workspace.js', 'text/javascript'], '/assets/rel8tion-brand/rel8tion-logo.png': ['assets/rel8tion-brand/rel8tion-logo.png', 'image/png'] };
  const asset = assets[url.pathname]; if (!asset) { res.writeHead(404); return res.end('No production routes are mounted'); }
  res.setHeader('Content-Type', asset[1]); fs.createReadStream(path.join(root, asset[0])).pipe(res);
}).listen(8772, '127.0.0.1', () => console.log('Actual universal broker app: http://127.0.0.1:8772/broker?broker_preview=1'));
