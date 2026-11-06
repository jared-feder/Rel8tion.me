const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'apps/rel8tion-app/agent-dashboard.html'), 'utf8');

test('ordinary agents request loan-officer coverage through contextual support', () => {
  assert.match(source, /function loanOfficerManagementHref\(\)/);
  assert.match(source, /function loanOfficerManagementHref\(\) \{\s*return liveSupportHref\(\);/);
  assert.match(source, /No loan-officer Rel8tionChip scan is required/);
  assert.match(source, />Request Loan Officer Coverage<\/a>/);
  assert.equal((source.match(/href="\$\{esc\(loanOfficerManagementHref\(\)\)\}"/g) || []).length, 2);
});

test('legacy loan-officer keychain sign-in cannot return', () => {
  assert.doesNotMatch(source, /armLoanOfficerSignIn/);
  assert.doesNotMatch(source, /rel8tion_loan_officer_pending/);
  assert.doesNotMatch(source, /Tap Loan Officer Keychain/);
  assert.doesNotMatch(source, /Have the NMB loan officer tap their verified keychain/);
});
