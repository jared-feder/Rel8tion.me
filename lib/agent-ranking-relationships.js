const {
  normalizeEmail,
  normalizeName,
  normalizePhone,
  tokenSimilarity
} = require('./agent-ranking');
const {
  historySignalForRanking,
  recordMatchesRanking
} = require('./agent-ranking-history');

const POSITIVE_RELATIONSHIP_STATUSES = new Set([
  'worked_with',
  'interested',
  'confirmed_open_house',
  'accepted_open_house',
  'drip_scheduled'
]);

function cleanText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function relationshipPriority(status) {
  return {
    accepted_open_house: 5,
    confirmed_open_house: 4,
    interested: 3,
    drip_scheduled: 2,
    worked_with: 1
  }[cleanText(status)] || 0;
}

function compatibleNameBrokerage(left = {}, right = {}) {
  const leftName = normalizeName(left.agent_name || left.name);
  const rightName = normalizeName(right.agent_name || right.name);
  if (!leftName || leftName !== rightName) return false;
  const leftBrokerage = normalizeName(left.brokerage);
  const rightBrokerage = normalizeName(right.brokerage);
  return !leftBrokerage
    || !rightBrokerage
    || tokenSimilarity(leftBrokerage, rightBrokerage) >= 0.35;
}

function recordsMatch(left = {}, right = {}) {
  const leftAgentId = cleanText(left.agent_id || left.id);
  const rightAgentId = cleanText(right.agent_id || right.id);
  if (leftAgentId && rightAgentId && leftAgentId === rightAgentId) return true;
  const leftPhone = normalizePhone(left.phone_normalized || left.agent_phone_normalized || left.phone || left.agent_phone);
  const rightPhone = normalizePhone(right.phone_normalized || right.agent_phone_normalized || right.phone || right.agent_phone);
  if (leftPhone && rightPhone && leftPhone === rightPhone) return true;
  const leftEmail = normalizeEmail(left.email || left.agent_email);
  const rightEmail = normalizeEmail(right.email || right.agent_email);
  if (leftEmail && rightEmail && leftEmail === rightEmail) return true;
  return compatibleNameBrokerage(left, right);
}

function matchingAgent(record = {}, agents = []) {
  return (agents || []).find((agent) => recordMatchesRanking({
    agent_id: record.agent_id || null,
    agent_name: record.agent_name || record.name || '',
    brokerage: record.brokerage || '',
    phone: record.phone || record.agent_phone || '',
    phone_normalized: record.phone_normalized || record.agent_phone_normalized || '',
    email: record.email || record.agent_email || ''
  }, agent)) || null;
}

function relationshipKey(record = {}, agent = null) {
  const agentId = cleanText(record.agent_id || agent?.id);
  if (agentId) return `agent:${agentId}`;
  const phone = normalizePhone(
    record.phone_normalized
    || record.agent_phone_normalized
    || record.phone
    || record.agent_phone
    || agent?.phone_normalized
    || agent?.phone
  );
  if (phone) return `phone:${phone}`;
  const email = normalizeEmail(record.email || record.agent_email || agent?.email);
  if (email) return `email:${email}`;
  const name = normalizeName(record.agent_name || record.name || agent?.name);
  const brokerage = normalizeName(record.brokerage || agent?.brokerage);
  return name ? `name:${name}|${brokerage}` : '';
}

function stableRelationshipId(key) {
  return key ? `relationship:${Buffer.from(key).toString('base64url')}` : '';
}

