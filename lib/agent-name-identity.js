const { usableAgentName } = require('./agent-identity');

const AGENT_NAME_SUFFIXES = new Set([
  'abr', 'ahwd', 'c2ex', 'cbr', 'crs', 'epro', 'gri', 'ii', 'iii', 'jr',
  'mba', 'mrp', 'psa', 'rsps', 'sfr', 'sr', 'sres', 'srs', 'wcr'
]);

function agentNameAnchor(value) {
  const tokens = String(value || '')
    .toLowerCase()
    .replace(/\be[\s-]*pro\b/g, ' epro ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter((token) => token.length > 1 && !AGENT_NAME_SUFFIXES.has(token));
  return tokens.length ? `${tokens[0]}|${tokens[tokens.length - 1]}` : '';
}

function compatibleAgentNames(left, right) {
  const leftAnchor = agentNameAnchor(usableAgentName(left));
  const rightAnchor = agentNameAnchor(usableAgentName(right));
  return !leftAnchor || !rightAnchor || leftAnchor === rightAnchor;
}

module.exports = {
  agentNameAnchor,
  compatibleAgentNames
};
