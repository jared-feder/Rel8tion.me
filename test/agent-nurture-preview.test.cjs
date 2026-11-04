'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { CAMPAIGN, STEPS, previewAgentNurture } = require('../lib/agent-nurture-preview');
const NOW = '2026-11-04T15:00:00.000Z';

function fixture() {
  return {
    now: NOW,
    snapshot: Object.fromEntries(['relationships', 'enrollments', 'consents', 'suppressions', 'touches', 'sender_controls']
      .map((source) => [source, { complete: true, checked_at: NOW }])),
    relationships: [{ id: 'agent-1', canonical_key: 'phone:2025550100', name: 'Test Agent',
      phone: '(202) 555-0100', email: 'agent@example.test', worked_with_agent: true, open_conversation: false,
      identity_verified: true, identity_evidence_ref: 'synthetic-person-match:agent-1' }],
    enrollments: [{ id: 'enrollment-1', relationship_id: 'agent-1', campaign: CAMPAIGN,
      enrolled_at: '2026-09-01T15:00:00.000Z', status: 'preview' }],
    consents: STEPS.map((step, index) => ({ id: 'consent-' + index, relationship_id: 'agent-1',
      channel: step.channel, purpose: step.purpose, recipient: step.channel === 'sms' ? '+12025550100' : 'agent@example.test',
      status: 'granted', explicit: true, evidence_ref: 'synthetic-fixture:' + index,
      disclosure_version: 'agent-nurture-v1', occurred_at: '2026-09-01T15:00:00.000Z' })),
    suppressions: [], touches: [],
    sender_controls: {
      sms: { paused: false, health_ok: true, capacity_available: true, operator_mode: 'away' },
      email: { paused: false, health_ok: true, capacity_available: true }
    }
  };
}
function first(input) { return previewAgentNurture(input).results[0]; }
function blocks(input, reason) {
  const row = first(input);
  assert.equal(row.state, 'blocked');
  assert.ok(row.reasons.includes(reason), JSON.stringify(row));
  assert.equal(row.send_allowed, false);
}
function touch(stepIndex = 0, at = '2026-09-02T15:00:00.000Z', overrides = {}) {
  const step = STEPS[stepIndex];
  return { id: 'touch-' + stepIndex, relationship_id: 'agent-1', enrollment_id: 'enrollment-1', campaign: CAMPAIGN,
    step_key: step.key, channel: step.channel, direction: 'outbound', status: 'accepted', occurred_at: at, ...overrides };
}

