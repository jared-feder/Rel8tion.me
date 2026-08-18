const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

function inlineScripts(file) {
  return [...read(file).matchAll(/<script(?:\s+[^>]*)?>([\s\S]*?)<\/script>/gi)]
    .map((match) => match[1])
    .filter((source) => source.trim());
}

test('agent Event Pass dashboard has no direct public-table reads or writes', () => {
  const source = read('apps/rel8tion-app/agent-dashboard.html');
  assert.match(source, /\/api\/agent-event-dashboard/);
  assert.doesNotMatch(source, /SUPABASE_URL|Authorization:\s*`Bearer \$\{KEY\}`/);
  assert.doesNotMatch(source, /rest\/v1\/(?:event_checkins|open_house_events|smart_signs)/);
  assert.match(source, /dashboardApi\('close_event', 'POST'\)/);
});

test('NFC router establishes a server session before private agent routes', () => {
  const source = read('apps/rel8tion-app/k.html');
  assert.match(source, /async function establishAgentNfcSession/);
  assert.match(source, /\/api\/agent-nfc-session/);
  assert.match(source, /await establishAgentNfcSession\(agentSlug\)/);
  assert.equal((source.match(/\bgoToAgentDashboard\(/g) || []).length, (source.match(/await goToAgentDashboard\(/g) || []).length + 1);
  assert.equal((source.match(/\bgoToAgentHome\(/g) || []).length, (source.match(/await goToAgentHome\(/g) || []).length + 1);
});

test('server snapshot and closeout enforce the current claimed NFC host', () => {
  const source = read('api/agent-event-dashboard.js');
  assert.match(source, /requireSession\(req, input\.agent_slug\)/);
  assert.match(source, /event\.host_agent_slug !== session\.slug/);
  assert.match(source, /event\.smart_sign_id !== sign\.id/);
  assert.match(source, /host_agent_slug=eq\.\$\{enc\(session\.slug\)\}/);
});

test('Event Pass buyer writes use the server route and private reads require NFC', () => {
  const eventApi = read('apps/rel8tion-app/src/api/events.js');
  const affordability = read('api/buyer-affordability.js');
  const agentHome = read('apps/rel8tion-app/agent-home.html');
  const fieldDashboard = read('apps/rel8tion-app/field-dashboard.html');
  assert.match(eventApi, /fetch\('\/api\/event-checkin'/);
  assert.doesNotMatch(eventApi, /rest\/v1\/event_checkins/);
  assert.match(affordability, /mode === 'event_fit_data'[\s\S]*requireSession/);
  assert.doesNotMatch(agentHome, /event_checkins\?/);
  assert.doesNotMatch(fieldDashboard, /event_checkins\?/);
});

test('migration denies anonymous Event Pass PII and operator mutations', () => {
  const source = read('sql/migrations/20260818143000_lock_event_pass_private_rows.sql');
  assert.match(source, /alter table public\.event_checkins enable row level security/i);
  assert.match(source, /event_checkins_non_event_pass_legacy_select/);
  assert.match(source, /coalesce\(event_row\.setup_context ->> 'flow', ''\) = 'event-pass'/);
  assert.match(source, /alter table public\.open_house_events enable row level security/i);
  assert.match(source, /alter table public\.smart_signs enable row level security/i);
  assert.match(source, /revoke delete on table public\.event_checkins from anon, authenticated/i);
});

test('changed inline browser scripts parse after module imports are removed', () => {
  for (const file of [
    'apps/rel8tion-app/k.html',
    'apps/rel8tion-app/agent-dashboard.html',
    'apps/rel8tion-app/agent-home.html',
    'apps/rel8tion-app/field-dashboard.html'
  ]) {
    for (const source of inlineScripts(file)) {
      if (/^\s*src\s*=/.test(source)) continue;
      const parsedSource = source.replace(/^\s*import\s+[^;]+;\s*$/gm, '');
      assert.doesNotThrow(() => new Function(parsedSource), `${file} contains invalid inline JavaScript`);
    }
  }
});

test('NFC session signature, expiry, and agent binding are enforced', () => {
  process.env.AGENT_NFC_SESSION_SECRET = 'test-only-agent-nfc-session-secret';
  const session = require('../lib/agent-nfc-session');
  const token = session.makeSession('test-agent', 'test-uid', 'event_pass_keychain');
  const request = { headers: { cookie: `${session.SESSION_COOKIE}=${encodeURIComponent(token)}` } };
  assert.equal(session.readSession(request).slug, 'test-agent');
  const tampered = `${token.slice(0, -1)}${token.endsWith('a') ? 'b' : 'a'}`;
  assert.equal(session.readSession({ headers: { cookie: `${session.SESSION_COOKIE}=${tampered}` } }), null);
});
