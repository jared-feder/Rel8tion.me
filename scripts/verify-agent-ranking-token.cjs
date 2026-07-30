const fs = require('fs');
const path = require('path');

const apiPath = path.resolve(__dirname, '..', 'api', 'admin', 'agent-ranking.js');
const apiSource = fs.readFileSync(apiPath, 'utf8');
new Function('require', 'module', 'exports', apiSource);

async function invoke(handler, method, headers = {}) {
  let payload = null;
  const response = {
    setHeader: () => {},
    status(status) {
      this.statusCode = status;
      return this;
    },
    json(body) {
      payload = body;
      return body;
    }
  };
  await handler({ method, headers, query: {}, body: {} }, response);
  return { status: response.statusCode, payload };
}

async function verify() {
  if (!apiSource.includes("clampLimit(readQuery(req, 'pageSize') || readQuery(req, 'limit') || 50, 50, 1000)")) {
    throw new Error('Agent Ranking GET pagination no longer supports the bounded 1,000-row REL8TION OS page size.');
  }

  const originalToken = process.env.REL8TION_RANKING_TOKEN;
  process.env.REL8TION_RANKING_TOKEN = 'ranking-verification-token';
  const apiModule = { exports: {} };
  const customRequire = (request) => {
    if (request === 'crypto') return require('crypto');
    if (request === '../../lib/admin-auth') {
      return {
        adminAuthorized: (req) => (
          req.headers?.['x-admin-token'] === 'admin-verification-token'
            ? { ok: true, method: 'token' }
            : { ok: false, error: 'Unauthorized.' }
        ),
        assertAdminConfig: () => {},
        sendJson: (res, status, payload) => res.status(status).json(payload),
        supabaseRest: async () => []
      };
    }
    if (request === '../../lib/agent-ranking') return require('../lib/agent-ranking');
    if (request === '../../lib/agent-ranking-open-house') return require('../lib/agent-ranking-open-house');
    if (request === '../../lib/agent-ranking-history') return require('../lib/agent-ranking-history');
    if (request === '../../lib/location-intelligence') return require('../lib/location-intelligence');
    if (request === '../../agent-listing-inventory-worker.cjs') {
      return { run: async () => ({ ok: true, dry_run: true }) };
    }
    throw new Error(`Unexpected module request: ${request}`);
  };
  new Function('require', 'module', 'exports', apiSource)(customRequire, apiModule, apiModule.exports);

  const dedicatedRead = await invoke(apiModule.exports, 'GET', {
    'x-rel8tion-ranking-token': 'ranking-verification-token'
  });
  if (dedicatedRead.status !== 200 || dedicatedRead.payload?.ok !== true) {
    throw new Error('Dedicated ranking token did not authorize the read-only GET route.');
  }

  const rejectedRead = await invoke(apiModule.exports, 'GET', {
    'x-rel8tion-ranking-token': 'wrong-token'
  });
  if (rejectedRead.status !== 401) {
    throw new Error('Invalid ranking token was not rejected.');
  }

  const rejectedWrite = await invoke(apiModule.exports, 'POST', {
    'x-rel8tion-ranking-token': 'ranking-verification-token'
  });
  if (rejectedWrite.status !== 401) {
    throw new Error('Dedicated ranking token unexpectedly authorized a write.');
  }

  const adminRead = await invoke(apiModule.exports, 'GET', {
    'x-admin-token': 'admin-verification-token'
  });
  if (adminRead.status !== 200 || adminRead.payload?.ok !== true) {
    throw new Error('Existing admin-token read access was not preserved.');
  }

  if (originalToken === undefined) delete process.env.REL8TION_RANKING_TOKEN;
  else process.env.REL8TION_RANKING_TOKEN = originalToken;
  console.log('Agent Ranking read-only token verification passed.');
}

verify().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
