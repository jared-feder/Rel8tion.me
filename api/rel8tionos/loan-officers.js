const { assignLoanOfficer, listLoanOfficers } = require('../../lib/rel8tionos-outreach');
const {
  authorizeOrRespond,
  readJsonBody,
  requestId,
  sendError,
  sendJson
} = require('../../lib/rel8tionos-auth');

module.exports = async function handler(req, res) {
  const id = requestId(req);
  try {
    if (!['GET', 'POST'].includes(req.method)) {
      res.setHeader('Allow', 'GET, POST');
      sendJson(res, 405, { ok: false, error: 'Method not allowed.' }, id);
      return;
    }
    if (!authorizeOrRespond(req, res, id)) return;

    if (req.method === 'GET') {
      const loanOfficers = await listLoanOfficers();
      sendJson(res, 200, { ok: true, loan_officers: loanOfficers }, id);
      return;
    }

    const result = await assignLoanOfficer(readJsonBody(req));
    sendJson(res, 200, { ok: true, assignment: result }, id);
  } catch (error) {
    sendError(res, error, id);
  }
};
