const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const worker = require('../weekly-production-report-worker.cjs');

function loadModule(file, dependencies, extras = {}) {
  const context = { module: { exports: {} }, exports: {}, require: (name) => dependencies[name] || require(name),
    process: { env: {} }, console, Date, URL, AbortSignal, ...extras };
  vm.runInNewContext(fs.readFileSync(path.join(root, file), 'utf8'), context, { filename: file });
  return context.module.exports;
}

function fixture(overrides = {}) {
  const records = new Map();
  const calls = { build: 0, close: 0, email: 0 };
  const fake = {
    reportWindow: worker.reportWindow,
    emailConfiguration: () => ({ provider: null, recipientsConfigured: false }),
    async buildReport() { calls.build++; return { rows: [], totals: { events: 0, checkins: 0 } }; },
    async closeStaleEvents() { calls.close++; return { closed: 0, deferred: [] }; },
    async sendReport() { calls.email++; return { status: 'sent', id: 'email-id' }; },
    async rest(target, options = {}) {
      const url = new URL(target, 'https://test.invalid/');
      const body = options.body ? JSON.parse(options.body) : {};
      if (options.method === 'POST') {
        if (!records.has(body.week_start)) records.set(body.week_start, { ...body,
          generation_status: 'pending', closeout_status: 'pending', email_status: 'not_requested' });
        return [];
      }
      const key = url.searchParams.get('week_start')?.replace('eq.', '');
      const row = records.get(key);
      if (options.method === 'PATCH') {
        if (!row) return [];
        const token = url.searchParams.get('processing_token')?.replace('eq.', '');
        if (token && token !== row.processing_token) return [];
        if (url.searchParams.has('or') && row.processing_started_at && new Date(row.processing_started_at) > new Date(Date.now() - 15 * 60000)) return [];
        Object.assign(row, body);
        return [structuredClone(row)];
      }
      return key ? (row ? [structuredClone(row)] : []) : [...records.values()].map((value) => structuredClone(value));
    }, ...overrides
  };
  return { records, calls, archive: loadModule('lib/weekly-report-archive.js', { '../weekly-production-report-worker.cjs': fake }) };
}

const now = new Date('2026-10-12T13:05:00Z');
const window = worker.reportWindow(now);

test('Monday scheduler and week boundaries follow New York through DST', () => {
  assert.equal(worker.mondayNineAmNewYork(now), true);
  assert.equal(worker.mondayNineAmNewYork(new Date('2026-10-12T14:05:00Z')), false);
  assert.equal(worker.mondayNineAmNewYork(new Date('2026-11-02T14:05:00Z')), true);
  const spring = worker.reportWindow(new Date('2026-03-09T13:05:00Z'));
  assert.equal((spring.end - spring.start) / 3600000, 167);
  const fall = worker.reportWindow(new Date('2026-11-02T14:05:00Z'));
  assert.equal((fall.end - fall.start) / 3600000, 169);
});

test('manual generation archives once, preserves snapshot and never closes events or emails', async () => {
  const f = fixture();
  const first = await f.archive.processReport({ window });
  assert.equal(first.report.generation_status, 'ready');
  await f.archive.processReport({ window });
  assert.deepEqual(f.calls, { build: 1, close: 0, email: 0 });
});

test('scheduled run reuses manual snapshot and never duplicates accepted email', async () => {
  const f = fixture();
  await f.archive.processReport({ window });
  await f.archive.processReport({ window, scheduled: true, now });
  await f.archive.processReport({ window, scheduled: true, now });
  assert.deepEqual(f.calls, { build: 1, close: 1, email: 1 });
  assert.equal(f.records.get(window.key).email_status, 'sent');
});

test('explicit email action never closes events and cannot duplicate accepted delivery', async () => {
  const f = fixture();
  await f.archive.processReport({ window, emailOnly: true });
  await f.archive.processReport({ window, emailOnly: true });
  assert.deepEqual(f.calls, { build: 1, close: 0, email: 1 });
});

test('SMTP uses configured recipients and records provider acceptance', async () => {
  let sent;
  const mailer = loadModule('weekly-production-report-worker.cjs', { nodemailer: {
    createTransport: () => ({ sendMail: async (message) => { sent = message; return { accepted: ['reports@example.test'], rejected: [], messageId: 'smtp-id' }; }, close() {} })
  } }, { process: { env: new Proxy({ SMTP_HOST: 'smtp.example.test', SMTP_USER: 'sender@example.test', SMTP_PASSWORD: 'test-only', SMTP_PORT: '465',
    PRODUCTION_REPORT_EMAILS: 'reports@example.test' }, { get: (env, key) => env[key] || (String(key).startsWith('SUPABASE') ? 'https://test.invalid' : '') }) } });
  const result = await mailer.sendReport({ rows: [], totals: {} }, window, 0);
  assert.equal(result.status, 'sent');
  assert.equal(sent.to.join(','), 'reports@example.test');
  assert.match(sent.messageId, /weekly-production-2026-10-05/);
});

test('email rejection leaves a saved report and visible failure', async () => {
  const f = fixture({ async sendReport() { throw Object.assign(new Error('Provider rejected request'), { definiteRejection: true }); } });
  const result = await f.archive.processReport({ window, scheduled: true, now });
  assert.equal(result.report.generation_status, 'ready');
  assert.equal(result.report.email_status, 'failed');
  assert.ok(result.report.summary);
});

test('unknown email outcomes are never automatically resent', async () => {
  let emails = 0;
  const f = fixture({ async sendReport() { emails++; throw new Error('Network timeout'); } });
  await f.archive.processReport({ window, scheduled: true, now });
  await f.archive.processReport({ window, scheduled: true, now });
  assert.equal(emails, 1);
  assert.equal(f.records.get(window.key).email_status, 'unknown');
});

