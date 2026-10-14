// Weekly report persistence is separate from event closeout and email delivery.
const { randomUUID } = require('node:crypto');
const defaultWorker = require('../weekly-production-report-worker.cjs');
const enc = encodeURIComponent;

function createArchive({ worker = defaultWorker, table = 'weekly_production_reports', firstWeek = '2026-07-13', closeEvents = true } = {}) {
const TABLE = table;

function windowForWeek(value, now = new Date()) {
  if (!value) return worker.reportWindow(now);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw Object.assign(new Error('Choose a completed reporting week.'), { status: 400 });
  const date = new Date(`${value}T12:00:00Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value || date.getUTCDay() !== 1) {
    throw Object.assign(new Error('The reporting week must start on a Monday.'), { status: 400 });
  }
  const window = worker.reportWindow(new Date(date.getTime() + 7 * 86400000));
  if (window.end > worker.reportWindow(now).end || value < firstWeek) {
    throw Object.assign(new Error(`Choose a completed week on or after ${firstWeek}.`), { status: 400 });
  }
  return window;
}

async function getReport(key) {
  return (await worker.rest(`${TABLE}?week_start=eq.${enc(key)}&select=*&limit=1`))[0] || null;
}

async function update(key, changes, filter = '') {
  return worker.rest(`${TABLE}?week_start=eq.${enc(key)}${filter}`, {
    method: 'PATCH', headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ ...changes, updated_at: new Date().toISOString() })
  });
}

function configurationStatus() {
  const missing = [];
  const email = worker.emailConfiguration();
  if (!email.provider) missing.push('Email provider');
  if (!email.recipientsConfigured) missing.push('Report recipients');
  if (!(process.env.CRON_SECRET || process.env.CRON_SHARED_SECRET)) missing.push('Scheduler authentication');
  return { ready: !missing.length, missing };
}

async function listReports(now = new Date()) {
  const reports = await worker.rest(`${TABLE}?select=week_start,generation_status,generation_error,generated_at,processing_started_at,closeout_status,closeout_result,email_status,email_error,email_attempted_at,email_sent_at,updated_at&order=week_start.desc&limit=104`);
  const expected = worker.reportWindow(now);
  const latest = reports.find((row) => row.week_start === expected.key);
  // Give the Monday 09:05 New York cron time to finish before declaring a miss.
  const due = now.getTime() >= expected.end.getTime() + 9.25 * 3600000;
  return {
    reports, expected_week: expected.key, due,
    missing_report: due && latest?.generation_status !== 'ready',
    configuration: configurationStatus()
  };
}

async function processReport({ window = worker.reportWindow(), scheduled = false, emailOnly = false, now = new Date() } = {}) {
  await worker.rest(`${TABLE}?on_conflict=week_start`, {
    method: 'POST', headers: { Prefer: 'resolution=ignore-duplicates,return=minimal' },
    body: JSON.stringify({ week_start: window.key, window_start: window.start.toISOString(), window_end: window.end.toISOString() })
  });
  const token = randomUUID();
  const cutoff = new Date(Date.now() - 15 * 60000).toISOString();
  const claimed = await update(window.key, { processing_started_at: new Date().toISOString(), processing_token: token },
    `&or=(processing_started_at.is.null,processing_started_at.lt.${enc(cutoff)})`);
  if (!claimed.length) return { busy: true, report: await getReport(window.key) };
  let report = claimed[0];
  const save = async (changes) => {
    const rows = await update(window.key, changes, `&processing_token=eq.${token}`);
    if (!rows.length) throw new Error('Report processing lock expired. Refresh the archive.');
    report = rows[0];
    return report;
  };
  try {
    if (report.generation_status !== 'ready') {
      await save({ generation_status: 'building', generation_error: null });
      try {
        const summary = await worker.buildReport(window);
        await save({ generation_status: 'ready', summary, generated_at: new Date().toISOString(), generation_error: null });
      } catch (error) {
        await save({ generation_status: 'failed', generation_error: 'Report generation failed. Retry generation; check server logs if it persists.' });
        throw error;
      }
    }
    if (scheduled || emailOnly) {
      if (closeEvents && scheduled && report.closeout_status !== 'complete') {
        try {
          const result = await worker.closeStaleEvents(window, now);
          await save({ closeout_status: 'complete', closeout_result: result });
        } catch (_) {
          await save({ closeout_status: 'failed', closeout_result: { error: 'Event closeout failed. Review active events before retrying.' } });
        }
      }
      if (report.email_status === 'sending') {
        // A prior process may have submitted email before losing its response. Never blindly resend.
        await save({ email_status: 'unknown', email_error: 'Previous email submission was interrupted. Verify provider activity before resending.' });
      }
      if (!['sent', 'unknown'].includes(report.email_status)) {
        await save({ email_status: 'sending', email_error: null, email_attempted_at: new Date().toISOString() });
        try {
          const result = await worker.sendReport(report.summary, window, report.closeout_result?.closed || 0);
          await save({
            email_status: result.status, email_id: result.id || null,
            email_sent_at: result.status === 'sent' ? new Date().toISOString() : null,
            email_error: result.status === 'not_configured' ? 'Email provider or report recipients are not configured.' : null
          });
        } catch (error) {
          await save({ email_status: error.definiteRejection ? 'failed' : 'unknown',
            email_error: error.definiteRejection ? error.message : 'Email submission could not be confirmed. Verify provider activity before resending.' });
        }
      }
    }
    return { skipped: false, report, email: { status: report.email_status } };
  } finally {
    await update(window.key, { processing_started_at: null, processing_token: null }, `&processing_token=eq.${token}`);
  }
}

return { windowForWeek, getReport, listReports, processReport, configurationStatus };
}
module.exports = { ...createArchive(), createArchive };
