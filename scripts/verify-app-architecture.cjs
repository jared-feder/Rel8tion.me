const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), 'utf8');
}

function checkSyntax(relativePath) {
  new vm.Script(read(relativePath), { filename: relativePath });
}

function rewriteDestination(config, source) {
  const matches = config.rewrites.filter((rewrite) => rewrite.source === source);
  return (matches.find((rewrite) => !rewrite.has) || matches[0])?.destination || '';
}

const config = JSON.parse(read('vercel.json'));
const appHtml = read('apps/rel8tion-app/app.html');
const adminHtml = read('apps/rel8tion-app/platform-admin.html');
const migration = read('supabase/migrations/20260728073613_universal_app_rbac.sql').toLowerCase();
const adminEntry = read('api/app/admin-entry.js');
const adminSummary = read('api/app/admin-summary.js');
const appAuth = read('lib/app-auth.js');

assert.strictEqual(rewriteDestination(config, '/'), '/apps/rel8tion-app/app.html', 'Root must use the universal app shell.');
assert.strictEqual(rewriteDestination(config, '/home'), '/apps/rel8tion-app/app.html', '/home must use the shared shell.');
assert.strictEqual(rewriteDestination(config, '/admin'), '/api/app/admin-entry', '/admin must be server-gated.');
assert.strictEqual(rewriteDestination(config, '/admin.html'), '/api/app/admin-entry', '/admin.html must be server-gated.');
assert.strictEqual(rewriteDestination(config, '/command'), '/apps/rel8tion-app/admin.html', 'Legacy COMMAND must remain available separately.');

const permanentRoutes = new Map([
  ['/k', '/apps/rel8tion-app/k.html'],
  ['/s.html', '/apps/rel8tion-app/sign.html'],
  ['/event', '/apps/rel8tion-app/event.html'],
  ['/claim', '/apps/rel8tion-app/claim.html'],
  ['/a', ''],
  ['/b', ''],
  ['/c/:code', '/api/chip-qr?code=:code'],
  ['/chip/:code', '/api/chip-qr?code=:code']
]);

for (const [source, destination] of permanentRoutes) {
  if (!destination) {
    assert(fs.existsSync(path.join(ROOT, `${source.slice(1)}.html`)), `${source} wrapper must remain present.`);
    continue;
  }
  assert.strictEqual(rewriteDestination(config, source), destination, `${source} permanent route changed unexpectedly.`);
}

for (const phrase of ['Sign in', 'Activate my Rel8tion device', 'I was invited', 'Enter event or activation code']) {
  assert(appHtml.toLowerCase().includes(phrase.toLowerCase()), `Gateway is missing: ${phrase}`);
}

assert(appHtml.includes('/api/app/session'), 'The shared shell must resolve its server session.');
assert(appHtml.includes('X-Rel8tion-Workspace'), 'Workspace switching must send a server-verified workspace id.');
assert(appHtml.includes('was not executed'), 'The AI command preview must not claim an action completed.');
assert(adminEntry.includes("hasPermission(context, 'platform.admin')"), '/admin entry must require platform.admin.');
assert(adminSummary.includes('buildAdminSummary(context)'), 'Admin data must go through the permission-checked service.');
assert(adminHtml.includes('/api/app/admin-summary'), 'The admin shell must load data from the protected API.');
assert(!adminHtml.includes('SUPABASE_SERVICE_ROLE_KEY'), 'Admin HTML must not contain the service-role key.');
assert(!appHtml.includes('SUPABASE_SERVICE_ROLE_KEY'), 'Application HTML must not contain the service-role key.');
assert(appAuth.includes('verifiedUser(accessToken)'), 'Sessions must verify the authenticated user with Supabase Auth.');
assert(!/role\s*=\s*user\.user_metadata/i.test(appAuth), 'Authorization must not use user-editable user_metadata.');

for (const table of [
  'app_organizations',
  'app_workspaces',
  'app_workspace_memberships',
  'app_permission_overrides',
  'app_domain_assignments',
  'app_tasks',
  'app_activity_events',
  'app_audit_log'
]) {
  assert(migration.includes(`create table if not exists public.${table}`), `Migration is missing ${table}.`);
  assert(migration.includes(`alter table public.${table} enable row level security`), `${table} must enable RLS.`);
}

for (const destructive of ['drop table', 'drop column', 'disable row level security', 'truncate table']) {
  assert(!migration.includes(destructive), `Migration contains prohibited destructive SQL: ${destructive}`);
}

for (const relativePath of [
  'lib/app-auth.js',
  'lib/app-data.js',
  'api/app/auth/login.js',
  'api/app/auth/logout.js',
  'api/app/session.js',
  'api/app/home.js',
  'api/app/admin-summary.js',
  'api/app/admin-entry.js'
]) {
  checkSyntax(relativePath);
}

for (const [label, html] of [['app shell', appHtml], ['admin shell', adminHtml]]) {
  const scripts = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)].map((match) => match[1]).filter((script) => script.trim());
  assert(scripts.length > 0, `${label} has no inline application script.`);
  scripts.forEach((script, index) => new vm.Script(script, { filename: `${label}-inline-${index + 1}.js` }));
}

console.log('Universal app architecture verification passed: auth, RBAC, admin isolation, static syntax, and permanent routes are intact.');