test('missing email configuration and closeout failure do not destroy snapshot', async () => {
  const f = fixture({ async sendReport() { return { status: 'not_configured' }; }, async closeStaleEvents() { throw new Error('close failed'); } });
  const result = await f.archive.processReport({ window, scheduled: true, now });
  assert.equal(result.report.generation_status, 'ready');
  assert.equal(result.report.email_status, 'not_configured');
  assert.equal(result.report.closeout_status, 'failed');
});

test('failed generation is recorded and can be retried', async () => {
  let builds = 0;
  const f = fixture({ async buildReport() { if (!builds++) throw new Error('data unavailable'); return { rows: [], totals: {} }; } });
  await assert.rejects(f.archive.processReport({ window }));
  assert.equal(f.records.get(window.key).generation_status, 'failed');
  assert.equal(f.records.get(window.key).processing_started_at, null);
  assert.equal((await f.archive.processReport({ window })).report.generation_status, 'ready');
});

test('concurrent generation is locked and stale email submission needs review', async () => {
  const f = fixture();
  await f.archive.processReport({ window });
  Object.assign(f.records.get(window.key), { processing_started_at: new Date().toISOString() });
  assert.equal((await f.archive.processReport({ window })).busy, true);
  Object.assign(f.records.get(window.key), { processing_started_at: '2026-01-01T00:00:00Z', email_status: 'sending' });
  const result = await f.archive.processReport({ window, scheduled: true, now });
  assert.equal(result.report.email_status, 'unknown');
  assert.equal(f.calls.email, 0);
});

test('missed weeks are visible only after scheduled generation is due', async () => {
  const f = fixture();
  assert.equal((await f.archive.listReports(now)).missing_report, false);
  assert.equal((await f.archive.listReports(new Date('2026-10-12T14:00:00Z'))).missing_report, true);
  await f.archive.processReport({ window });
  assert.equal((await f.archive.listReports(new Date('2026-10-12T14:00:00Z'))).missing_report, false);
});

test('invalid, future and non-Monday reporting dates are rejected', () => {
  const f = fixture();
  for (const date of ['2026-10-13', '2026-02-30', '2026-10-19', 'nonsense']) assert.throws(() => f.archive.windowForWeek(date, now));
  assert.equal(f.archive.windowForWeek('2026-10-05', now).key, '2026-10-05');
});

test('report reads paginate instead of silently truncating at database row caps', async () => {
  const requests = [];
  const paged = loadModule('weekly-production-report-worker.cjs', {}, {
    process: { env: new Proxy({}, { get: () => 'https://test.invalid' }) },
    fetch: async (url) => {
      const offset = Number(new URL(url).searchParams.get('offset'));
      requests.push(offset);
      const rows = offset === 0 ? Array.from({ length: 500 }, (_, id) => ({ id })) : [{ id: 500 }];
      return { ok: true, text: async () => JSON.stringify(rows) };
    }
  });
  assert.equal((await paged.allRows('events?select=id&order=id.asc')).length, 501);
  assert.deepEqual(requests, [0, 500]);
});

test('API rejects unauthorized requests before archive reads or writes', async () => {
  let accesses = 0;
  const handler = loadModule('api/admin/weekly-production-reports.js', {
    '../../lib/admin-auth': { assertAdminConfig() {}, adminAuthorized: () => ({ ok: false, error: 'Unauthorized.' }), sendJson: (res, status) => { res.status = status; } },
    '../../lib/weekly-report-archive': { async listReports() { accesses++; }, async processReport() { accesses++; } }
  });
  for (const method of ['GET', 'POST']) {
    const res = {};
    await handler({ method }, res);
    assert.equal(res.status, 401);
  }
  assert.equal(accesses, 0);
});

test('COMMAND displays the archive safely and all inline scripts parse', () => {
  const html = fs.readFileSync(path.join(root, 'apps/rel8tion-app/admin.html'), 'utf8');
  for (const [, script] of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)) if (script.trim()) new Function(script);
  assert.match(html, /\$\{renderWeeklyReports\(\)\}/);
  const source = html.slice(html.indexOf('    function weeklyStatusLabel'), html.indexOf('    function renderReports()'));
  const context = { state: { weeklyReports: { reports: [], loading: false, error: '', detail: null } },
    esc: (value) => String(value).replace(/</g, '&lt;'), fmtDate: String };
  vm.createContext(context);
  vm.runInContext(source, context);
  const body = context.weeklyReportBody({ week_start: '2026-10-05', summary: { totals: {}, rows: [{ address: '<script>bad</script>' }] } });
  assert.doesNotMatch(body, /<script>/);
  assert.match(context.renderWeeklyReports(), /No saved report/);
});

test('cron, archive routes and CI guard cannot silently disappear', () => {
  const config = JSON.parse(fs.readFileSync(path.join(root, 'vercel.json')));
  assert.ok(config.crons.some((cron) => cron.path === '/api/cron/weekly-production-report' && cron.schedule === '5 13,14 * * 1'));
  assert.match(fs.readFileSync(path.join(root, '.github/workflows/repo-checks.yml'), 'utf8'), /npm run verify:weekly-reports/);
  const sql = fs.readFileSync(path.join(root, 'supabase/migrations/20261013231741_weekly_production_report_archive.sql'), 'utf8');
  assert.match(sql, /enable row level security/i);
  assert.match(sql, /revoke all.*anon, authenticated/i);
});
