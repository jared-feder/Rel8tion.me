const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const HOST = '127.0.0.1';
const PORT = Number(process.env.AGENT_RANKING_BRANCH_PORT || 4180);
const ROOT = path.resolve(__dirname, '..');
const PAGE_PATH = path.join(ROOT, 'apps', 'rel8tion-app', 'agent-ranking.html');
const EXPECTED_BRANCH_REF = 'zzjbvenalpjtfaljbepc';

const supabaseUrl = String(process.env.SUPABASE_URL || '');
if (supabaseUrl !== `https://${EXPECTED_BRANCH_REF}.supabase.co`) {
  throw new Error('Refusing to start: SUPABASE_URL is not the approved preview branch.');
}
if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error('Refusing to start: missing preview-branch service role key.');
}

const authHandler = require('../api/admin/auth');
const rankingHandler = require('../api/admin/agent-ranking');

function sendJson(response, status, payload) {
  response.writeHead(status, {
    'Cache-Control': 'no-store',
    'Content-Type': 'application/json; charset=utf-8'
  });
  response.end(JSON.stringify(payload));
}

function readBody(request) {
  return new Promise((resolve, reject) => {
    let body = '';
    request.setEncoding('utf8');
    request.on('data', (chunk) => {
      body += chunk;
      if (body.length > 1_000_000) request.destroy();
    });
    request.on('end', () => resolve(body));
    request.on('error', reject);
  });
}

function addVercelResponseMethods(response) {
  response.status = (status) => {
    response.statusCode = status;
    return response;
  };
  response.json = (payload) => {
    if (!response.headersSent) response.setHeader('Content-Type', 'application/json; charset=utf-8');
    response.end(JSON.stringify(payload));
  };
}

const server = http.createServer(async (request, response) => {
  const requestUrl = new URL(request.url || '/', `http://${HOST}:${PORT}`);
  request.query = Object.fromEntries(requestUrl.searchParams.entries());
  addVercelResponseMethods(response);

  if (request.method === 'POST') {
    const raw = await readBody(request);
    try {
      request.body = raw ? JSON.parse(raw) : {};
    } catch (_) {
      request.body = {};
    }
  }

  if (requestUrl.pathname === '/api/admin/auth') {
    await authHandler(request, response);
    return;
  }

  if (requestUrl.pathname === '/api/admin/agent-ranking') {
    if (request.method === 'POST' && request.body?.action !== 'profile_details') {
      sendJson(response, 403, {
        ok: false,
        error: 'This preview-branch dashboard is read-only. No database or outreach write was performed.'
      });
      return;
    }
    await rankingHandler(request, response);
    return;
  }

  if (
    requestUrl.pathname === '/'
    || requestUrl.pathname === '/admin/agent-ranking'
    || requestUrl.pathname === '/apps/rel8tion-app/agent-ranking'
    || requestUrl.pathname === '/apps/rel8tion-app/agent-ranking.html'
  ) {
    const banner = `
      <div style="position:sticky;top:0;z-index:99999;padding:10px 16px;background:#075985;color:#fff;text-align:center;font:800 14px/1.3 system-ui;">
        REAL SUPABASE PREVIEW BRANCH - read-only dashboard - production is not connected
      </div>`;
    const html = fs.readFileSync(PAGE_PATH, 'utf8').replace('<body>', `<body>${banner}`);
    response.writeHead(200, {
      'Cache-Control': 'no-store',
      'Content-Type': 'text/html; charset=utf-8'
    });
    response.end(html);
    return;
  }

  response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
  response.end('Not found');
});

server.listen(PORT, HOST, () => {
  process.stdout.write(`Agent Rankings Supabase branch preview: http://${HOST}:${PORT}/admin/agent-ranking\n`);
});

