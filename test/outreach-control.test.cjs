const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

process.env.KEY_RESET_ADMIN_TOKEN = 'test-admin-token';
process.env.SUPABASE_URL = 'https://example.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role';

const settings = new Map([
  ['outreach_send_paused', {
    key: 'outreach_send_paused',
    value: { paused: false },
    updated_at: '2026-08-10T12:00:00.000Z',
    updated_by: 'test'
  }],
  ['outreach_guardrails', {
    key: 'outreach_guardrails',
    value: {
      max_per_run: 7,
      max_per_hour: 20,
      max_per_day: 150,
      duplicate_phone_cooldown_days: 30,
      missed_open_house_max_age_days: 7,
      health_window_days: 7,
      health_min_sends: 20,
      max_opt_out_rate: 0.05,
      send_horizon_days: 7
    },
    updated_at: '2026-08-10T12:00:00.000Z',
    updated_by: 'test'
  }],
  ['outreach_release_window', {
    key: 'outreach_release_window',
    value: { enabled: false },
    updated_at: '2026-08-10T12:00:00.000Z',
    updated_by: 'test'
  }]
]);
const writes = [];

function response(payload, options = {}) {
  return {
    ok: options.ok !== false,
    status: options.status || 200,
    headers: { get: (name) => name.toLowerCase() === 'content-range' ? (options.contentRange || '0-0/12') : null },
    text: async () => JSON.stringify(payload),
    json: async () => payload
  };
}

global.fetch = async (url, options = {}) => {
  const target = String(url);
  if (target.includes('/functions/v1/send-agent-outreach')) {
    return response({
      ok: true,
      dry_run: true,
      paused: false,
      max_per_run: 5,
      max_per_hour: 10,
      max_per_day: 25,
      duplicate_phone_cooldown_days: 45,
      missed_open_house_max_age_days: 5,
      health_window_days: 14,
      health_min_sends: 10,
      max_opt_out_rate: 0.005,
      send_horizon_days: 7,
      health_outreach_sends: 40,
      health_opt_outs: 0,
      health_opt_out_rate: 0,
      recent_outreach_sends_1h: 2,
      recent_outreach_sends_24h: 8,
      hourly_remaining: 8,
      daily_remaining: 17,
      outreach_release_window: { active: false }
    });
  }
  if (options.method === 'HEAD') return response(null, { contentRange: '0-0/12' });
  if (target.endsWith('/rest/v1/rel8tion_runtime_settings') && options.method === 'POST') {
    const body = JSON.parse(options.body || '{}');
    const row = { ...body, updated_at: '2026-08-10T12:05:00.000Z' };
    settings.set(body.key, row);
    writes.push(row);
    return response([row]);
  }
  if (target.includes('/rest/v1/rel8tion_runtime_settings?')) {
    const key = decodeURIComponent(target.match(/key=eq\.([^&]+)/)?.[1] || '');
    return response(settings.has(key) ? [settings.get(key)] : []);
  }
  return response([]);
};

const handler = require('../api/admin/outreach-control');
const { isLooseningGuardrails, normalizeGuardrails } = handler.__test;

function apiResponse() {
  return {
    statusCode: 200,
    payload: null,
    setHeader() {},
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.payload = payload;
      return this;
    }
  };
}

test('guardrails clamp to hard safety ceilings and detect less restrictive changes', () => {
  const current = normalizeGuardrails(settings.get('outreach_guardrails').value);
  const next = normalizeGuardrails({
    ...current,
    max_per_run: 99,
    max_per_hour: 99,
    max_per_day: 999,
    max_opt_out_rate: 0.06
  });
  assert.equal(next.max_per_run, 7);
  assert.equal(next.max_per_hour, 20);
  assert.equal(next.max_per_day, 150);
  assert.equal(isLooseningGuardrails(current, next), true);
});

test('admin API rejects a less restrictive guardrail update without typed confirmation', async () => {
  const res = apiResponse();
  await handler({
    method: 'POST',
    headers: { 'x-admin-token': 'test-admin-token' },
    body: {
      action: 'update_guardrails',
      guardrails: {
        ...settings.get('outreach_guardrails').value,
        max_opt_out_rate: 0.06
      },
      expected_updated_at: settings.get('outreach_guardrails').updated_at
    }
  }, res);
  assert.equal(res.statusCode, 400);
  assert.match(res.payload.error, /Type REL8TION/i);
});

test('admin API saves a tighter runtime configuration and returns live stats', async () => {
  writes.length = 0;
  const res = apiResponse();
  await handler({
    method: 'POST',
    headers: { 'x-admin-token': 'test-admin-token' },
    body: {
      action: 'update_guardrails',
      guardrails: {
        max_per_run: 5,
        max_per_hour: 10,
        max_per_day: 25,
        duplicate_phone_cooldown_days: 45,
        missed_open_house_max_age_days: 5,
        health_window_days: 14,
        health_min_sends: 10,
        max_opt_out_rate: 0.005,
        send_horizon_days: 5
      },
      expected_updated_at: settings.get('outreach_guardrails').updated_at
    }
  }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.payload.ok, true);
  assert.equal(res.payload.guardrails.value.max_per_day, 25);
  assert.equal(res.payload.guardrails.value.send_horizon_days, 5);
  assert.equal(res.payload.stats.queue_total, 12);
  assert.equal(writes.at(-1).key, 'outreach_guardrails');
});

test('COMMAND exposes the master switch, stats, editable limits, and locked protections', () => {
  const root = path.join(__dirname, '..');
  const admin = fs.readFileSync(path.join(root, 'apps/rel8tion-app/admin.html'), 'utf8');
  const sender = fs.readFileSync(path.join(root, 'supabase/functions/send-agent-outreach/index.ts'), 'utf8');
  const manualReply = fs.readFileSync(path.join(root, 'supabase/functions/send-agent-manual-reply/index.ts'), 'utf8');
  const sharedSms = fs.readFileSync(path.join(root, 'supabase/functions/_shared/sms.ts'), 'utf8');
  assert.match(admin, /\['outreachControl', 'Outreach Control'\]/);
  assert.match(admin, /id="outreachStopAll"/);
  assert.match(admin, /id="outreachStartAll"/);
  assert.match(admin, /Current opt-out rate/);
  assert.match(admin, /Open houses enriched/);
  assert.match(admin, /Upcoming send horizon days/);
  assert.match(admin, /soonest date\/time first/);
  assert.match(admin, /Locked recipient protections/);
  assert.match(sender, /loadOutreachGuardrails/);
  assert.match(sender, /\.eq\("key", "outreach_guardrails"\)/);
  assert.match(sender, /DEFAULT_MAX_OPT_OUT_RATE = 0\.05/);
  assert.match(sender, /DEFAULT_SEND_HORIZON_DAYS = 7/);
  assert.match(sender, /\.lt\("open_start", sendHorizonThrough\)/);
  assert.match(sender, /\.order\("open_start", \{ ascending: true/);
  assert.match(manualReply, /omit_repeated_stop_disclosure:\s*true/);
  assert.match(manualReply, /Cannot send manual reply to opted-out contact/);
  assert.match(sharedSms, /metadata\.omit_repeated_stop_disclosure !== true/);
  assert.match(sharedSms, /sms_suppressed: Recipient is on the global SMS suppression list/);
});
