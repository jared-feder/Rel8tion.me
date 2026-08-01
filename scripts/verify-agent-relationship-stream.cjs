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
  'data-toggle-agent-follow-up',
  'Pin to top',
  'Pinned to top',
  'Mark follow-up',
  'Follow-up marked',
  'futureOpenHouseAgent',
  'futureOpenHouseRelationship',
  'futureOpenHouseDateFrom',
  'futureOpenHouseDateTo',
  'futureOpenHouseTimeFrom',
  'futureOpenHouseTimeTo',
  'Accepted / worked with',
  'Prior outreach'
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
    if (requestPath.startsWith('agent_relationship_events?event_type=in.')) {
      return [{
        id: 'follow-up-event-1',
        relationship_id: relationship.id,
        event_type: 'follow_up_marked',
        summary: 'Call about the next open house',
        occurred_at: '2026-07-27T14:00:00.000Z',
        metadata: {
          title: 'Call about the next open house',
          due_at: '2026-07-28T14:00:00.000Z'
        }
      }];
    }
    if (requestPath.startsWith('agent_board_v1?')) return [{ ...relationship, name: relationship.display_name, pinned: true }];
    if (requestPath.startsWith('field_demo_visits?')) {
      return [
        {
          id: 'visit-1',
          outreach_queue_id: 'queue-1',
          open_house_id: 'open-house-1',
          scheduled_start: '2026-07-26T14:00:00.000Z',
          scheduled_end: '2026-07-26T16:00:00.000Z',
          status: 'scheduled'
        },
        {
          id: 'visit-duplicate',
          outreach_queue_id: 'queue-1',
          open_house_id: 'open-house-1',
          scheduled_start: '2026-07-26T14:00:00.000Z',
          scheduled_end: '2026-07-26T16:00:00.000Z',
          status: 'confirmed'
        }
      ];
    }
    if (requestPath.startsWith('agent_outreach_queue?')) {
      return [{
        id: 'queue-1',
        open_house_id: 'open-house-1',
        address: '1 Main St',
        city: 'Huntington',
        state: 'NY',
        agent_name: 'Test Agent',
        agent_phone_normalized: '5165551212',
        selected_sms: 'Would you like help with your next open house?',
        initial_sent_at: '2026-07-27T13:00:00.000Z'
      }];
    }
    if (requestPath.startsWith('agent_outreach_replies?')) {
      return [{
        id: 'reply-1',
        queue_row_id: 'queue-1',
        body: 'Yes, call me tomorrow.',
        direction: 'inbound',
        received_at: '2026-07-27T13:05:00.000Z'
      }];
    }
    if (requestPath.startsWith('open_houses?')) return [];
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
  if (
    responsePayload?.agents?.[0]?.follow_up_marked !== true
    || responsePayload?.agents?.[0]?.follow_up_title !== 'Call about the next open house'
  ) {
    throw new Error('Relationship API board contract did not project the latest follow-up marker.');
  }
  if (
    responsePayload?.agents?.[0]?.conversation_count !== 2
    || responsePayload?.agents?.[0]?.conversation_log?.[0]?.direction !== 'outbound'
    || responsePayload?.agents?.[0]?.conversation_log?.[1]?.direction !== 'inbound'
  ) {
    throw new Error('Relationship API board contract did not project the linked conversation in order.');
  }
  if (!calls.some((call) => call.path === 'agent_relationship_events')) {
    throw new Error('Relationship API pin contract did not append an event.');
  }

  responsePayload = null;
  await apiModule.exports({
    method: 'POST',
    headers: { 'x-admin-token': 'relationship-verification-token' },
    query: {},
    body: {
      action: 'historical_open_house',
      worked: true,
      agent: { name: 'Test Agent', phone: '(516) 555-1212' },
      source_record_id: 'verification-historical-open-house',
      include_board: false
    }
  }, response);
  if (response.statusCode !== 200 || responsePayload?.event?.id !== 'event-1') {
    throw new Error('Relationship API historical open-house contract did not append an event.');
  }

  responsePayload = null;
  await apiModule.exports({
    method: 'POST',
    headers: { 'x-admin-token': 'relationship-verification-token' },
    query: {},
    body: {
      action: 'follow_up',
      follow_up: true,
      title: 'Call about the next open house',
      agent: { name: 'Test Agent', phone: '(516) 555-1212' },
      source_record_id: 'verification-follow-up',
      include_board: false
    }
  }, response);
  if (response.statusCode !== 200 || responsePayload?.event?.id !== 'event-1') {
    throw new Error('Relationship API follow-up contract did not append an event.');
  }
  const followUpEventCall = calls
    .filter((call) => call.path === 'agent_relationship_events' && call.options?.method === 'POST')
    .map((call) => JSON.parse(call.options.body))
    .find((event) => event.event_type === 'follow_up_marked');
  if (followUpEventCall?.metadata?.title !== 'Call about the next open house') {
    throw new Error('Relationship API follow-up contract did not preserve follow-up metadata.');
  }

  responsePayload = null;
  await apiModule.exports({
    method: 'GET',
    headers: { 'x-admin-token': 'relationship-verification-token' },
    query: {
      view: 'schedule',
      from: '2026-07-26T04:00:00.000Z',
      to: '2026-07-27T04:00:00.000Z'
    }
  }, response);
  if (response.statusCode !== 200 || responsePayload?.count !== 1) {
    throw new Error('Relationship API schedule view did not return the scheduled visit.');
  }
  if (responsePayload?.scheduled_open_houses?.[0]?.property_address !== '1 Main St Huntington, NY') {
    throw new Error('Relationship API schedule view did not normalize the scheduled visit.');
  }
  if (responsePayload?.scheduled_open_houses?.[0]?.source_record_count !== 2) {
    throw new Error('Relationship API schedule view did not collapse duplicate source visits.');
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
