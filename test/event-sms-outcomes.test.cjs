const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const helperPath = 'apps/rel8tion-app/src/api/notifications.js';
const helperNames = ['sendFinancingLeadAlert', 'sendAgentCheckinSMS', 'sendLiveLoanOfficerFinancingAlert', 'sendBuyerLoanOfficerIntroSMS', 'sendBuyerConfirmationSMS', 'sendJaredFinancingAlert'];
const args = { agentPhone: '+12025550101', buyerPhone: '+12025550102', buyerName: 'Test Buyer', loanOfficer: { loan_officer_phone: '+12025550103' }, address: 'Test address', propertyAddress: 'Test address', preapproved: 'no' };
const direct = { success: true, sms: { ok: true, status: 'queued' } };
const lead = { success: true, results: [{ ok: true, status: 'queued' }, { ok: true, status: 'queued' }] };
function loadHelpers(fetch, base = root) {
  const source = fs.readFileSync(path.join(base, helperPath), 'utf8').replace(/^import .*;\n/gm, '').replace(/export async function/g, 'async function');
  const context = vm.createContext({ fetch, KEY: 'test-key', SUPABASE_URL: 'https://example.invalid', debug() {}, jsonHeaders() { return {}; } });
  vm.runInContext(source + '\nthis.helpers = {' + helperNames.join(',') + '};', context);
  return context.helpers;
}
function response(payload, ok = true) { return { ok, text: async () => JSON.stringify(payload) }; }
for (const name of helperNames) {
  test(`${name}: accepts queued provider response without claiming delivery`, async () => {
    const helpers = loadHelpers(async () => response(name === 'sendFinancingLeadAlert' || name === 'sendJaredFinancingAlert' ? lead : direct));
    const result = await helpers[name](args);
    assert.equal(result.ok, true);
    assert.equal(result.status, 'accepted');
  });
  test(`${name}: terminal failure status overrides ok=true for direct and multi-send results`, async () => {
    for (const status of ['failed', 'blocked', 'undelivered', 'canceled', 'cancelled', 'rejected', ' UNDELIVERED ']) {
      for (const payload of [
        { success: true, sms: { ok: true, status } },
        { success: true, results: [{ ok: true, status: 'queued' }, { ok: true, status }] }
      ]) {
        const result = await loadHelpers(async () => response(payload))[name](args);
        assert.equal(result.ok, false);
        assert.equal(result.status, 'failed');
      }
    }
  });
  test(`${name}: HTTP, network, malformed and blocked responses are explicit failures`, async () => {
    for (const fetch of [
      async () => response({ error: 'provider failed' }, false),
      async () => { throw new Error('network unavailable'); },
      async () => ({ ok: true, text: async () => 'not JSON' }),
      async () => response({ success: true, sms: { ok: false, status: 'blocked' } }),
      async () => response({ success: true, results: [{ ok: true, status: 'queued' }, { ok: false, status: 'failed' }] }),
      async () => response({ success: true, results: [] })
    ]) {
      const result = await loadHelpers(fetch)[name](args);
      assert.equal(result.ok, false);
      assert.equal(result.status, 'failed');
    }
  });
}
for (const name of helperNames.filter((name) => name !== 'sendJaredFinancingAlert')) {
  test(`${name}: missing recipient skips without network`, async () => {
    const result = await loadHelpers(async () => { assert.fail('must not send'); })[name]({});
    assert.equal(result.ok, false);
    assert.equal(result.status, 'skipped');
  });
}

// Execute the real post-save dispatch block, not a copy of its decision logic.
async function checkin({ financing = true, live = true, outcomes = {} } = {}) {
  const source = fs.readFileSync(path.join(root, 'apps/rel8tion-app/src/modules/eventShell/bootstrap.js'), 'utf8');
  const start = source.indexOf('      const financingRequested = payload.metadata?.financing_requested === true;');
  const end = source.indexOf('      form.reset();', start) + '      form.reset();'.length;
  assert.ok(start > 0 && end > start);
  const calls = [];
  const context = vm.createContext({
    payload: { visitor_phone: args.buyerPhone, visitor_name: 'Test Buyer', metadata: { financing_requested: financing } },
    createdCheckin: { id: 'saved-checkin' },
    pageState: { agent: { phone: args.agentPhone }, house: {}, eventRow: { id: 'event' }, loanOfficer: live ? args.loanOfficer : null },
    getLiveLoanOfficerSession: async () => null,
    money: String,
    form: { reset() { calls.push('reset'); } }
  });
  for (const name of helperNames) context[name] = async () => { calls.push(name); return outcomes[name] || { ok: true, status: 'accepted' }; };
  await vm.runInContext('(async () => {' + source.slice(start, end) + '})()', context);
  return { state: context.pageState, calls };
}
test('failed financing alert preserves saved check-in, warns, resets and does not retry/fallback', async () => {
  const { state, calls } = await checkin({ outcomes: { sendLiveLoanOfficerFinancingAlert: { ok: false, status: 'failed' } } });
  assert.equal(state.financingAlertSent, false);
  assert.equal(state.lastCheckin.id, 'saved-checkin');
  assert.equal(state.mode, 'guest');
  assert.match(state.successMessage, /Check-in saved.*could not be confirmed/);
  assert.deepEqual(calls, ['sendBuyerConfirmationSMS', 'sendAgentCheckinSMS', 'sendLiveLoanOfficerFinancingAlert', 'sendBuyerLoanOfficerIntroSMS', 'reset']);
});
test('queued financing acceptance is recorded without promising contact or delivery', async () => {
  const { state } = await checkin();
  assert.equal(state.financingAlertSent, true);
  assert.match(state.successMessage, /submitted for text notification/);
  assert.doesNotMatch(state.successMessage, /will be in contact|delivered/);
});
test('non-financing check-in does not create financing alerts', async () => {
  const { state, calls } = await checkin({ financing: false });
  assert.equal(state.financingAlertSent, false);
  assert.deepEqual(calls, ['sendBuyerConfirmationSMS', 'sendAgentCheckinSMS', 'reset']);
});
test('owner fallback selection is unchanged, and failure is not marked sent', async () => {
  const { state, calls } = await checkin({ live: false, outcomes: { sendJaredFinancingAlert: { ok: false, status: 'failed' } } });
  assert.equal(state.financingAlertSent, false);
  assert.deepEqual(calls, ['sendBuyerConfirmationSMS', 'sendAgentCheckinSMS', 'sendJaredFinancingAlert', 'reset']);
});
test('other notification failures warn but do not erase financing acceptance', async () => {
  for (const name of ['sendBuyerConfirmationSMS', 'sendAgentCheckinSMS', 'sendBuyerLoanOfficerIntroSMS']) {
    const { state } = await checkin({ outcomes: { [name]: { ok: false, status: 'skipped' } } });
    assert.equal(state.financingAlertSent, true);
    assert.match(state.successMessage, /could not be confirmed/);
  }
});
test('missing result from stale helper fails closed', async () => {
  const { state } = await checkin({ outcomes: { sendLiveLoanOfficerFinancingAlert: {} } });
  assert.equal(state.financingAlertSent, false);
  assert.match(state.successMessage, /could not be confirmed/);
});
