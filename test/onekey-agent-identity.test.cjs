const test = require('node:test');
const assert = require('node:assert/strict');
const { buildOpenHousePatch } = require('../onekey-freshness-worker.cjs');

test('OneKey refresh fills a missing agent name without erasing an existing identity', () => {
  const now = '2026-08-12T14:30:00.000Z';
  const repaired = buildOpenHousePatch(
    { id: 'listing-1', agent: null, price: 700000 },
    { agent: 'Ruth Chalco', price: 700000 },
    now
  );
  const preserved = buildOpenHousePatch(
    { id: 'listing-2', agent: 'Existing Agent', price: 800000 },
    { agent: null, price: 800000 },
    now
  );

  assert.equal(repaired.agent, 'Ruth Chalco');
  assert.equal(preserved.agent, 'Existing Agent');
});
