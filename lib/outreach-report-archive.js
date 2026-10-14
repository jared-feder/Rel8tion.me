const { createArchive } = require('./weekly-report-archive');
const options = { worker: require('../outreach-performance-report-worker.cjs'),
  table: 'outreach_performance_reports', firstWeek: '2026-04-20', closeEvents: false };
const current = createArchive({ ...options, version: 2 });
const original = createArchive({ ...options, version: 1 });
async function getReport(key, version) {
  if (version != null && !['1', '2'].includes(String(version))) throw Object.assign(new Error('Unknown report edition.'), { status: 400 });
  if (String(version) === '1') return original.getReport(key);
  if (String(version) === '2') return current.getReport(key);
  return await current.getReport(key) || original.getReport(key);
}
async function listReports(now) {
  const [latest, legacy] = await Promise.all([current.listReports(now), original.listReports(now)]);
  const weeks = new Map(legacy.reports.map((row) => [row.week_start, { ...row, original_available: row.generation_status === 'ready' }]));
  for (const row of latest.reports) weeks.set(row.week_start, { ...row, original_available: weeks.get(row.week_start)?.original_available || false });
  return { ...latest, current_version: 2, reports: [...weeks.values()].sort((a, b) => b.week_start.localeCompare(a.week_start)),
    missing_report: latest.missing_report && legacy.missing_report, expanded_edition_missing: latest.missing_report };
}
module.exports = { ...current, getReport, listReports };
