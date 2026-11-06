'use strict';
const { fixtures } = require('./fixtures');
const { generateConversation } = require('./model');
const PURPOSE = 'buyer_relationship_followup';
class BuyerAiService {
  constructor({ agentId = 'demo-maya', model = generateConversation, clock = () => new Date().toISOString() } = {}) { this.data = fixtures(agentId); this.model = model; this.clock = clock; this.receipts = new Map(); this.queue = Promise.resolve(); }
  lead(id) { const row = this.data.leads.find(x => x.id === id && x.agentId === this.data.agent.id); if (!row) throw Object.assign(new Error('Lead is not assigned to this workspace'), { status: 404 }); return row; }
  scope(actor) { if (actor !== this.data.agent.id) throw Object.assign(new Error('Workspace access denied'), { status: 403 }); }
  reasons(lead, channel) {
    const { agent } = this.data; const reasons = [];
    if (!this.data.synthetic || !lead.synthetic || !lead.id.startsWith('demo-')) reasons.push('synthetic_records_required');
    if (!agent.membership.active || !agent.membership.entitlements.includes('assisted_follow_up')) reasons.push('paid_followup_entitlement_required');
    if (!lead.verifiedIdentity || lead.identityConflict !== false || !lead.canonicalContactId || lead.source.originatingAgentId !== agent.id) reasons.push('verified_originating_agent_required');
    if (!lead.representation.verified || (lead.representation.status !== 'unrepresented' && !(lead.representation.status === 'represented' && lead.representation.agentId === agent.id))) reasons.push('representation_review_required');
    if (this.data.globalPaused || lead.paused || lead.takeover) reasons.push(lead.takeover ? 'human_takeover' : 'paused');
    if (!['sms', 'email'].includes(channel)) reasons.push('unsupported_channel');
    if (lead.consent.purpose !== PURPOSE || lead.consent.agentId !== agent.id || lead.consent[channel] !== true) reasons.push('channel_consent_required');
    if (lead.suppression[channel] !== false) reasons.push('suppressed_or_unknown');
    if (channel === 'sms' && !/^\+120255501\d{2}$/.test(lead.phone || '')) reasons.push('fixture_destination_required');
    if (channel === 'email' && !/^[a-z]+@example\.test$/.test(lead.email || '')) reasons.push('fixture_destination_required');
    return reasons;
  }
  matches(lead) {
    const quotes = lead.facts.map(x => x.quote).join(' ');
    if (!/\b(?:I|we) (?:need|want|prefer)[^.?!\n]*\byard\b/i.test(quotes)) return [];
    return this.data.properties.filter(p => p.yard).map(p => ({ ...p, reason: 'Fictional yard match to buyer-stated preference', sourceMessageIds: lead.facts.filter(x => x.category === 'yard').map(x => x.sourceMessageId) }));
  }
  snapshot(actor) { this.scope(actor); return structuredClone({ ...this.data, mode: 'synthetic_preview', model: 'AI SDK offline fixture', realSendingAllowed: false, leads: this.data.leads.map(row => ({ ...row, matches: this.matches(row), eligibility: Object.fromEntries(['sms', 'email'].map(c => [c, this.reasons(row, c)])) })) }); }
  async act(actor, input) {
    this.scope(actor);
    const run = async () => {
      const key = String(input.requestId || ''); if (!/^[a-zA-Z0-9:_-]{8,100}$/.test(key)) throw Object.assign(new Error('A stable request ID is required'), { status: 400 });
      const fingerprint = JSON.stringify(input); const prior = this.receipts.get(key);
      if (prior) { if (prior !== fingerprint) throw Object.assign(new Error('Request ID already used for another action'), { status: 409 }); return this.snapshot(actor); }
      if (this.receipts.size >= 500) throw Object.assign(new Error('Synthetic session action limit reached; open a new fixture workspace'), { status: 429 });
      if (input.action === 'run') { for (const lead of this.data.leads) await this.firstTouch(lead); }
      else if (input.action === 'reply') await this.reply(this.lead(input.leadId), input);
      else if (['pause', 'resume', 'takeover', 'release'].includes(input.action)) { const lead = this.lead(input.leadId); if (input.action === 'pause' || input.action === 'resume') lead.paused = input.action === 'pause'; else lead.takeover = input.action === 'takeover'; }
      else if (input.action === 'revoke') { const lead = this.lead(input.leadId); if (!['sms', 'email'].includes(input.channel)) throw Object.assign(new Error('Invalid channel'), { status: 400 }); lead.consent[input.channel] = false; lead.suppression[input.channel] = true; }
      else if (input.action === 'acknowledge') { const lead = this.lead(input.leadId); const opportunity = lead.opportunities.find(x => x.id === input.opportunityId); if (!opportunity) throw Object.assign(new Error('Opportunity not found'), { status: 404 }); opportunity.status = 'agent_reviewed'; lead.takeover = true; }
      else throw Object.assign(new Error('Unsupported preview action'), { status: 400 });
      this.receipts.set(key, fingerprint); return this.snapshot(actor);
    };
    const next = this.queue.then(run); this.queue = next.catch(() => {}); return next;
  }
  addMessage(lead, role, text, channel) { const row = { id: `${lead.id}:message:${++lead.sequence}`, role, text, channel, createdAt: this.clock() }; lead.messages.push(row); return row; }
  async firstTouch(lead) {
    if (lead.enrollment) return;
    const channels = ['sms', 'email'].filter(c => !this.reasons(lead, c).length); if (!channels.length) return;
    const generated = await this.model({ lead: structuredClone(lead), agent: this.data.agent, property: this.property(lead) });
    const current = channels.filter(c => !this.reasons(lead, c).length); if (!current.length) return;
    lead.enrollment = { key: `${lead.canonicalContactId}:${lead.agentId}:${PURPOSE}`, status: 'preview_only', createdAt: this.clock() };
    const message = this.addMessage(lead, 'assistant', generated.text, 'shared_draft');
    for (const channel of current) this.simulate(lead, message, channel);
  }
  property(lead) { return this.data.properties.find(x => x.id === lead.source.propertyId); }
  simulate(lead, message, channel) {
    if (this.reasons(lead, channel).length) return;
    const attemptKey = `${lead.agentId}:${lead.id}:${message.id}:${channel}`;
    if (lead.deliveries.some(x => x.key === attemptKey)) return;
    lead.deliveries.push({ id: `simulation:${attemptKey}`, key: attemptKey, messageId: message.id, channel, status: 'simulated', providerId: null, submitted: false, delivered: false, at: this.clock() });
  }
  async reply(lead, input) {
    const text = typeof input.text === 'string' ? input.text.trim() : ''; const channel = input.channel;
    if (!text || text.length > 1000 || !['sms', 'email'].includes(channel)) throw Object.assign(new Error('Enter a reply of 1–1,000 characters on SMS or email'), { status: 400 });
    if (!lead.enrollment) throw Object.assign(new Error('Run eligible synthetic follow-up first'), { status: 409 });
    const source = this.addMessage(lead, 'buyer', text, channel);
    if (/^(stop|stopall|unsubscribe|cancel|end|quit)$/i.test(text)) { lead.suppression[channel] = true; lead.consent[channel] = false; if (channel === 'sms') { lead.suppression.email = true; lead.consent.email = false; } return; }
    if (/\b(?:i have|working with|my) (?:another |a different )?agent\b/i.test(text)) { lead.representation = { status: 'unknown', verified: false, agentId: null }; this.handoff(lead, source, 'representation_review'); return; }
    if (this.reasons(lead, channel).length) return;
    const generated = await this.model({ lead: structuredClone(lead), agent: this.data.agent, property: this.property(lead), reply: text });
    if (this.reasons(lead, channel).length) return;
    for (const fact of generated.facts) {
      if (!['yard', 'bedrooms', 'timing'].includes(fact.category) || typeof fact.quote !== 'string' || !text.includes(fact.quote)) continue;
      if (!lead.facts.some(x => x.category === fact.category && x.quote === fact.quote)) lead.facts.push({ ...fact, sourceMessageId: source.id, confidence: 'buyer_stated', at: this.clock() });
    }
    const message = this.addMessage(lead, 'assistant', generated.text, channel); this.simulate(lead, message, channel);
    const explicitIntent = { showing: /\b(?:show|showing|see it|visit)\b/i, consultation: /\b(?:call me|consultation|speak to my agent)\b/i, offer_preparation: /\b(?:offer|bid)\b/i };
    if (explicitIntent[generated.request]?.test(text)) this.handoff(lead, source, generated.request);
  }
  handoff(lead, source, kind) { if (!lead.opportunities.some(x => x.sourceMessageId === source.id && x.kind === kind)) lead.opportunities.push({ id: `${source.id}:${kind}`, kind, ownerAgentId: lead.agentId, sourceMessageId: source.id, status: 'needs_agent_review', quote: source.text, bookingConfirmed: false, offerSubmitted: false, loanOfficerNotified: false }); lead.takeover = true; }
}
module.exports = { BuyerAiService, PURPOSE };
