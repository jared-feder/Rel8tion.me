const { listThreads } = require('../../lib/rel8tionos-outreach');
const {
  authorizeOrRespond,
  readQuery,
  requestId,
  sendError,
  sendJson
} = require('../../lib/rel8tionos-auth');

module.exports = async function handler(req, res) {
  const id = requestId(req);
  try {
    if (req.method !== 'GET') {
      res.setHeader('Allow', 'GET');
      sendJson(res, 405, { ok: false, error: 'Method not allowed.' }, id);
      return;
    }
    if (!authorizeOrRespond(req, res, id)) return;

    const result = await listThreads({
      filter: String(readQuery(req, 'filter') || 'all').trim(),
      limit: readQuery(req, 'limit'),
      cursor: readQuery(req, 'cursor')
    });
    sendJson(res, 200, { ok: true, ...result }, id);
  } catch (error) {
    sendError(res, error, id);
  }
};
