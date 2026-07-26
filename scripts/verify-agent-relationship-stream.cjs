const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const migrationPath = path.join(root, 'supabase', 'migrations', '20260726193000_agent_relationship_stream.sql');
const apiPath = path.join(root, 'api', 'admin', 'agent-relationships.js');
const adminPath = path.join(root, 'apps', 'rel8tion-app', 'admin.html');

for (const file of [migrationPath, apiPath, adminPath]) {
  if (!fs.existsSync(file)) throw new Error(`Missing relationship stream file: ${file}`);
}

const migration = fs.readFileSync(migrationPath, 'utf8');
for (const required of [
  'create table if not exists public.agent_relationships',
  'create table if not exists public.agent_relationship_events',
  'alter table public.agent_relationships enable row level security',
  'alter table public.agent_relationship_events enable row level security',
  'with (security_invoker = true)',
  'create or replace view public.agent_board_v1',
  'grant select on table public.agent_board_v1 to service_role'
]) {
  if (!migration.toLowerCase().includes(required)) {
    throw new Error(`Relationship migration is missing: ${required}`);
  }
}

const apiSource = fs.readFileSync(apiPath, 'utf8');
new Function('require', 'module', 'exports', apiSource);

const adminSource = fs.readFileSync(adminPath, 'utf8');
const scripts = [...adminSource.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)];
if (!scripts.length) throw new Error('No inline REL8TION admin script was found.');
for (const match of scripts) new Function(match[1]);

for (const required of [
  '/api/admin/agent-relationships',
  'data-toggle-agent-pin',
  'Pin to top',
  'Pinned to top'
]) {
  if (!adminSource.includes(required)) {
    throw new Error(`REL8TION admin UI is missing: ${required}`);
  }
}

async function verifyApiContract() {
  const originalRelationshipToken = process.env.REL8TION_RELATIONSHIP_TOKEN;
  process.env.REL8TION_RELATIONSHIP_TOKEN = 'relationship-verification-token';
  const calls = [];
  const relationship = {
    id: 'relationship-1',
    canonical_key: 'phone:5165551212',
    display_name: 'Test Agent',
    phone_normalized: '5165551212',
    pinned: false
  };
  const mockRest = async (requestPath, options = {}) => {
    calls.push({ path: requestPath, options });
    if (requestPath.startsWith('agent_relationships?canonical_key=')) return [];
    if (requestPath.startsWith('agent_relationships?phone_normalized=')) return [];
    if (requestPath === 'agent_relationships' && options.method === 'POST') return [relationship];
    if (requestPath.startsWith('agent_relationships?id=eq.') && options.method === 'PATCH') {
      return [{ ...relationship, ...JSON.parse(options.body) }];
    }
    if (requestPath === 'agent_relationship_events') return [{ id: 'event-1' }];
    if (requestPath.startsWith('agent_board_v1?')) return [{ ...relationship, name: relationship.display_name, pinned: true }];
    throw new Error(`Unexpected relationship API request: ${requestPath}`);
  };
  const apiModule = { exports: {} };
  const customRequire = (request) => {
    if (request === 'crypto') return require('crypto');
    if (request === '../../lib/admin-auth') {
      return {
        adminAuthorized: () => ({ ok: false, error: 'Unauthorized.' }),
        assertAdminConfig: () => {},
        sendJson: (res, status, payload) => res.status(status).json(payload),
        supabaseRest: mockRest
      };
    }
    throw new Error(`Unexpected module request: ${request}`);
  };
  new Function('require', 'module', 'exports', apiSource)(customRequire, apiModule, apiModule.exports);
  let responsePayload = null;
  const response = {
    setHeader: () => {},
    status(status) {
      this.statusCode = status;
      return this;
    },
    json(payload) {
      responsePayload = payload;
      return payload;
    }
  };
  await apiModule.exports({
    method: 'POST',
    headers: { 'x-admin-token': 'relationship-verification-token' },
    query: {},
    body: {
      action: 'pin',
      agent: { name: 'Test Agent', phone: '(516) 555-1212' },
      source_record_id: 'verification-pin'
    }
  }, response);
  if (response.statusCode !== 200 || responsePayload?.ok !== true) {
    throw new Error('Relationship API pin contract did not return a successful response.');
  }
  if (!responsePayload?.agents?.[0]?.pinned) {
    throw new Error('Relationship API pin contract did not return a pinned board row.');
  }
  if (!calls.some((call) => call.path === 'agent_relationship_events')) {
    throw new Error('Relationship API pin contract did not append an event.');
  }
  if (originalRelationshipToken === undefined) {
    delete process.env.REL8TION_RELATIONSHIP_TOKEN;
  } else {
    process.env.REL8TION_RELATIONSHIP_TOKEN = originalRelationshipToken;
  }
}

verifyApiContract()
  .then(() => console.log('Agent relationship stream verification passed.'))
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
