const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const visitId = '11111111-1111-4111-8111-111111111111';
const profileUid = '22222222-2222-4222-8222-222222222222';
const visit = { id:visitId, agent_name:'Jane Smith', agent_phone:'+15165551234', agent_email:'jane@example.test', brokerage:'Example Realty', scheduled_start:'2026-10-10T17:00:00Z', scheduled_end:'2026-10-10T19:00:00Z', outreach_queue_id:'queue' };
const profile = { uid:profileUid, full_name:'Test LO', phone:'+15165555678', slug:'test-lo' };

function load(file, dependencies = {}, globals = {}) {
  const module = { exports:{} };
  vm.runInNewContext(fs.readFileSync(path.join(root, file), 'utf8'), {
    require:(name) => dependencies[name] || require(name), module, exports:module.exports,
    process:{ env:{ SUPABASE_SERVICE_ROLE_KEY:'test-only-signing-secret', SUPABASE_URL:'https://example.test' } },
    Buffer, URL, console, ...globals
  }, { filename:file });
  return module.exports;
}

function setup(rest = async () => []) {
  const auth = { supabaseRest:rest, sendJson:(res, status, body) => { res.statusCode = status; res.body = body; } };
  const contact = load('lib/assignment-contact.js', { './admin-auth':auth });
  const handler = load('api/assignment-contact.js', { '../lib/admin-auth':auth, '../lib/assignment-contact':contact });
  return { contact, handler, auth };
}
const response = () => ({ headers:{}, setHeader(key, value) { this.headers[key] = value; }, end(body) { this.body = body; } });

test('contact capability expires, rejects tampering, and has no contact PII in its token', () => {
  const { contact } = setup();
  const token = new URL(contact.contactUrl(visitId, profileUid, 100000)).searchParams.get('token');
  assert.equal(contact.verifyContactToken(token, 100001).visitId, visitId);
  assert.equal(contact.verifyContactToken(token, 100000 + 31 * 86400000), null);
  assert.equal(contact.verifyContactToken(token + 'x', 100001), null);
  assert.equal(contact.verifyContactToken(token.replace(/^./, 'x'), 100001), null);
  assert.doesNotMatch(Buffer.from(token.split('.')[0], 'base64url').toString(), /Jane|555|example/);
});

test('contact download checks current primary assignment and returns only host business details', async () => {
  let assigned = true;
  const queries = [];
  const { contact, handler } = setup(async (query) => {
    queries.push(query);
    return query.startsWith('field_demo_visit_participants') ? (assigned ? [{ id:'participant' }] : []) : [visit];
  });
  const token = new URL(contact.contactUrl(visitId, profileUid)).searchParams.get('token');
  const res = response();
  await handler({ method:'GET', query:{ token } }, res);
  assert.equal(res.statusCode, 200);
  assert.match(res.headers['Content-Disposition'], /hosting-agent.vcf/);
  assert.match(res.body, /FN:Jane Smith\r\n/);
  assert.match(res.body, /EMAIL;TYPE=INTERNET,WORK:jane@example.test/);
  assert.match(queries[0], /is_primary=eq.true/);
  assert.match(queries[0], new RegExp(profileUid));
  assigned = false;
  const denied = response();
  await handler({ method:'GET', query:{ token } }, denied);
  assert.equal(denied.statusCode, 403);
  assert.equal(queries.length, 3, 'revoked link must not read contact details');
});

test('vCard escapes injected newlines and folds UTF-8 safely', () => {
  const { contact } = setup();
  const card = contact.agentVcard({ ...visit, agent_name:'\u00e9'.repeat(90), brokerage:'A;B,C\\D\r\nTEL:injected' });
  assert.match(card, /ORG:A\\;B\\,C\\\\D\\nTEL:injected/);
  assert.doesNotMatch(card, /\r\nTEL:injected/);
  for (const line of card.split('\r\n')) assert.ok(Buffer.byteLength(line) <= 75);
  assert.ok(card.replace(/\r\n /g, '').includes('\u00e9'.repeat(90)));
});

test('assignment SMS includes card, exact visit and public profile; preserves transactional routing and provider status', async () => {
  const { contact, auth } = setup(async () => [{ address:'123 Main St, NY', listing_photo_url:'https://example.test/house.jpg' }]);
  const calls = [];
  const assignment = load('api/admin/loan-officer-assignment.js', {
    '../../lib/admin-auth':auth, '../../lib/assignment-contact':contact
  }, { fetch:async (url, options) => { calls.push(JSON.parse(options.body)); return { ok:true, json:async () => ({ sms:{ ok:true, status:'queued', sid:'SM-test' } }) }; } });
  const results = await assignment.notifyConfirmedAssignment(visit, profile, { loanOfficerOnly:true });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].agent_phone, profile.phone);
  assert.equal(calls[0].category, 'event_transactional');
  assert.match(calls[0].message, /Save agent contact: https:\/\/app.rel8tion.me\/api\/assignment-contact\?token=/);
  assert.ok(calls[0].message.includes(`/loan-officer?visit=${visitId}`));
  assert.match(calls[0].message, /nmb-verified\?slug=test-lo/);
  assert.match(calls[0].message, /123 Main St/);
  assert.equal(results[0].status, 'queued');
  assert.equal(results[0].id, 'SM-test');
});

