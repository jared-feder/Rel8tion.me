'use strict';

// Pure, offline planning only. This module has no provider, database or network dependency.
// Every returned row is non-sendable, including rows ready for an operator to review.
const DAY = 24 * 60 * 60 * 1000;
const CAMPAIGN = 'agent-relationship-v1';
const STEPS = Object.freeze([
  Object.freeze({ key: 'pass-checkin', day: 0, channel: 'sms', purpose: 'event_pass_support' }),
  Object.freeze({ key: 'news-and-stats', day: 7, channel: 'email', purpose: 'rel8tion_updates' }),
  Object.freeze({ key: 'business-checkin', day: 21, channel: 'sms', purpose: 'business_checkin' }),
  Object.freeze({ key: 'pass-playbook', day: 35, channel: 'email', purpose: 'event_pass_support' })
]);
const SOURCES = ['relationships', 'enrollments', 'consents', 'suppressions', 'touches', 'sender_controls'];
const ACCEPTED = new Set(['accepted', 'queued', 'sent', 'delivered']);

function clean(value) { return typeof value === 'string' ? value.trim() : ''; }
function time(value) {
  return typeof value === 'string' && value.trim() ? Date.parse(value) : NaN;
}
function recipient(channel, value) {
  if (channel === 'email') {
    const email = clean(value).toLowerCase();
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : '';
  }
  const digits = clean(value).replace(/\D/g, '');
  if (/^1\d{10}$/.test(digits)) return '+' + digits;
  return /^\d{10}$/.test(digits) ? '+1' + digits : '';
}
function channelRecipient(row, channel) {
  return recipient(channel, channel === 'sms' ? row.phone_normalized || row.phone : row.email);
}
function inQuietHours(now, zone) {
  const hour = Number(new Intl.DateTimeFormat('en-US', {
    timeZone: zone, hour: 'numeric', hourCycle: 'h23'
  }).format(new Date(now)));
  return hour < 8 || hour >= 21;
}
function sourceReasons(snapshot, now) {
  return SOURCES.flatMap((source) => {
    const proof = snapshot?.[source];
    const checkedAt = time(proof?.checked_at);
    return proof?.complete === true && Number.isFinite(checkedAt)
      && checkedAt <= now && now - checkedAt <= 5 * 60 * 1000
      ? [] : ['unverified_' + source];
  });
}
function consentReasons(consents, row, step, address, now) {
  const matching = consents.filter((item) => item.relationship_id === row.id
    && item.channel === step.channel && item.purpose === step.purpose
    && recipient(step.channel, item.recipient) === address);
  if (!matching.length) return ['missing_channel_purpose_consent'];
  if (matching.some((item) => !Number.isFinite(time(item.occurred_at)) || time(item.occurred_at) > now)) {
    return ['invalid_consent_history'];
  }
  const latestAt = Math.max(...matching.map((item) => time(item.occurred_at)));
  const latest = matching.filter((item) => time(item.occurred_at) === latestAt);
  // A revocation or ambiguous record at the same instant wins over an opt-in.
  if (latest.some((item) => item.status !== 'granted')) return ['consent_not_granted'];
  if (latest.some((item) => item.explicit !== true || !clean(item.id)
    || !clean(item.evidence_ref) || !clean(item.disclosure_version))) return ['consent_evidence_missing'];
  if (latest.some((item) => item.expires_at != null
    && (!Number.isFinite(time(item.expires_at)) || time(item.expires_at) <= now))) return ['consent_expired'];
  return [];
}

