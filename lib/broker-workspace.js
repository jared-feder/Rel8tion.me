'use strict';
const { createHash } = require('node:crypto');
const fail = (status, message) => { throw Object.assign(new Error(message), { status }); };
const copy = value => structuredClone(value);
const ORG = 'demo-harbor';
const REQUIRED = Object.freeze(['NY agency disclosure', 'NY housing / anti-discrimination notice']);

function fixtures() {
  const names = ['Jackie Chen', 'Maya Brooks', 'Noah Reed', 'Sofia Lee', 'Marcus Bell', 'Ava Patel', 'Ethan Cole', 'Grace Park'];
  const agents = names.map((name, i) => ({ id: `demo-agent-${i}`, organizationId: ORG, name, status: 'active', licenseStatus: 'not_verified', production: null }));
  const counts = [22, 18, 16, 15, 14, 12, 10, 9, 8, 6, 4, 0];
  const towns = ['Cedarhurst', 'Woodmere', 'Hewlett', 'Lynbrook'];
  const events = counts.map((count, i) => ({ id: `demo-event-${i}`, organizationId: ORG, hostId: agents[i % 8].id, listingAgentId: agents[(i + 1) % 8].id, address: `${10 + i} Example Lane`, town: towns[i % 4], start: `2026-11-0${i < 6 ? 7 : 8}T${i % 2 ? '18' : '15'}:00:00Z`, end: `2026-11-0${i < 6 ? 7 : 8}T${i % 2 ? '20' : '17'}:00:00Z`, status: 'held', checkins: Array.from({ length: count }, (_, j) => ({ id: `demo-checkin-${i}-${j}`, visitorId: j === 0 ? 'demo-repeat-visitor' : `demo-visitor-${i}-${j}`, name: `Fictional visitor ${i + 1}.${j + 1}`, documents: i === 0 && j < 2 ? 'missing' : i === 1 && j === 0 ? 'refusal_recorded' : 'signed', packetVersion: 'synthetic-v1', capturedAt: `2026-11-0${i < 6 ? 7 : 8}T${i % 2 ? String(19) : String(16)}:10:00Z`, archived: true })) }));
  events.push({ id: 'demo-next', organizationId: ORG, hostId: agents[0].id, listingAgentId: agents[1].id, address: '42 Sample Court', town: 'Cedarhurst', start: '2026-11-14T18:00:00Z', end: '2026-11-14T20:00:00Z', status: 'scheduled', checkins: [] });
  // Adversarial fixture: these records must never enter the broker's snapshot.
  agents.push({ id: 'demo-other-agent', organizationId: 'demo-other', name: 'Other office agent', status: 'active' });
  events.push({ id: 'demo-other-event', organizationId: 'demo-other', hostId: 'demo-other-agent', status: 'held', start: '2026-11-07T18:00:00Z', end: '2026-11-07T20:00:00Z', checkins: [{ id: 'demo-other-checkin', visitorId: 'demo-other', documents: 'signed' }] });
  return { agents, events, leads: [{ id: 'demo-lead-open', organizationId: ORG, name: 'Fictional Alex', originAgentId: agents[0].id, assignedAgentId: agents[0].id, representation: 'unrepresented', consent: { sms: true, email: false } }, { id: 'demo-lead-represented', organizationId: ORG, name: 'Fictional Jordan', originAgentId: agents[0].id, assignedAgentId: agents[0].id, representation: 'existing_agent', consent: { sms: false, email: true } }], forms: [{ id: 'demo-approved-form', organizationId: ORG, title: 'Visitor information notice', version: 1, state: 'approved_fixture', enabled: false, effectiveAt: '2026-11-14T00:00:00-05:00', required: false, hash: 'fixture-only', review: 'Fictional broker approval; not legal review' }], audit: [] };
}

