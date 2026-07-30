const {
  normalizeEmail,
  normalizeName,
  normalizePhone,
  tokenSimilarity
} = require('./agent-ranking');

const HISTORY_VISIT_STATUSES = new Set(['confirmed', 'live', 'completed']);

function cleanText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function normalizeSlug(value) {
  return cleanText(value).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

function slugBase(value) {
  return normalizeSlug(value).replace(/-[a-z0-9]{3}$/, '');
}

function dateValue(...values) {
  for (const value of values) {
    if (!value) continue;
    const date = new Date(value);
    if (Number.isFinite(date.getTime())) return date;
  }
  return null;
}

function compatibleNameBrokerage(ranking = {}, record = {}) {
  const rankingName = normalizeName(ranking.agent_name || ranking.name);
  const recordName = normalizeName(record.agent_name || record.name);
  if (!rankingName || !recordName || rankingName !== recordName) return false;
  const rankingBrokerage = normalizeName(ranking.brokerage);
  const recordBrokerage = normalizeName(record.brokerage);
  return !rankingBrokerage
    || !recordBrokerage
    || tokenSimilarity(rankingBrokerage, recordBrokerage) >= 0.35;
}

function recordMatchesRanking(ranking = {}, record = {}) {
  const phone = normalizePhone(ranking.phone_normalized || ranking.phone);
  const recordPhone = normalizePhone(record.agent_phone || record.phone_normalized || record.phone);
  if (phone && recordPhone && phone === recordPhone) return true;
  const email = normalizeEmail(ranking.email);
  const recordEmail = normalizeEmail(record.agent_email || record.email);
  if (email && recordEmail && email === recordEmail) return true;
  return compatibleNameBrokerage(ranking, record);
}

function matchingAgentSlugs(ranking = {}, agents = []) {
  const slugs = new Set();
  for (const agent of agents || []) {
    const idMatch = ranking.agent_id && agent.id && String(ranking.agent_id) === String(agent.id);
    if (!idMatch && !recordMatchesRanking(ranking, agent)) continue;
    if (agent.slug) {
      slugs.add(normalizeSlug(agent.slug));
      slugs.add(slugBase(agent.slug));
    }
  }
  const nameSlug = slugBase(ranking.agent_name);
  if (nameSlug) slugs.add(nameSlug);
  return slugs;
}

function eventMatchesRanking(ranking = {}, event = {}, agentSlugs = new Set()) {
  if (ranking.agent_id && event.host_agent_id && String(ranking.agent_id) === String(event.host_agent_id)) {
    return true;
  }
  const slug = normalizeSlug(event.host_agent_slug);
  const base = slugBase(slug);
  return Boolean(slug && (agentSlugs.has(slug) || agentSlugs.has(base)));
}

function isPastVisit(visit = {}, now = new Date()) {
  if (!HISTORY_VISIT_STATUSES.has(cleanText(visit.status).toLowerCase())) return false;
  const date = dateValue(visit.completed_at, visit.scheduled_end, visit.scheduled_start);
  return Boolean(date && date <= now);
}

function historyRowsForRanking(ranking = {}, data = {}, now = new Date()) {
  const agentSlugs = matchingAgentSlugs(ranking, data.agents || []);
  const byOpenHouse = new Map();
  const remember = (row, priority) => {
    const key = cleanText(row.open_house_id || row.id);
    if (!key) return;
    const current = byOpenHouse.get(key);
    if (!current || priority > current.priority) byOpenHouse.set(key, { row, priority });
  };

  for (const visit of data.visits || []) {
    if (!isPastVisit(visit, now)) continue;
    const slug = normalizeSlug(visit.agent_slug);
    const slugMatch = slug && (agentSlugs.has(slug) || agentSlugs.has(slugBase(slug)));
    if (!slugMatch && !recordMatchesRanking(ranking, visit)) continue;
    remember({
      id: visit.id,
      open_house_id: visit.open_house_id || '',
      open_house_event_id: visit.open_house_event_id || '',
      start: visit.scheduled_start || null,
      end: visit.scheduled_end || null,
      ended_at: visit.completed_at || visit.scheduled_end || null,
      history_status: cleanText(visit.status).toLowerCase() || 'confirmed',
      history_source: 'field_demo_visit'
    }, visit.status === 'live' || visit.completed_at ? 2 : 1);
  }

  for (const event of data.events || []) {
    const ended = cleanText(event.status).toLowerCase() === 'ended' || Boolean(event.ended_at);
    if (!ended || !eventMatchesRanking(ranking, event, agentSlugs)) continue;
    const start = dateValue(event.start_time) ? event.start_time : event.event_date || null;
    const end = dateValue(event.end_time) ? event.end_time : event.ended_at || null;
    remember({
      id: event.id,
      open_house_id: event.open_house_source_id || '',
      open_house_event_id: event.id,
      start,
      end,
      ended_at: event.ended_at || end,
      history_status: 'completed',
      history_source: 'open_house_event'
    }, 3);
  }

  return [...byOpenHouse.values()]
    .map((item) => item.row)
    .sort((left, right) => {
      const leftDate = dateValue(left.start, left.ended_at)?.getTime() || 0;
      const rightDate = dateValue(right.start, right.ended_at)?.getTime() || 0;
      return rightDate - leftDate;
    });
}

function historySignalForRanking(ranking = {}, data = {}, now = new Date()) {
  const rows = historyRowsForRanking(ranking, data, now);
  return {
    has_prior_rel8tion_open_house: rows.length > 0,
    rel8tion_open_house_history_count: rows.length,
    last_rel8tion_open_house_at: rows[0]?.start || rows[0]?.ended_at || null
  };
}

function annotateRankingsWithHistory(rankings = [], data = {}, now = new Date()) {
  return (rankings || []).map((ranking) => ({
    ...ranking,
    ...historySignalForRanking(ranking, data, now)
  }));
}

module.exports = {
  HISTORY_VISIT_STATUSES,
  annotateRankingsWithHistory,
  historyRowsForRanking,
  historySignalForRanking,
  matchingAgentSlugs,
  normalizeSlug,
  recordMatchesRanking,
  slugBase
};
