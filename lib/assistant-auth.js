const crypto = require('node:crypto');
const {fail} = require('./assistant-workspace');
function equal(a,b) { return !!a && !!b && Buffer.byteLength(a) === Buffer.byteLength(b) && crypto.timingSafeEqual(Buffer.from(a),Buffer.from(b)); }
function authorize(req, env = process.env, at = Date.now()) {
  // Unlike legacy COMMAND auth, a public keychain UID never grants access here.
  if (equal(req.headers?.['x-admin-token'], env.KEY_RESET_ADMIN_TOKEN || env.ADMIN_TOKEN)) return {owner:true,id:'jared',scopes:['read','draft','approve','send','simulate','dismiss','push'],threads:[]};
  const token = String(req.headers?.authorization || '').replace(/^Bearer /,'');
  const [payload,signature,...extra] = token.split('.');
  if (!env.ASSISTANT_CONNECTION_SECRET || !env.ASSISTANT_CONNECTION_VERSION || extra.length || !payload || !signature) fail(401,'A server-verified assistant connection or owner token is required.');
  const expected = crypto.createHmac('sha256',env.ASSISTANT_CONNECTION_SECRET).update(payload).digest('base64url');
  if (!equal(signature,expected)) fail(401,'Invalid assistant connection.');
  let claims; try { claims = JSON.parse(Buffer.from(payload,'base64url')); } catch { fail(401,'Invalid assistant connection.'); }
  const seconds = at / 1000;
  if (claims.aud !== 'rel8tion-assistant' || claims.sub !== 'cat' || !Number.isFinite(claims.exp) || !Number.isFinite(claims.iat) || claims.exp <= seconds || claims.iat > seconds || claims.exp - claims.iat > 900 || claims.version !== env.ASSISTANT_CONNECTION_VERSION || !Array.isArray(claims.threads) || !claims.threads.length || !claims.threads.every(t=> typeof t === 'string') || !Array.isArray(claims.scopes) || !claims.scopes.every(s=>['read','draft','simulate'].includes(s))) fail(401,'Expired, revoked or invalid assistant connection.');
  return {owner:false,id:'cat',threads:claims.threads,scopes:claims.scopes};
}
module.exports = {authorize};