function summary(state, organizationId, range = {}) {
  const start = Date.parse(range.start || '2026-11-07T00:00:00-05:00');
  const end = Date.parse(range.end || '2026-11-09T00:00:00-05:00');
  if (!Number.isFinite(start) || !Number.isFinite(end) || start >= end || end - start > 93 * 86400000) fail(400, 'Choose a valid reporting period of up to 93 days');
  const agents = state.agents.filter(a => a.organizationId === organizationId);
  const events = state.events.filter(e => e.organizationId === organizationId && Date.parse(e.start) >= start && Date.parse(e.start) < end);
  const held = events.filter(e => e.status === 'held');
  const rows = held.flatMap(e => e.checkins);
  const leaderboard = agents.filter(a => held.some(e => e.hostId === a.id)).map(a => { const hosted = held.filter(e => e.hostId === a.id); return { agentId: a.id, name: a.name, held: hosted.length, checkins: hosted.reduce((n, e) => n + e.checkins.length, 0), signed: hosted.flatMap(e => e.checkins).filter(c => c.documents === 'signed').length, missing: hosted.flatMap(e => e.checkins).filter(c => c.documents === 'missing').length, production: null }; }).sort((a, b) => b.checkins - a.checkins || a.name.localeCompare(b.name));
  let rank = 0, previous; leaderboard.forEach((row, i) => { if (row.checkins !== previous) rank = i + 1; row.rank = rank; previous = row.checkins; });
  return { period: { start: new Date(start).toISOString(), endExclusive: new Date(end).toISOString(), timezone: 'America/New_York' }, activeHosts: new Set(held.map(e => e.hostId)).size, held: held.length, recorded: held.filter(e => e.checkins.length > 0).length, checkins: rows.length, uniqueVisitors: new Set(rows.map(c => c.visitorId)).size, signed: rows.filter(c => c.documents === 'signed').length, refusals: rows.filter(c => c.documents === 'refusal_recorded').length, missing: rows.filter(c => c.documents === 'missing').length, leaderboard, events: held.map(e => ({ ...e, checkins: e.checkins.length })).sort((a, b) => b.checkins - a.checkins) };
}

