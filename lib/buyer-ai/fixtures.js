'use strict';
// Synthetic, server-owned evidence. Never import production records into this store.
const AGENTS = Object.freeze([{ id: 'demo-maya', slug: 'maya-brooks', name: 'Maya Brooks', brokerage: 'Example Realty', membership: { active: true, entitlements: ['assisted_follow_up'] }, loanOfficer: { name: 'Sam Carter', consent: false } }, { id: 'demo-noah', slug: 'noah-wells', name: 'Noah Wells', brokerage: 'Example Realty', membership: { active: false, entitlements: [] }, loanOfficer: null }]);
function fixtures(agentId) {
  const agent = structuredClone(AGENTS.find(x => x.id === agentId));
  if (!agent) throw new Error('Unknown synthetic workspace');
  const base = { synthetic: true, agentId, verifiedIdentity: true, source: { kind: 'event_checkin', id: 'demo-checkin-1', eventId: 'demo-event-1', originatingAgentId: agentId, hostAgentId: 'demo-substitute-host', listingAgentId: agentId, propertyId: 'demo-property-1' }, representation: { status: 'unrepresented', verified: true, agentId: null }, consent: { sms: true, email: true, purpose: 'buyer_relationship_followup', agentId, version: 'demo-v1' }, suppression: { sms: false, email: false }, paused: false, takeover: false, messages: [], facts: [], opportunities: [], deliveries: [], enrollment: null, sequence: 0 };
  const leads = [
    { ...structuredClone(base), id: 'demo-alex', canonicalContactId: 'demo-crm-alex', name: 'Alex Rivera', phone: '+12025550144', email: 'alex@example.test' },
    { ...structuredClone(base), id: 'demo-jordan', canonicalContactId: 'demo-crm-jordan', name: 'Jordan Ellis', phone: '+12025550155', email: 'jordan@example.test', source: { ...base.source, kind: 'profile_lead', id: 'demo-profile-lead-2' }, representation: { status: 'represented', verified: true, agentId } },
    { ...structuredClone(base), id: 'demo-taylor', canonicalContactId: 'demo-crm-taylor', name: 'Taylor Reed', phone: '+12025550166', email: 'taylor@example.test', representation: { status: 'represented', verified: true, agentId: 'demo-other-agent' } },
    { ...structuredClone(base), id: 'demo-casey', canonicalContactId: 'demo-crm-casey', name: 'Casey Morgan', phone: '+12025550177', email: 'casey@example.test', consent: { ...base.consent, email: false } }
  ];
  leads.forEach((lead, i) => { lead.identityConflict = false; lead.source.id = `demo-source-${i + 1}`; });
  leads[3].source.eventId = 'demo-event-2';
  return { synthetic: true, agent, leads, properties: [{ id: 'demo-property-1', address: '18 Sample Lane', beds: 3, baths: 2, yard: false, area: 'Sample Village', price: 725000, source: 'fictional listing fixture' }, { id: 'demo-property-2', address: '42 Example Court', beds: 4, baths: 2, yard: true, area: 'Sample Village', price: 750000, source: 'fictional listing fixture' }], globalPaused: false };
}
module.exports = { AGENTS, fixtures };