function browserFunction(file, start, end, globals) {
  const source = fs.readFileSync(path.join(root, file), 'utf8');
  const body = source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start)));
  return vm.runInNewContext(`(${body.trim()})`, { URLSearchParams, ...globals });
}

test('sign-in forwards the selected visit to open houses without accepting a redirect URL', async () => {
  let destination;
  const open = browserFunction('apps/rel8tion-app/loan-officer-account.html', 'async function openDashboard(', 'async function boot(', {
    assignmentVisit:visitId, message:() => {}, markDashboardUnlocked:() => {},
    location:{ replace:(url) => { destination = url; } },
    fetch:async () => ({ ok:true, json:async () => ({ profile }) })
  });
  await open({ access_token:'test' });
  const url = new URL(destination, 'https://app.rel8tion.me');
  assert.equal(url.pathname, '/field-dashboard');
  assert.equal(url.searchParams.get('visit'), visitId);
  assert.equal(url.searchParams.get('section'), 'lo-open-houses');
});

test('directions use Apple Maps on iPhone and Google Maps on Android', () => {
  for (const [userAgent, host] of [['iPhone', 'maps.apple.com'], ['Android', 'www.google.com']]) {
    const directions = browserFunction('apps/rel8tion-app/field-dashboard.html', 'function directionsHref(', 'function visitCalendarHref(', { navigator:{ userAgent } });
    assert.equal(new URL(directions('123 Main St')).host, host);
    assert.equal(directions(''), '#');
  }
});

test('changed browser inline scripts parse', () => {
  for (const file of ['field-dashboard.html', 'loan-officer-account.html']) {
    const source = fs.readFileSync(path.join(root, 'apps/rel8tion-app', file), 'utf8');
    for (const [, body] of source.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)) {
      new Function(body.replace(/^\s*import .*;\s*$/gm, ''));
    }
  }
});

test('authenticated property context keeps the save-contact link instead of overwriting it with queue data', async () => {
  const loadContexts = browserFunction('apps/rel8tion-app/field-dashboard.html', 'async function loadVisitContexts(', 'function relationshipRange(', {
    state:{ authSession:{ access_token:'test' } },
    fetch:async () => ({ ok:true, json:async () => ({ visit_contexts:[{ visit_id:visitId, id:visitId, address:'123 Main', agent_contact_url:'https://example.test/card' }] }) }),
    request:async () => { throw new Error('Authenticated context should not be replaced.'); }
  });
  const rows = await loadContexts([visit]);
  assert.equal(rows[0].agent_contact_url, 'https://example.test/card');
  assert.equal(rows[0].address, '123 Main');
});

test('linked assignment loads outside dashboard date range and keeps identity scope', async () => {
  const queries = [];
  const loadRows = browserFunction('apps/rel8tion-app/field-dashboard.html', 'async function loadParticipantRows(', 'function groupVisits(', {
    params:new URLSearchParams({ visit:visitId }), isUuid:() => true,
    state:{ profile, profileUids:[profileUid], uid:profileUid },
    request:async (query) => {
      queries.push(query);
      return query.includes('field_demo_visit_id=eq.') ? [{ id:'participant', field_demo_visits:visit }] : [];
    }
  });
  const rows = await loadRows({ start:new Date('2027-01-01'), end:new Date('2027-01-02') });
  assert.equal(rows.length, 1);
  assert.ok(queries.every((query) => query.includes(profileUid)));
});

test('blocked SMS is reported as warning, not delivered', async () => {
  const { contact, auth } = setup(async () => []);
  const assignment = load('api/admin/loan-officer-assignment.js', {
    '../../lib/admin-auth':auth, '../../lib/assignment-contact':contact
  }, { fetch:async () => ({ ok:true, json:async () => ({ sms:{ ok:false, status:'blocked' } }) }) });
  const result = await assignment.notifyConfirmedAssignment(visit, profile, { loanOfficerOnly:true });
  assert.equal(result[0].status, 'warning');
});

test('live coverage assignment sends the LO notification after saving its participant', async () => {
  const calls = [];
  let participantSaved = false;
  const { contact, auth } = setup(async (query, options = {}) => {
    if (query.startsWith('open_house_events')) return [{ id:visitId, host_agent_slug:'jane', start_time:visit.scheduled_start, end_time:visit.scheduled_end, setup_context:{ address:'123 Main' } }];
    if (query.startsWith('verified_profiles')) return [profile];
    if (query.startsWith('field_demo_visits')) return options.method === 'PATCH' ? [visit] : [visit];
    if (query === 'field_demo_visit_participants' && options.method === 'POST') { participantSaved = true; return [{ id:'participant' }]; }
    return [];
  });
  const assignment = load('api/admin/loan-officer-assignment.js', {
    '../../lib/admin-auth':auth, '../../lib/assignment-contact':contact
  }, { fetch:async (url, options) => {
    assert.equal(participantSaved, true);
    calls.push(JSON.parse(options.body));
    return { ok:true, json:async () => ({ sms:{ ok:true, status:'queued', sid:'SM-test' } }) };
  } });
  const result = await assignment.assignLiveCoverage(visitId, profileUid);
  assert.equal(result.field_assignment.notifications[0].id, 'SM-test');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].agent_phone, profile.phone);
});
