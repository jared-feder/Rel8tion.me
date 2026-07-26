const assert = require('assert');

const adminAuthPath = require.resolve('../lib/admin-auth');
const chipQrPath = require.resolve('../api/chip-qr');

const convertedChip = {
  id: '00000000-0000-4000-8000-000000000001',
  chip_code: 'ra0034c0',
  chip_type: 'agent',
  status: 'retired',
  agent_slug: null,
  uid: null
};

const convertedPass = {
  id: '11111111-1111-4111-8111-111111111111',
  public_code: 'ra0034c0',
  inventory_type: 'event_pass',
  qr_url: 'https://app.rel8tion.me/pass?code=ra0034c0',
  metadata: {
    converted_from_agent_qr: true,
    rel8tion_chip_inventory_id: convertedChip.id
  }
};

const normalChip = {
  id: '22222222-2222-4222-8222-222222222222',
  chip_code: 'ra-normal',
  chip_type: 'agent',
  status: 'unassigned',
  agent_slug: null,
  uid: null
};

async function supabaseRest(path, options = {}) {
  if (options.method === 'PATCH') return [];
  if (path.startsWith('rel8tion_chip_inventory?chip_code=eq.ra0034c0')) return [convertedChip];
  if (path.startsWith('smart_sign_inventory?public_code=eq.ra0034c0')) return [convertedPass];
  if (path.startsWith('rel8tion_chip_inventory?chip_code=eq.ra-normal')) return [normalChip];
  throw new Error(`Unexpected Supabase request: ${path}`);
}

function sendJson(res, status, payload) {
  res.status(status).json(payload);
}

require.cache[adminAuthPath] = {
  id: adminAuthPath,
  filename: adminAuthPath,
  loaded: true,
  exports: { sendJson, supabaseRest }
};
delete require.cache[chipQrPath];
const handler = require(chipQrPath);

function response() {
  return {
    statusCode: 200,
    headers: {},
    body: null,
    ended: false,
    setHeader(name, value) {
      this.headers[String(name).toLowerCase()] = value;
      return this;
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      this.ended = true;
      return this;
    },
    send(payload) {
      this.body = payload;
      this.ended = true;
      return this;
    },
    writeHead(code, headers) {
      this.statusCode = code;
      for (const [name, value] of Object.entries(headers || {})) this.setHeader(name, value);
    },
    end() {
      this.ended = true;
    }
  };
}

async function run() {
  const redirected = response();
  await handler({ method: 'GET', url: '/api/chip-qr?code=ra0034c0', headers: {} }, redirected);
  assert.equal(redirected.statusCode, 302);
  assert.equal(redirected.headers.location, '/pass?code=ra0034c0');

  const json = response();
  await handler({
    method: 'GET',
    url: '/api/chip-qr?code=ra0034c0&format=json',
    headers: { accept: 'application/json' }
  }, json);
  assert.equal(json.statusCode, 200);
  assert.equal(json.body.event_pass, true);
  assert.equal(json.body.converted_from_agent_qr, true);
  assert.equal(json.body.pass_url, '/pass?code=ra0034c0');

  const normal = response();
  await handler({ method: 'GET', url: '/api/chip-qr?code=ra-normal', headers: {} }, normal);
  assert.equal(normal.statusCode, 200);
  assert.match(normal.body, /Rel8tionChip Not Linked Yet/);

  console.log('Converted Event Pass QR verification passed.');
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