function previewAgentNurture(input = {}) {
  const now = time(input.now);
  if (!Number.isFinite(now)) throw new TypeError('An explicit valid now timestamp is required.');
  const relationships = Array.isArray(input.relationships) ? input.relationships : [];
  const enrollments = Array.isArray(input.enrollments) ? input.enrollments : [];
  const consents = Array.isArray(input.consents) ? input.consents : [];
  const suppressions = Array.isArray(input.suppressions) ? input.suppressions : [];
  const touches = Array.isArray(input.touches) ? input.touches : [];
  const globalReasons = sourceReasons(input.snapshot, now);
  for (const key of ['relationships', 'enrollments', 'consents', 'suppressions', 'touches']) {
    if (!Array.isArray(input[key])) globalReasons.push('missing_' + key);
  }
  const identities = new Map();
  const canonicalKeys = new Map();
  const endpoints = { sms: new Map(), email: new Map() };
  for (const row of relationships) {
    identities.set(row.id, (identities.get(row.id) || 0) + 1);
    canonicalKeys.set(row.canonical_key, (canonicalKeys.get(row.canonical_key) || 0) + 1);
    for (const channel of ['sms', 'email']) {
      const address = channelRecipient(row, channel);
      if (!address) continue;
      const owners = endpoints[channel].get(address) || new Set();
      owners.add(row.id);
      endpoints[channel].set(address, owners);
    }
  }
  const results = relationships.map((row) => {
    const reasons = [...globalReasons];
    const result = {
      relationship_id: row.id || null,
      campaign: CAMPAIGN,
      mode: 'preview_only',
      send_allowed: false,
      state: 'blocked',
      reasons,
      step: null,
      next_review_at: null,
      idempotency_key: null
    };
    if (!clean(row.id) || !clean(row.canonical_key)) reasons.push('missing_canonical_identity');
    if (!clean(row.name || row.display_name) || row.identity_verified !== true || !clean(row.identity_evidence_ref)) {
      reasons.push('person_identity_unverified');
    }
    const storedPhone = recipient('sms', row.phone);
    const normalizedPhone = recipient('sms', row.phone_normalized);
    if (storedPhone && normalizedPhone && storedPhone !== normalizedPhone) reasons.push('conflicting_recipient_fields');
    if (identities.get(row.id) > 1 || canonicalKeys.get(row.canonical_key) > 1) reasons.push('ambiguous_identity');
    if (row.worked_with_agent !== true) reasons.push('no_worked_with_evidence');
    if (['opted_out', 'do_not_contact', 'blocked'].includes(row.relationship_status)) reasons.push('relationship_suppressed');
    if (row.follow_up_marked === true || row.open_conversation === true) reasons.push('human_follow_up_pending');
    if (row.open_conversation !== false) reasons.push('conversation_state_unverified');
    const matches = enrollments.filter((item) => item.relationship_id === row.id && item.campaign === CAMPAIGN);
    if (matches.length !== 1) {
      reasons.push(matches.length ? 'ambiguous_enrollment' : 'not_enrolled_for_preview');
      return result;
    }
    const enrollment = matches[0];
    const enrolledAt = time(enrollment.enrolled_at);
    if (!clean(enrollment.id) || !Number.isFinite(enrolledAt) || enrolledAt > now) reasons.push('invalid_enrollment');
    if (enrollment.status !== 'preview') reasons.push('preview_enrollment_paused');
    const history = touches.filter((item) => item.relationship_id === row.id);
    if (history.some((item) => !clean(item.id) || !['inbound', 'outbound'].includes(item.direction)
      || !['sms', 'email'].includes(item.channel)
      || !Number.isFinite(time(item.occurred_at)) || time(item.occurred_at) > now)) {
      reasons.push('invalid_contact_history');
    }
    if (history.some((item) => item.direction === 'outbound' && !ACCEPTED.has(item.status)
      && !['failed', 'blocked', 'cancelled'].includes(item.status))) reasons.push('unresolved_outbound_attempt');
    const outcomes = new Map();
    for (const item of history) {
      const outcome = JSON.stringify([item.direction, item.channel, item.status, item.enrollment_id, item.step_key]);
      if (outcomes.has(item.id) && outcomes.get(item.id) !== outcome) reasons.push('conflicting_contact_outcomes');
      outcomes.set(item.id, outcome);
    }
    const campaignHistory = history.filter((item) => item.enrollment_id === enrollment.id && item.campaign === CAMPAIGN);
    const step = STEPS.find((item) => !campaignHistory.some((touch) => touch.step_key === item.key
      && touch.direction === 'outbound' && ACCEPTED.has(touch.status)));
    if (!step) {
      result.state = reasons.length ? 'blocked' : 'completed';
      return result;
    }
    result.step = { ...step };
    result.idempotency_key = [CAMPAIGN, enrollment.id, step.key].map(encodeURIComponent).join(':');
    // An uncertain or failed attempt is an operator reconciliation task, never an automatic retry.
    if (campaignHistory.some((touch) => touch.step_key === step.key && touch.direction === 'outbound')) {
      reasons.push('prior_attempt_requires_reconciliation');
    }
    const address = channelRecipient(row, step.channel);
    if (!address) reasons.push('missing_valid_recipient');
    if (address && endpoints[step.channel].get(address)?.size > 1) reasons.push('shared_recipient_requires_review');
    if (address) reasons.push(...consentReasons(consents, row, step, address, now));
    if (suppressions.some((item) => item.active !== false
      && (!['sms', 'email', 'all'].includes(item.channel)
        || (!clean(item.relationship_id) && !clean(item.recipient))))) reasons.push('invalid_suppression_history');
    if (suppressions.some((item) => item.active !== false
      && (item.channel === step.channel || item.channel === 'all')
      && (item.relationship_id === row.id || (address && recipient(step.channel, item.recipient) === address)))) {
      reasons.push('recipient_suppressed');
    }
    const controls = input.sender_controls?.[step.channel];
    if (controls?.paused !== false) reasons.push('sender_paused_or_unknown');
    if (controls?.health_ok !== true) reasons.push('sender_health_not_verified');
    if (controls?.capacity_available !== true) reasons.push('sender_capacity_not_verified');
    if (step.channel === 'sms' && controls?.operator_mode !== 'away') reasons.push('manual_operator_mode');
    let reviewAt = enrolledAt + step.day * DAY;
    // Count all outreach to the relationship, not only this campaign. This also prevents email/SMS pileups.
    const outbound = history.filter((item) => item.direction === 'outbound' && ACCEPTED.has(item.status));
    for (const touch of outbound) reviewAt = Math.max(reviewAt, time(touch.occurred_at) + 7 * DAY);
    const recentChannelTouches = outbound.filter((item) => item.channel === step.channel
      && time(item.occurred_at) > now - 30 * DAY).sort((a, b) => time(a.occurred_at) - time(b.occurred_at));
    if (recentChannelTouches.length >= 2) {
      reviewAt = Math.max(reviewAt, time(recentChannelTouches[recentChannelTouches.length - 2].occurred_at) + 30 * DAY);
    }
    if (Number.isFinite(reviewAt)) result.next_review_at = new Date(reviewAt).toISOString();
    if (step.channel === 'sms') {
      if (inQuietHours(now, 'America/New_York')) reasons.push('quiet_hours_new_york');
      if (row.timezone) {
        try { if (inQuietHours(now, row.timezone)) reasons.push('quiet_hours_recipient'); }
        catch (_) { reasons.push('invalid_recipient_timezone'); }
      }
    }
    result.state = reasons.length ? 'blocked' : reviewAt > now ? 'waiting' : 'review_ready';
    return result;
  });
  return { campaign: CAMPAIGN, mode: 'preview_only', send_allowed: false, generated_at: input.now, results };
}

module.exports = { CAMPAIGN, STEPS, previewAgentNurture };
