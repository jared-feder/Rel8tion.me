const original = require('./outreach-report-pdf-v1');
const expanded = require('./outreach-report-pdf-v2');
module.exports = { ...original,
  renderPdf: summary => (summary.version === 2 ? expanded : original).renderPdf(summary),
  emailHtml: summary => (summary.version === 2 ? expanded : original).emailHtml(summary)
};
