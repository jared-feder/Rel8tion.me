const PLACEHOLDER_AGENT_NAMES = new Set([
  'agent',
  'listing agent',
  'listing agent unavailable',
  'unknown',
  'unknown agent',
  'n/a',
  'na'
]);

function cleanText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function normalizedPhone(value) {
  const digits = String(value || '').replace(/\D/g, '');
  return digits.length === 11 && digits.startsWith('1') ? digits.slice(1) : digits;
}

function normalizedEmail(value) {
  return cleanText(value).toLowerCase();
}

function usableAgentName(value) {
  const name = cleanText(value);
  return name && !PLACEHOLDER_AGENT_NAMES.has(name.toLowerCase()) ? name : '';
}

function normalizeAgentCandidate(row = {}) {
  return {
    ...row,
    id: row.id || row.agent_id || null,
    name: usableAgentName(row.agent_name) || usableAgentName(row.name) || usableAgentName(row.agent),
    phone: cleanText(row.agent_phone || row.phone),
    email: cleanText(row.agent_email || row.email),
    brokerage: cleanText(row.brokerage || row.company)
  };
}

function sameAgentContact(left = {}, right = {}) {
  const leftPhone = normalizedPhone(left.phone || left.agent_phone);
  const rightPhone = normalizedPhone(right.phone || right.agent_phone);
  const leftEmail = normalizedEmail(left.email || left.agent_email);
  const rightEmail = normalizedEmail(right.email || right.agent_email);
  return Boolean((leftPhone && rightPhone && leftPhone === rightPhone)
    || (leftEmail && rightEmail && leftEmail === rightEmail));
}

function resolveAgentIdentity(candidates = []) {
  const rows = candidates.map(normalizeAgentCandidate).filter((row) => (
    row.name || row.phone || row.email || row.brokerage || row.id
  ));
  const named = rows.find((row) => row.name) || null;
  const anchor = named || rows[0] || {};
  const related = rows.filter((row) => (
    row === anchor
    || sameAgentContact(row, anchor)
    || (!normalizedPhone(anchor.phone) && !normalizedEmail(anchor.email))
  ));
  const sources = related.length ? related : rows;
  const firstValue = (field) => sources.map((row) => row[field]).find(Boolean) || '';
  const listingRow = rows.find((row) => row.source === 'listing_agents');

  return {
    ...(listingRow || {}),
    id: listingRow?.id || null,
    name: firstValue('name'),
    phone: firstValue('phone'),
    email: firstValue('email'),
    brokerage: firstValue('brokerage')
  };
}

module.exports = {
  normalizedEmail,
  normalizedPhone,
  normalizeAgentCandidate,
  resolveAgentIdentity,
  sameAgentContact,
  usableAgentName
};
