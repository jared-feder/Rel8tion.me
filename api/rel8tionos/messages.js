const { getThread } = require('../../lib/rel8tionos-outreach');
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

    const threadId = readQuery(req, 'thread_id') || readQuery(req, 'id');
    const result = await getThread(threadId);
    sendJson(res, 200, { ok: true, ...result }, id);
  } catch (error) {
    sendError(res, error, id);
  }
};
