'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs');
const { BrokerWorkspace, fixtures, summary, ORG } = require('../lib/broker-workspace');
const { createHandler } = require('../api/broker-preview');
const actor = { userId: 'demo-broker', role: 'broker', organizationId: ORG };
const action = (service, fields) => service.act(actor, { reason: 'Explicit fixture test action', ...fields });
test('weekend totals are derived from 12 held events and 8 distinct hosts, with one zero-checkin event', () => {
  const report = new BrokerWorkspace().snapshot(actor).report;
  assert.deepEqual([report.activeHosts, report.held, report.recorded, report.checkins, report.uniqueVisitors], [8, 12, 11, 134, 124]);
  assert.deepEqual([report.signed, report.refusals, report.missing], [131, 1, 2]);
  assert.equal(report.events[0].town, 'Cedarhurst'); assert.equal(report.events[0].checkins, 22);
  assert.equal(report.events[0].hostId, 'demo-agent-0'); assert.equal(report.events[0].listingAgentId, 'demo-agent-1');
});
test('exclusive-end reporting period excludes next weekend, other office, and non-held events', () => {
  const state = fixtures(); state.events.push({ ...state.events[0], id: 'cancelled', status: 'cancelled' });
  assert.equal(summary(state, ORG).held, 12);
  const next = summary(state, ORG, { start: '2026-11-14T00:00:00-05:00', end: '2026-11-15T00:00:00-05:00' }); assert.equal(next.held, 0);
  for (const range of [{ start: 'bad' }, { start: '2026-11-09', end: '2026-11-08' }, { start: '2026-01-01', end: '2027-01-01' }]) assert.throws(() => summary(state, ORG, range), { status: 400 });
});
test('server authorization rejects agent roles and forged organizations', () => {
  const service = new BrokerWorkspace(); for (const forged of [null, { ...actor, role: 'agent' }, { ...actor, organizationId: 'demo-other' }]) assert.throws(() => service.snapshot(forged), { status: 403 });
  const snapshot = service.snapshot(actor); assert.equal(JSON.stringify(snapshot).includes('Other office agent'), false);
  assert.throws(() => service.archiveManifest(actor, 'demo-other-event'), { status: 404 });
});
test('lead assignment preserves origin, representation, and each channel consent; outside agents rejected', () => {
  const s = new BrokerWorkspace(), before = s.snapshot(actor).leads[0]; action(s, { type: 'reassign_lead', leadId: before.id, agentId: 'demo-agent-1' });
  const after = s.snapshot(actor).leads[0]; assert.equal(after.originAgentId, before.originAgentId); assert.equal(after.assignedAgentId, 'demo-agent-1'); assert.deepEqual(after.consent, before.consent);
  assert.throws(() => action(s, { type: 'reassign_lead', leadId: 'demo-lead-represented', agentId: 'demo-agent-1' }), { status: 409 });
  assert.throws(() => action(s, { type: 'reassign_lead', leadId: before.id, agentId: 'demo-other-agent' }), { status: 404 });
});
test('removing office access does not erase event evidence or award production', () => {
  const s = new BrokerWorkspace(), original = s.archiveManifest(actor, 'demo-event-7');
  action(s, { type: 'deactivate_agent', agentId: 'demo-agent-7' });
  assert.equal(s.snapshot(actor).agents.find(a => a.id === 'demo-agent-7').status, 'inactive'); assert.deepEqual(s.archiveManifest(actor, 'demo-event-7'), original);
  assert.equal(s.snapshot(actor).report.activeHosts, 8); // historical hosts, not current active roster
  assert.ok(s.snapshot(actor).report.leaderboard.every(x => x.production === null));
  assert.throws(() => action(s, { type: 'deactivate_agent', agentId: 'demo-agent-0' }), { status: 409 });
});
test('roster adds a pending member, not a licensed/authorized account or sent invitation', () => {
  const s = new BrokerWorkspace(); action(s, { type: 'add_agent', name: 'Fictional Jamie', email: 'jamie@example.test' }); const agent = s.snapshot(actor).agents.at(-1);
  assert.equal(agent.status, 'pending_verification'); assert.equal(agent.licenseStatus, 'not_verified');
  assert.throws(() => action(s, { type: 'add_agent', name: 'Real Jamie', email: 'jamie@example.com' }), { status: 400 });
  assert.throws(() => action(s, { type: 'add_agent', name: 'Fictional Jamie', email: 'jamie@example.test' }), { status: 409 });
});
test('form policy supplements future check-in; it cannot replace state forms or alter historical evidence', () => {
  const s = new BrokerWorkspace(), before = s.archiveManifest(actor, 'demo-event-0');
  assert.equal(s.formsForEvent(actor, 'demo-next').supplements.length, 0);
  action(s, { type: 'enable_form', formId: 'demo-approved-form' });
  assert.equal(s.formsForEvent(actor, 'demo-next').supplements.length, 1); assert.equal(s.formsForEvent(actor, 'demo-next').required.length, 2);
  assert.equal(s.formsForEvent(actor, 'demo-event-0').supplements.length, 0); assert.deepEqual(s.archiveManifest(actor, 'demo-event-0'), before);
});
test('uploaded PDF draft is hashed and held for scanning/review, never published or exposed as bytes', () => {
  const s = new BrokerWorkspace(), id = s.addDraft(actor, { title: 'Test office notice', bytes: Buffer.from('%PDF-1.7 test synthetic') });
  const draft = s.snapshot(actor).forms.find(f => f.id === id); assert.match(draft.hash, /^[a-f0-9]{64}$/); assert.equal(draft.bytes, undefined); assert.equal(draft.enabled, false);
  assert.throws(() => action(s, { type: 'enable_form', formId: id }), { status: 409 });
  assert.throws(() => s.addDraft(actor, { title: 'Bad file', bytes: Buffer.from('<html>bad') }), { status: 400 });
});
test('ties share rank and the audit records actor plus old/new assignment', () => {
  const s = new BrokerWorkspace(); action(s, { type: 'reassign_lead', leadId: 'demo-lead-open', agentId: 'demo-agent-1' }); const audit = s.snapshot(actor).audit[0];
  assert.equal(audit.actor, actor.userId); assert.equal(audit.before.assignedAgentId, 'demo-agent-0'); assert.equal(audit.after.assignedAgentId, 'demo-agent-1');
  const fixture = fixtures(); fixture.events = fixture.events.slice(0, 2); fixture.events[1].checkins = fixture.events[0].checkins;
  assert.deepEqual(summary(fixture, ORG).leaderboard.slice(0, 2).map(r => r.rank), [1, 1]);
});
const response = () => ({ headers: {}, setHeader(k,v) { this.headers[k.toLowerCase()] = v; }, end(value) { this.body = JSON.parse(value); } });
const request = (extra = {}) => ({ method: 'GET', url: '/api/broker-preview', headers: { host: '127.0.0.1:8772' }, socket: { remoteAddress: '127.0.0.1' }, ...extra });
test('API is disabled by default and rejects external address and foreign origin', async () => {
  for (const [handler, req, status] of [[createHandler(), request(), 404], [createHandler({ enabled: true }), request({ socket: { remoteAddress: '10.0.0.2' } }), 404], [createHandler({ enabled: true }), request({ headers: { host: '127.0.0.1:8772', origin: 'https://other.example' } }), 403]]) { const res = response(); await handler(req, res); assert.equal(res.statusCode, status); }
});
test('API requires CSRF and ignores forged actor/organization from request body', async () => {
  const handler = createHandler({ enabled: true }), first = response(); await handler(request(), first); const cookie = first.headers['set-cookie'].split(';')[0];
  const body = { type: 'reassign_lead', leadId: 'demo-lead-open', agentId: 'demo-agent-1', reason: 'Coverage in synthetic test', actor: { role: 'platform_admin' }, organizationId: 'demo-other' };
  const bad = response(); await handler(request({ method: 'POST', headers: { host: '127.0.0.1:8772', cookie }, body }), bad); assert.equal(bad.statusCode, 403);
  const good = response(); await handler(request({ method: 'POST', headers: { host: '127.0.0.1:8772', cookie, 'x-preview-csrf': first.body.csrf }, body }), good); assert.equal(good.statusCode, 200); assert.equal(good.body.audit[0].actor, 'demo-broker'); assert.equal(good.body.organization.id, ORG);
});
test('PDF upload API parses a real fixture PDF and holds it as an unpublished draft', async () => {
  const { PDFDocument } = require('pdf-lib'), handler = createHandler({ enabled: true }), first = response(); await handler(request(), first);
  const pdf = await PDFDocument.create(); pdf.addPage(); const bytes = await pdf.save();
  const headers = { host: '127.0.0.1:8772', cookie: first.headers['set-cookie'].split(';')[0], 'x-preview-csrf': first.body.csrf };
  const good = response(); await handler(request({ method: 'POST', headers, body: { type: 'upload_form', title: 'Fictional office notice', base64: Buffer.from(bytes).toString('base64') } }), good);
  assert.equal(good.statusCode, 200); assert.equal(good.body.forms.at(-1).state, 'draft_pending_scan_and_review'); assert.equal(good.body.forms.at(-1).bytes, undefined);
  const bad = response(); await handler(request({ method: 'POST', headers, body: { type: 'upload_form', title: 'Fake PDF', base64: Buffer.from('%PDF-1.7 broken').toString('base64') } }), bad); assert.equal(bad.statusCode, 400);
});
test('browser report date boundaries follow New York offsets across spring and autumn DST', () => {
  const vm = require('node:vm'); const source = fs.readFileSync('apps/rel8tion-app/src/modules/broker/workspace.js', 'utf8').replace('export async function mountBrokerWorkspace', 'async function mountBrokerWorkspace');
  const c = vm.createContext({ Intl, Date }); vm.runInContext(source, c);
  for (const [day, offset] of [['2026-03-08', '-05:00'], ['2026-03-09', '-04:00'], ['2026-11-01', '-04:00'], ['2026-11-02', '-05:00']]) assert.equal(vm.runInContext(`nyMidnight('${day}')`, c), `${day}T00:00:00${offset}`);
});
test('all review projects disable automatic deployment for broker branch; universal auth remains default', () => {
  for (const file of ['vercel.json', 'apps/rel8tion-app/vercel.json', 'apps/mockup-renderer/vercel.json']) assert.equal(JSON.parse(fs.readFileSync(file)).git.deploymentEnabled['feature/broker-workspace-review-2026-11-06'], false);
  const app = fs.readFileSync('apps/rel8tion-app/app.html', 'utf8'); assert.match(app, /brokerFixture.*\[/); assert.match(app, /loadSession\(\);/); assert.match(app, /workspace.role === 'broker'/);
});
