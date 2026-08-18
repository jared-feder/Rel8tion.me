const test = require('node:test');
const assert = require('node:assert/strict');
const { namesMatch } = require('../onekey-headshot-worker.cjs');

test('headshot propagation rejects different agents who share an office phone', () => {
  assert.equal(namesMatch('Perry Pappas', 'David W. Holmes'), false);
  assert.equal(namesMatch('Perry Pappas', 'Jill Capozzi E-PRO PSA'), false);
});

test('headshot propagation accepts harmless middle initials and credentials', () => {
  assert.equal(namesMatch('Teresa A. DeDonato', 'Teresa DeDonato CBR'), true);
  assert.equal(namesMatch('Jill Capozzi', 'Jill Capozzi E-PRO PSA'), true);
});