class BrokerWorkspace {
  constructor({ state = fixtures(), now = () => '2026-11-09T15:00:00Z' } = {}) { this.state = state; this.now = now; }
  authorize(actor) { if (!actor || actor.role !== 'broker' || actor.organizationId !== ORG || !actor.userId) fail(403, 'Broker workspace permission required'); }
  snapshot(actor, range) {
    this.authorize(actor);
    const scoped = key => copy(this.state[key].filter(x => x.organizationId === actor.organizationId));
    return { synthetic: true, organization: { id: ORG, name: 'Harbor Realty · fictional office' }, agents: scoped('agents'), calendar: scoped('events'), leads: scoped('leads'), forms: scoped('forms').map(({ bytes, ...rest }) => rest), audit: copy(this.state.audit.filter(x => x.organizationId === actor.organizationId)), report: summary(this.state, actor.organizationId, range), checkinPreview: this.formsForEvent(actor, 'demo-next') };
  }
  formsForEvent(actor, eventId) {
    this.authorize(actor);
    const event = this.state.events.find(e => e.id === eventId && e.organizationId === actor.organizationId);
    if (!event) fail(404, 'Event not found in this office');
    return { eventId, required: [...REQUIRED], supplements: this.state.forms.filter(f => f.organizationId === actor.organizationId && f.state === 'approved_fixture' && f.enabled && Date.parse(f.effectiveAt) <= Date.parse(event.start)).map(f => ({ id: f.id, title: f.title, version: f.version, required: false })), notice: 'Policy preview only. Live check-in capture has not been connected. Existing signed packets never change.' };
  }
  act(actor, action) {
    this.authorize(actor);
    if (!action || typeof action !== 'object') fail(400, 'Invalid action');
    const find = (key, id) => { const value = this.state[key].find(x => x.id === id && x.organizationId === actor.organizationId); if (!value) fail(404, 'Record not found in this office'); return value; };
    const reason = String(action.reason || '').trim();
    if (reason.length < 5 || reason.length > 300) fail(400, 'Provide an audit reason (5–300 characters)');
    let before, after;
    switch (action.type) {
      case 'add_agent': {
        const name = String(action.name || '').trim(), email = String(action.email || '').trim().toLowerCase();
        if (name.length < 2 || name.length > 100 || !/^[^\s@]+@example\.test$/.test(email)) fail(400, 'Use a fictional name and example.test email');
        if (this.state.agents.some(a => a.organizationId === ORG && a.email === email)) fail(409, 'This fixture email is already on the roster');
        after = { id: `demo-roster-${this.state.agents.length}`, organizationId: ORG, name, email, status: 'pending_verification', licenseStatus: 'not_verified', production: null }; this.state.agents.push(after); break;
      }
      case 'deactivate_agent': {
        const agent = find('agents', action.agentId);
        if (agent.status !== 'active') fail(409, 'Agent is not active');
        if (this.state.events.some(e => e.organizationId === ORG && e.hostId === agent.id && e.status === 'scheduled') || this.state.leads.some(l => l.organizationId === ORG && l.assignedAgentId === agent.id)) fail(409, 'Resolve assigned leads and upcoming events before removing access');
        before = copy(agent); agent.status = 'inactive'; after = copy(agent); break;
      }
      case 'reassign_lead': {
        const lead = find('leads', action.leadId), agent = find('agents', action.agentId);
        if (agent.status !== 'active') fail(409, 'Choose an active agent');
        if (lead.representation !== 'unrepresented') fail(409, 'Existing representation requires a separate reviewed transfer; it cannot be overridden here');
        if (lead.assignedAgentId === agent.id) fail(409, 'Lead is already assigned to this agent');
        before = copy(lead); lead.assignedAgentId = agent.id; after = copy(lead); break;
      }
      case 'enable_form': {
        const form = find('forms', action.formId);
        if (form.state !== 'approved_fixture') fail(409, 'Uploaded drafts require malware scanning and broker/legal review before publication');
        before = copy(form); form.enabled = !form.enabled; after = copy(form); break;
      }
      default: fail(400, 'Unknown broker action');
    }
    this.state.audit.push({ id: `audit-${this.state.audit.length + 1}`, organizationId: ORG, actor: actor.userId, type: action.type, reason, at: this.now(), before: before || null, after: copy(after) });
  }
  addDraft(actor, { title, bytes }) {
    this.authorize(actor);
    if (!Buffer.isBuffer(bytes) || bytes.length < 8 || bytes.length > 2 * 1024 * 1024 || bytes.subarray(0, 5).toString() !== '%PDF-' || typeof title !== 'string' || title.trim().length < 2 || title.length > 120) fail(400, 'Choose a PDF up to 2 MB and a short form title');
    if (this.state.forms.length >= 15) fail(409, 'Fixture form limit reached');
    const form = { id: `demo-form-${this.state.forms.length}`, organizationId: ORG, title: title.trim(), version: 1, state: 'draft_pending_scan_and_review', enabled: false, required: false, hash: createHash('sha256').update(bytes).digest('hex'), size: bytes.length, bytes: Buffer.from(bytes) };
    this.state.forms.push(form); this.state.audit.push({ id: `audit-${this.state.audit.length + 1}`, organizationId: ORG, actor: actor.userId, type: 'upload_draft', at: this.now(), reason: 'Local PDF draft received; not published', after: { id: form.id, hash: form.hash } });
    return form.id;
  }
  archiveManifest(actor, eventId) {
    this.authorize(actor);
    const event = this.state.events.find(e => e.id === eventId && e.organizationId === actor.organizationId);
    if (!event) fail(404, 'Event not found in this office');
    return { synthetic: true, eventId, address: event.address, hostId: event.hostId, listingAgentId: event.listingAgentId, records: copy(event.checkins), note: 'Synthetic evidence index only; no actual signed PDFs or legally executed refusal declarations are included.' };
  }
}
module.exports = { BrokerWorkspace, fixtures, summary, REQUIRED, ORG };
