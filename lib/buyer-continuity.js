'use strict';

// Internal review-only contract. This module does not authenticate input, resolve
// identity, read a database, generate messages, or grant permission to send.
// A future authenticated server resolver must supply every evidence record.
const PURPOSE = 'buyer_relationship_followup';
const POLICY_VERSION = 'buyer-continuity-review-v1';
const MAX_SNAPSHOT_AGE_MS = 5 * 60 * 1000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const E164 = /^\+[1-9][0-9]{7,14}$/;
const SLUG = /^[a-z0-9][a-z0-9._-]{0,179}$/;

function record(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function matches(pattern, value) {
  return typeof value === 'string' && pattern.test(value);
}

function nonempty(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function timestamp(value) {
  if (typeof value !== 'string') return NaN;
  const parsed = Date.parse(value);
  // The resolver normalizes DB timestamps to UTC ISO. Reject dates that parse
  // loosely, rollover dates, local times and timestamps without a timezone.
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value ? parsed : NaN;
}

function recent(value, now) {
  const time = timestamp(value);
  return Number.isFinite(time) && time <= now && now - time <= MAX_SNAPSHOT_AGE_MS;
}

function evidence(row, now) {
  return row.verified === true && nonempty(row.evidence_id) && recent(row.checked_at, now);
}

function reviewKey(buyerId, agentSlug) {
  if (!matches(UUID, buyerId) || !matches(SLUG, agentSlug)) return null;
  // No phone-only identity key. The future enrollment store must reserve this
  // exact canonical identity/owner/purpose/channel tuple atomically.
  return `buyer-followup:v1:${buyerId.toLowerCase()}:${agentSlug}:${PURPOSE}:sms`;
}

function assessBuyerContinuity(input = {}, nowIso) {
  const context = record(input);
  const source = record(context.checkin);
  const intake = record(context.intake);
  const buyer = record(context.buyer);
  const ownership = record(context.ownership);
  const consent = record(context.consent);
  const representation = record(context.representation);
  const membership = record(context.membership);
  const suppression = record(context.suppression);
  const controls = record(context.controls);
  const continuity = record(context.continuity);
  const reasons = [];
  const add = (reason) => { if (!reasons.includes(reason)) reasons.push(reason); };
  const now = timestamp(nowIso);
  if (!Number.isFinite(now)) add('invalid_evaluation_time');

  if (!matches(UUID, source.id) || !matches(UUID, source.open_house_event_id)) add('invalid_source');
  if (source.visitor_type !== 'buyer') add('not_unrepresented_buyer_checkin');
  if (source.represented_buyer_confirmed !== false) add('source_representation_unknown_or_present');
  if ([source.buyer_agent_name, source.buyer_agent_phone, source.buyer_agent_email].some(nonempty)
      || record(source.metadata).relationship_state === 'represented') add('source_representation_present');
  if (intake.intake_origin !== 'live_capture') add('historical_or_unknown_intake_requires_review');
  const sourceTime = timestamp(source.created_at);
  if (!Number.isFinite(sourceTime) || sourceTime > now) add('invalid_source_time');
  if (!evidence(intake, now) || intake.source_checkin_id !== source.id
      || intake.source_event_id !== source.open_house_event_id || intake.status !== 'pending_review'
      || intake.outbound_enabled !== false || !Number.isFinite(timestamp(intake.captured_at))
      || timestamp(intake.captured_at) < sourceTime
      || timestamp(intake.captured_at) > timestamp(intake.checked_at)) add('intake_not_reviewable');

  if (!evidence(buyer, now) || !matches(UUID, buyer.id) || buyer.checkin_id !== source.id
      || buyer.identity_status !== 'verified' || !matches(E164, buyer.phone_e164)) add('buyer_identity_unverified');
  if (!evidence(ownership, now) || ownership.event_id !== source.open_house_event_id
      || !matches(SLUG, ownership.listing_agent_slug)
      || ownership.followup_agent_slug !== ownership.listing_agent_slug) add('listing_agent_ownership_unverified');
  const owner = ownership.listing_agent_slug;

  // Check-in, seller-agency disclosure, lending consent, and globally phone-scoped
  // sms_consent_records are not agent-specific buyer-continuity consent.
  if (!evidence(consent, now) || consent.buyer_id !== buyer.id || consent.agent_slug !== owner
      || consent.phone_e164 !== buyer.phone_e164 || consent.purpose !== PURPOSE || consent.channel !== 'sms'
      || consent.status !== 'opted_in' || !nonempty(consent.text_version) || !nonempty(consent.source)
      || !Number.isFinite(timestamp(consent.captured_at)) || timestamp(consent.captured_at) > now
      || timestamp(consent.captured_at) > timestamp(consent.checked_at)
      || consent.revoked_at !== null
      || (consent.expires_at !== null && (!Number.isFinite(timestamp(consent.expires_at))
        || timestamp(consent.expires_at) <= now))) add('scoped_consent_missing_or_invalid');

  if (!evidence(representation, now) || representation.buyer_id !== buyer.id
      || representation.status !== 'unrepresented') add('representation_not_cleared');
  if (!evidence(membership, now) || membership.agent_slug !== owner || membership.status !== 'active'
      || membership.assisted_followup !== true) add('assisted_followup_entitlement_missing');
  if (!evidence(suppression, now) || suppression.phone_e164 !== buyer.phone_e164
      || suppression.buyer_id !== buyer.id || suppression.lookup_succeeded !== true
      || suppression.status !== 'clear') add('suppression_not_cleared');
  if (!evidence(controls, now) || controls.agent_slug !== owner || controls.global_paused !== false
      || controls.agent_paused !== false || controls.mode !== 'review_only'
      || controls.review_enabled !== true) add('agent_or_global_controls_blocked');

  const key = reviewKey(buyer.id, owner);
  if (!evidence(continuity, now) || continuity.buyer_id !== buyer.id || continuity.phone_e164 !== buyer.phone_e164
      || continuity.review_key !== key || continuity.phone_identity_conflict !== false
      || continuity.active_other_agent_relationship !== false || continuity.existing_enrollment !== false
      || continuity.previous_contact !== false) add('duplicate_or_relationship_not_cleared');

  return Object.freeze({
    policy_version: POLICY_VERSION,
    status: reasons.length ? 'blocked' : 'ready_for_agent_review',
    reasons: Object.freeze(reasons),
    review_key: key,
    source_checkin_id: matches(UUID, source.id) ? source.id : null,
    source_event_id: matches(UUID, source.open_house_event_id) ? source.open_house_event_id : null,
    owner_agent_slug: matches(SLUG, owner) ? owner : null,
    evaluated_at: Number.isFinite(now) ? nowIso : null,
    // Deliberately invariant even when every review prerequisite passes.
    outbound_allowed: false,
    representation_established: false
  });
}

module.exports = { PURPOSE, POLICY_VERSION, MAX_SNAPSHOT_AGE_MS, reviewKey, assessBuyerContinuity };