function candidateFromRecord(record = {}, defaults = {}, agents = []) {
  const agent = matchingAgent(record, agents);
  const agentName = cleanText(record.agent_name || record.name || agent?.name);
  const key = relationshipKey(record, agent);
  if (!agentName || !key) return null;
  return {
    key,
    agent_id: cleanText(record.agent_id || agent?.id) || null,
    agent_name: agentName,
    brokerage: cleanText(record.brokerage || agent?.brokerage),
    phone: cleanText(record.phone || record.agent_phone || agent?.phone || agent?.phone_normalized),
    phone_normalized: normalizePhone(
      record.phone_normalized
      || record.agent_phone_normalized
      || record.phone
      || record.agent_phone
      || agent?.phone_normalized
      || agent?.phone
    ),
    email: normalizeEmail(record.email || record.agent_email || agent?.email),
    city: cleanText(record.city),
    state: cleanText(record.state),
    zip: cleanText(record.zip),
    relationship_status: cleanText(defaults.relationship_status || record.relationship_status || record.review_status || 'worked_with'),
    relationship_source: cleanText(defaults.relationship_source || record.relationship_source || record.source || ''),
    open_start: record.open_start || null,
    open_end: record.open_end || null,
    updated_at: record.updated_at || record.last_seen_at || record.created_at || null
  };
}

function mergeCandidate(current, candidate) {
  if (!current) {
    return {
      ...candidate,
      relationship_sources: [candidate.relationship_source].filter(Boolean),
      upcoming_open_house_count: candidate.open_start ? 1 : 0
    };
  }
  const preferred = relationshipPriority(candidate.relationship_status) > relationshipPriority(current.relationship_status)
    ? candidate
    : current;
  const alternate = preferred === current ? candidate : current;
  return {
    ...alternate,
    ...preferred,
    agent_id: preferred.agent_id || alternate.agent_id || null,
    agent_name: preferred.agent_name || alternate.agent_name,
    brokerage: preferred.brokerage || alternate.brokerage,
    phone: preferred.phone || alternate.phone,
    phone_normalized: preferred.phone_normalized || alternate.phone_normalized,
    email: preferred.email || alternate.email,
    city: preferred.city || alternate.city,
    state: preferred.state || alternate.state,
    zip: preferred.zip || alternate.zip,
    open_start: preferred.open_start || alternate.open_start,
    open_end: preferred.open_end || alternate.open_end,
    updated_at: [preferred.updated_at, alternate.updated_at]
      .filter(Boolean)
      .sort((left, right) => new Date(right) - new Date(left))[0] || null,
    relationship_sources: [...new Set([
      ...(current.relationship_sources || []),
      candidate.relationship_source
    ].filter(Boolean))],
    upcoming_open_house_count: Number(current.upcoming_open_house_count || 0) + (candidate.open_start ? 1 : 0)
  };
}

function existingRankingMatches(candidate, rankings = []) {
  return (rankings || []).some((ranking) => recordsMatch(candidate, ranking));
}

function relationshipScore(candidate = {}, hasHistory = false) {
  if (candidate.upcoming_open_house_count > 0 && hasHistory) return 100;
  if (candidate.relationship_status === 'accepted_open_house') return 98;
  if (candidate.relationship_status === 'confirmed_open_house') return 95;
  if (hasHistory) return 92;
  if (candidate.relationship_status === 'interested') return 88;
  return 82;
}

