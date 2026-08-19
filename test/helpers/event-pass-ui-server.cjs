const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '../..');
const port = Number(process.argv[2] || 4174);

function json(res, value) {
  res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(value));
}

function contentType(file) {
  if (file.endsWith('.html')) return 'text/html; charset=utf-8';
  if (file.endsWith('.js')) return 'text/javascript; charset=utf-8';
  if (file.endsWith('.css')) return 'text/css; charset=utf-8';
  if (file.endsWith('.png')) return 'image/png';
  if (file.endsWith('.webp')) return 'image/webp';
  return 'application/octet-stream';
}

http.createServer((req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${port}`);
  if (url.pathname === '/api/agent-membership') {
    return json(res, {
      ok: true,
      active: false,
      checkout_required: true,
      event_pass_device: true,
      event_pass_code: 'preview-pass',
      checkout_plan_code: 'rel8tion_agent_monthly',
      checkout_label: '$29/month',
      plan_code: null
    });
  }
  if (url.pathname === '/api/event-pass/reuse-options') {
    return json(res, {
      ok: true,
      agent: { slug: 'preview-agent', name: 'Preview Agent', email: 'preview@example.test' },
      inventory: { id: 'preview-inventory', public_code: 'preview-pass' },
      sign: { id: 'preview-sign' },
      house: { id: 'preview-house', address: '123 REL8TION Way, Preview, NY' },
      authorization: { basis: 'listing_agent' },
      membership_active: false,
      reuse_required: true,
      sponsor: {
        id: 'preview-lo',
        uid: 'preview-lo',
        name: 'Jordan Taylor',
        title: 'Mortgage Loan Officer',
        company: 'Neighborhood Mortgage Bank',
        photo_url: '/preview-lo.svg'
      },
      sponsor_source: 'agent_loan_officer_relationship',
      plan: { code: 'rel8tion_agent_monthly', label: '$29/month', amount_cents: 2900 }
    });
  }
  if (url.pathname === '/preview-lo.svg') {
    res.writeHead(200, { 'Content-Type': 'image/svg+xml', 'Cache-Control': 'no-store' });
    return res.end('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 160"><rect width="160" height="160" rx="34" fill="#dceeff"/><circle cx="80" cy="61" r="31" fill="#5b7fb2"/><path d="M28 151c5-38 24-56 52-56s47 18 52 56" fill="#34598d"/></svg>');
  }
  if (url.pathname === '/rest/v1/keys') {
    return json(res, [{ uid: 'preview-event-pass', agent_slug: 'preview-agent', claimed: true, device_role: 'event_pass_keychain' }]);
  }
  if (url.pathname === '/rest/v1/agents') {
    return json(res, [{
      slug: 'preview-agent',
      name: 'Preview Agent',
      phone: '5165550100',
      phone_normalized: '5165550100',
      email: 'preview@example.test',
      brokerage: 'Preview Realty',
      image_url: ''
    }]);
  }
  if (url.pathname === '/apps/rel8tion-app/src/core/config.js') {
    const file = path.join(root, 'apps/rel8tion-app/src/core/config.js');
    const source = fs.readFileSync(file, 'utf8')
      .replace(/export const SUPABASE_URL = '[^']*';/, `export const SUPABASE_URL = 'http://127.0.0.1:${port}';`)
      .replace(/export const KEY = '[^']*';/, "export const KEY = 'preview-key';");
    res.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8', 'Cache-Control': 'no-store' });
    return res.end(source);
  }

  const relative = url.pathname === '/agent-home'
    ? 'apps/rel8tion-app/agent-home.html'
    : url.pathname === '/event-pass-reuse'
      ? 'apps/rel8tion-app/event-pass-reuse.html'
      : url.pathname.replace(/^\/+/, '');
  const file = path.resolve(root, relative);
  if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    return res.end('Not found');
  }
  res.writeHead(200, { 'Content-Type': contentType(file), 'Cache-Control': 'no-store' });
  fs.createReadStream(file).pipe(res);
}).listen(port, '127.0.0.1', () => {
  process.stdout.write(`Event Pass UI preview: http://127.0.0.1:${port}/agent-home?agent=preview-agent&uid=preview-event-pass\n`);
});
