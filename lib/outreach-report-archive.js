const { createArchive } = require('./weekly-report-archive');
module.exports = createArchive({ worker: require('../outreach-performance-report-worker.cjs'),
  table: 'outreach_performance_reports', firstWeek: '2026-04-20', closeEvents: false });