test('preview has no dispatch capability and never mutates input', () => {
  const input = fixture();
  const before = structuredClone(input);
  const result = previewAgentNurture(input);
  assert.deepEqual(input, before);
  assert.equal(result.mode, 'preview_only');
  assert.equal(result.send_allowed, false);
  assert.equal(result.results[0].state, 'review_ready');
  assert.equal(result.results[0].send_allowed, false);
  assert.equal(result.results[0].step.key, 'pass-checkin');
  assert.equal(JSON.stringify(result).includes('2025550100'), false, 'output omits destination contact data');
});
test('requires an explicit clock', () => assert.throws(() => previewAgentNurture(), /now timestamp/));
test('requires worked-with evidence instead of a scraped prospect or a pin', () => {
  const input = fixture(); input.relationships[0].worked_with_agent = false; input.relationships[0].pinned = true;
  blocks(input, 'no_worked_with_evidence');
});
test('does not auto-enroll known contacts', () => {
  const input = fixture(); input.enrollments = []; blocks(input, 'not_enrolled_for_preview');
});
test('duplicate enrollment fails closed', () => {
  const input = fixture(); input.enrollments.push({ ...input.enrollments[0], id: 'other' });
  blocks(input, 'ambiguous_enrollment');
});
test('paused or live enrollments are not activated by preview', () => {
  for (const status of ['paused', 'active', undefined]) {
    const input = fixture(); input.enrollments[0].status = status; blocks(input, 'preview_enrollment_paused');
  }
});
test('invalid enrollment timestamps do not become ready', () => {
  for (const enrolledAt of ['', 'invalid', '2027-01-01T00:00:00Z']) {
    const input = fixture(); input.enrollments[0].enrolled_at = enrolledAt; blocks(input, 'invalid_enrollment');
  }
});
test('duplicate canonical identities are never silently merged', () => {
  const input = fixture(); input.relationships.push({ ...input.relationships[0], id: 'agent-2', phone: '2025550111' });
  blocks(input, 'ambiguous_identity');
});
test('shared phone identities are review-only even when canonical keys differ', () => {
  const input = fixture(); input.relationships.push({ ...input.relationships[0], id: 'agent-2', canonical_key: 'slug:other' });
  blocks(input, 'shared_recipient_requires_review');
});
test('invalid or unsupported phone formats fail closed', () => {
  for (const phone of ['', '123', '+442079460123']) {
    const input = fixture(); input.relationships[0].phone = phone; blocks(input, 'missing_valid_recipient');
  }
});
test('consent is per relationship, destination, channel and purpose', () => {
  for (const change of [{ relationship_id: 'someone-else' }, { recipient: '+12025550111' },
    { channel: 'email' }, { purpose: 'event_transactional' }]) {
    const input = fixture(); input.consents = [{ ...input.consents[0], ...change }];
    blocks(input, 'missing_channel_purpose_consent');
  }
});
test('event-only SMS consent cannot authorize a recurring marketing campaign', () => {
  const input = fixture(); input.consents = [{ consent_status: 'opted_in', phone_normalized: '2025550100',
    consent_source: 'sms-consent-page', consent_text: 'I agree to event-related SMS.' }];
  blocks(input, 'missing_channel_purpose_consent');
});
test('consent evidence is mandatory', () => {
  for (const key of ['explicit', 'evidence_ref', 'disclosure_version', 'id']) {
    const input = fixture(); delete input.consents[0][key]; blocks(input, 'consent_evidence_missing');
  }
});
test('later revocation and same-time revocation win over grants', () => {
  for (const at of ['2026-09-01T15:00:00.000Z', '2026-10-01T15:00:00.000Z']) {
    const input = fixture(); input.consents.push({ ...input.consents[0], id: 'revocation', status: 'revoked', occurred_at: at });
    blocks(input, 'consent_not_granted');
  }
});
test('future or invalid consent dates fail closed', () => {
  for (const at of ['not-a-date', '2027-01-01T00:00:00Z']) {
    const input = fixture(); input.consents[0].occurred_at = at; blocks(input, 'invalid_consent_history');
  }
});
test('expired or malformed consent expiry fails closed', () => {
  for (const at of [NOW, 'not-a-date']) {
    const input = fixture(); input.consents[0].expires_at = at; blocks(input, 'consent_expired');
  }
});
test('global SMS suppression overrides explicit fresh consent and formatting', () => {
  const input = fixture(); input.suppressions = [{ channel: 'sms', recipient: '1 (202) 555-0100', active: true }];
  blocks(input, 'recipient_suppressed');
});
test('relationship-wide do-not-contact suppression overrides every channel', () => {
  const input = fixture(); input.suppressions = [{ channel: 'all', relationship_id: 'agent-1' }];
  blocks(input, 'recipient_suppressed');
});
test('existing opted-out relationship state is preserved', () => {
  const input = fixture(); input.relationships[0].relationship_status = 'opted_out'; blocks(input, 'relationship_suppressed');
});
test('missing, partial, stale and future reads are not a clean suppression result', () => {
  for (const proof of [undefined, { complete: false, checked_at: NOW },
    { complete: true, checked_at: '2026-11-04T14:54:00Z' }, { complete: true, checked_at: '2027-01-01T00:00:00Z' }]) {
    const input = fixture(); input.snapshot.suppressions = proof; blocks(input, 'unverified_suppressions');
  }
});
test('claimed completeness cannot replace a missing data collection', () => {
  const input = fixture(); delete input.suppressions; blocks(input, 'missing_suppressions');
});
test('live sender safeguards cannot be bypassed by the planner', () => {
  for (const [key, value, reason] of [['paused', true, 'sender_paused_or_unknown'],
    ['health_ok', false, 'sender_health_not_verified'], ['capacity_available', false, 'sender_capacity_not_verified'],
    ['operator_mode', 'manual', 'manual_operator_mode']]) {
    const input = fixture(); input.sender_controls.sms[key] = value; blocks(input, reason);
  }
});
test('pending or unverified human conversations pause the funnel', () => {
  const input = fixture(); input.relationships[0].open_conversation = true; blocks(input, 'human_follow_up_pending');
  delete input.relationships[0].open_conversation; blocks(input, 'conversation_state_unverified');
  input.relationships[0].open_conversation = false; input.relationships[0].follow_up_marked = true;
  blocks(input, 'human_follow_up_pending');
});
test('New York quiet hours and recipient quiet hours are both respected', () => {
  const input = fixture(); input.now = '2026-11-05T03:00:00Z';
  for (const source of Object.values(input.snapshot)) source.checked_at = input.now;
  blocks(input, 'quiet_hours_new_york');
  const other = fixture(); other.relationships[0].timezone = 'America/Los_Angeles'; blocks(other, 'quiet_hours_recipient');
});
test('DST change retains the New York quiet-hour boundary', () => {
  const input = fixture();
  for (const now of ['2026-10-31T11:59:00Z', '2026-11-02T12:59:00Z']) {
    input.now = now; for (const source of Object.values(input.snapshot)) source.checked_at = now;
    blocks(input, 'quiet_hours_new_york');
  }
});
test('invalid recipient timezone is held for review', () => {
  const input = fixture(); input.relationships[0].timezone = 'not-a-zone'; blocks(input, 'invalid_recipient_timezone');
});
test('provider acceptance advances the preview without claiming delivery', () => {
  const input = fixture(); input.touches = [touch()];
  const result = first(input); assert.equal(result.step.key, 'news-and-stats'); assert.equal(result.state, 'review_ready');
});
test('email requires its own consent and suppression checks', () => {
  const input = fixture(); input.touches = [touch()]; input.consents = input.consents.filter((item) => item.channel !== 'email');
  blocks(input, 'missing_channel_purpose_consent');
  const suppressed = fixture(); suppressed.touches = [touch()];
  suppressed.suppressions = [{ channel: 'email', recipient: 'AGENT@example.test', active: true }];
  blocks(suppressed, 'recipient_suppressed');
});
test('shared email identities are not merged', () => {
  const input = fixture(); input.touches = [touch()];
  input.relationships.push({ ...input.relationships[0], id: 'agent-2', canonical_key: 'slug:other', phone: '2025550111' });
  blocks(input, 'shared_recipient_requires_review');
});
test('all-channel accepted outreach enforces a seven-day cooldown', () => {
  const input = fixture(); input.touches = [touch(0, '2026-11-02T15:00:00Z', { campaign: 'other-campaign' })];
  const result = first(input); assert.equal(result.state, 'waiting'); assert.equal(result.next_review_at, '2026-11-09T15:00:00.000Z');
});
test('channel cap counts other campaigns over rolling 30 days', () => {
  const input = fixture(); input.touches = [touch(0, '2026-10-10T15:00:00Z', { campaign: 'other' }),
    touch(0, '2026-10-20T15:00:00Z', { campaign: 'other', id: 'other-touch' })];
  const result = first(input); assert.equal(result.state, 'waiting'); assert.equal(result.next_review_at, '2026-11-09T15:00:00.000Z');
});
test('uncertain and failed attempts never trigger a blind retry', () => {
  for (const status of ['unknown', 'submitting', 'failed', 'blocked']) {
    const input = fixture(); input.touches = [touch(0, undefined, { status })];
    blocks(input, 'prior_attempt_requires_reconciliation');
  }
});
test('invalid history timestamps cannot make a candidate ready', () => {
  const input = fixture(); input.touches = [touch(0, 'not-a-date')]; blocks(input, 'invalid_contact_history');
});
test('preview is deterministic and idempotency does not change on re-run', () => {
  const input = fixture(); assert.deepEqual(previewAgentNurture(input), previewAgentNurture(input));
  assert.equal(first(input).idempotency_key, CAMPAIGN + ':enrollment-1:pass-checkin');
});
test('four-touch sequence ends without automatic re-enrollment', () => {
  const input = fixture(); input.touches = STEPS.map((_, index) => touch(index));
  const result = first(input); assert.equal(result.state, 'completed'); assert.equal(result.send_allowed, false);
});
test('uncertain sends in other campaigns and older enrollments pause every next step', () => {
  for (const overrides of [{ status: 'unknown', campaign: 'other-campaign' },
    { status: 'submitting', enrollment_id: 'old-enrollment' }]) {
    const input = fixture(); input.touches = [touch(0, '2026-11-04T14:59:00Z', overrides)];
    blocks(input, 'unresolved_outbound_attempt');
  }
});
test('a conflicting terminal outcome cannot be overridden by earlier acceptance', () => {
  const input = fixture(); input.touches = [touch(), touch(0, '2026-09-02T15:01:00Z', { status: 'failed' })];
  blocks(input, 'conflicting_contact_outcomes');
});
test('malformed active suppression evidence fails closed', () => {
  for (const suppression of [{ relationship_id: 'agent-1', active: true },
    { channel: 'fax', recipient: '2025550100' }, { channel: 'sms', active: true }]) {
    const input = fixture(); input.suppressions = [suppression]; blocks(input, 'invalid_suppression_history');
  }
});
test('conflicting raw and normalized phone fields require human review', () => {
  const input = fixture(); input.relationships[0].phone_normalized = '2025550111';
  blocks(input, 'conflicting_recipient_fields');
});
test('canonical contact identity is not proof of a verified person', () => {
  for (const key of ['name', 'identity_verified', 'identity_evidence_ref']) {
    const input = fixture(); delete input.relationships[0][key]; blocks(input, 'person_identity_unverified');
  }
});