function relationshipRanking(candidate = {}, historyData = {}, now = new Date()) {
  const base = {
    id: stableRelationshipId(candidate.key),
    identity_key: `relationship:${candidate.key}`,
    agent_id: candidate.agent_id,
    agent_name: candidate.agent_name,
    first_name: candidate.agent_name.split(/\s+/)[0] || '',
    brokerage: candidate.brokerage,
    phone: candidate.phone || candidate.phone_normalized,
    phone_normalized: candidate.phone_normalized,
    email: candidate.email,
    city: candidate.city,
    state: candidate.state,
    zip: candidate.zip,
    market_area: '',
    primary_county: '',
    county: '',
    production_volume: 0,
    transaction_count: 0,
    active_listing_count: 0,
    sold_listing_count: 0,
    listings_days_since_last: 0,
    listings_active_last_12_months: 0,
    buyside_last_90_days: 0,
    buyside_last_12_months: 0,
    average_price: 0,
    open_house_count: 0,
    matched_open_house_count: 0,
    matched_weekend_open_house_count: 0,
    matched_active_listing_count: 0,
    matched_open_house_ids: [],
    has_open_house_this_weekend: false,
    has_phone: Boolean(candidate.phone_normalized),
    has_email: Boolean(candidate.email),
    relationship_only: true,
    relationship_status: candidate.relationship_status,
    relationship_source: candidate.relationship_source,
    last_activity_at: candidate.updated_at,
    created_at: candidate.updated_at,
    updated_at: candidate.updated_at,
    recommended_tier: 'Relationship',
    opportunity_gap_score: 0,
    rel8tion_lead_capture_score: 0,
    raw_sources: {
      relationship_only: true,
      relationship_status: candidate.relationship_status,
      relationship_sources: candidate.relationship_sources || [],
      labels: ['REL8TION Relationship', candidate.relationship_status.replace(/_/g, ' ')],
      display_metric_note: 'No ListReports production metrics are attached to this relationship-only agent.'
    }
  };
  const history = historySignalForRanking(base, historyData, now);
  const score = relationshipScore(candidate, history.has_prior_rel8tion_open_house);
  return {
    ...base,
    ...history,
    agent_rank_score: score,
    recommended_pitch: history.has_prior_rel8tion_open_house
      ? `${candidate.agent_name} has prior REL8TION open-house history. Use the next real open house to offer Event Pass support again.`
      : `${candidate.agent_name} has a positive REL8TION relationship. Use the next real open house to offer Event Pass support.`,
    next_best_action: candidate.upcoming_open_house_count > 0
      ? 'Review the upcoming database open house and draft a manual "have me there" reminder.'
      : 'Watch for the next open house and offer REL8TION support.',
    gap_summary: 'Relationship record; ListReports production metrics are not available for this agent.'
  };
}

function buildRelationshipOnlyRankings(options = {}) {
  const existingRankings = options.existingRankings || [];
  const historyData = options.historyData || {};
  const agents = historyData.agents || [];
  const grouped = new Map();
  const add = (record, defaults = {}) => {
    const candidate = candidateFromRecord(record, defaults, agents);
    if (!candidate || !POSITIVE_RELATIONSHIP_STATUSES.has(candidate.relationship_status)) return;
    grouped.set(candidate.key, mergeCandidate(grouped.get(candidate.key), candidate));
  };

  for (const agent of agents) {
    const signal = historySignalForRanking({
      agent_id: agent.id,
      agent_name: agent.name,
      brokerage: agent.brokerage,
      phone: agent.phone,
      phone_normalized: agent.phone_normalized,
      email: agent.email
    }, historyData, options.now || new Date());
    if (signal.has_prior_rel8tion_open_house) {
      add(agent, { relationship_status: 'worked_with', relationship_source: 'rel8tion_open_house_history' });
    }
  }
  for (const visit of historyData.visits || []) {
    const signal = historySignalForRanking({
      agent_name: visit.agent_name,
      brokerage: visit.brokerage,
      phone: visit.agent_phone,
      email: visit.agent_email
    }, historyData, options.now || new Date());
    if (signal.has_prior_rel8tion_open_house) {
      add(visit, { relationship_status: 'worked_with', relationship_source: 'field_demo_visits' });
    }
  }
  for (const row of options.queueRows || []) {
    add(row, {
      relationship_status: row.review_status || 'interested',
      relationship_source: row.source || 'agent_outreach_queue'
    });
  }
  for (const row of options.inventory || []) {
    add(row, {
      relationship_status: row.relationship_status,
      relationship_source: row.relationship_source || row.source || 'agent_listing_inventory'
    });
  }

  return [...grouped.values()]
    .filter((candidate) => !existingRankingMatches(candidate, existingRankings))
    .map((candidate) => relationshipRanking(candidate, historyData, options.now || new Date()));
}

module.exports = {
  POSITIVE_RELATIONSHIP_STATUSES,
  buildRelationshipOnlyRankings,
  candidateFromRecord,
  existingRankingMatches,
  relationshipKey,
  relationshipPriority,
  relationshipRanking,
  recordsMatch,
  stableRelationshipId
};
