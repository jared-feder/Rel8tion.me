const { acceptOpenHouse } = require('../../lib/rel8tionos-outreach');
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
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST');
      sendJson(res, 405, { ok: false, error: 'Method not allowed.' }, id);
      return;
    }
    if (!authorizeOrRespond(req, res, id)) return;

    const result = await acceptOpenHouse(readJsonBody(req));
    sendJson(res, 200, { ok: true, open_house: result }, id);
  } catch (error) {
    sendError(res, error, id);
  }
};
