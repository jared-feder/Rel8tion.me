const assert = require('node:assert/strict');
const JSZip = require('jszip');

process.env.SUPABASE_URL = 'https://example.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-test-key';
process.env.KEY_RESET_ADMIN_TOKEN = 'admin-test-token';

const handler = require('../api/admin/agent-qr-batch');

function responseJson(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' }
  });
}

function createResponse() {
  return {
    headers: {},
    statusCode: 200,
    body: null,
    setHeader(name, value) {
      this.headers[String(name).toLowerCase()] = String(value);
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
    send(payload) {
      this.body = payload;
      return this;
    }
  };
}

async function requestBatch(body, fetchImpl) {
  global.fetch = fetchImpl;
  const req = {
    method: 'POST',
    headers: { 'x-admin-token': 'admin-test-token' },
    body
  };
  const res = createResponse();
  await handler(req, res);
  return res;
}

async function readArchive(buffer) {
  const zip = await JSZip.loadAsync(buffer);
  const files = Object.keys(zip.files).sort();
  const csvName = files.find((name) => name.endsWith('.csv'));
  return {
    files,
    csvName,
    csv: await zip.file(csvName).async('string'),
    readme: await zip.file('README.txt').async('string')
  };
}

async function verifyAgentBatch() {
  const calls = [];
  const res = await requestBatch({ quantity: 1, inventory_type: 'agent' }, async (url, options = {}) => {
    calls.push({ url, options });
    if (options.method === 'PATCH') {
      return responseJson([{
        id: 'agent-row-1',
        chip_code: 'ra-test01',
        qr_url: 'https://irel8.me/c/ra-test01',
        printed_at: '2026-07-27T12:00:00.000Z'
      }]);
    }
    return responseJson([{
      id: 'agent-row-1',
      chip_code: 'ra-test01',
      qr_url: 'https://irel8.me/c/ra-test01',
      created_at: '2026-07-27T11:00:00.000Z'
    }]);
  });

  assert.equal(res.statusCode, 200);
  assert.equal(res.headers['x-rel8tion-inventory-type'], 'agent');
  assert.match(res.headers['content-disposition'], /^attachment; filename="agent-qr-/);
  assert.equal(calls.length, 2);
  assert.match(calls[0].url, /rel8tion_chip_inventory\?chip_type=eq\.agent/);

  const archive = await readArchive(res.body);
  assert.equal(archive.csvName, 'agent-qr-batch.csv');
  assert.ok(archive.files.includes('images/ra-test01.png'));
  assert.match(archive.csv, /sequence,chip_code,qr_url,image_file,batch_id,printed_at/);
  assert.match(archive.csv, /https:\/\/irel8\.me\/c\/ra-test01/);
  assert.match(archive.readme, /public agent-profile resolver/);
}

async function verifyEventPassBatch() {
  const calls = [];
  const claimed = {
    id: 'claimed-pass',
    public_code: 'ep-claimed',
    qr_url: 'https://app.rel8tion.me/pass?code=ep-claimed',
    inventory_type: 'event_pass',
    is_printed: false,
    claimed_at: '2026-07-27T10:00:00.000Z',
    smart_sign_id: null,
    assigned_agent_slug: null,
    assigned_agent_phone: null,
    sponsor_loan_officer_profile_id: null,
    sponsor_loan_officer_uid: null,
    pass_model: 'single_event',
    sponsor_coverage_required: false,
    sponsor_coverage_consent_required: true,
    reuse_allowed: false,
    reuse_status: 'not_reusable',
    metadata: {}
  };
  const fresh = {
    ...claimed,
    id: 'fresh-pass',
    public_code: 'ep-fresh123456',
    qr_url: 'https://wrong.example/ignored',
    claimed_at: null
  };

  const res = await requestBatch({ quantity: 1, inventory_type: 'event_pass' }, async (url, options = {}) => {
    calls.push({ url, options });
    if (options.method === 'PATCH') {
      assert.match(url, /id=eq\.fresh-pass/);
      assert.doesNotMatch(url, /claimed-pass/);
      const patch = JSON.parse(options.body);
      assert.equal(patch.is_printed, true);
      assert.equal(patch.metadata.print_source, 'admin_qr_batch');
      assert.match(patch.metadata.print_batch_id, /^event-pass-qr-/);
      return responseJson([{
        ...fresh,
        is_printed: true,
        metadata: patch.metadata
      }]);
    }
    assert.match(url, /smart_sign_inventory\?inventory_type=eq\.event_pass/);
    assert.match(url, /claimed_at=is\.null/);
    assert.match(url, /reuse_status=eq\.not_reusable/);
    return responseJson([claimed, fresh]);
  });

  assert.equal(res.statusCode, 200);
  assert.equal(res.headers['x-rel8tion-inventory-type'], 'event_pass');
  assert.match(res.headers['content-disposition'], /^attachment; filename="event-pass-qr-/);
  assert.equal(calls.length, 2);

  const archive = await readArchive(res.body);
  assert.equal(archive.csvName, 'event-pass-qr-batch.csv');
  assert.ok(archive.files.includes('images/ep-fresh123456.png'));
  assert.match(archive.csv, /sequence,public_code,qr_url,image_file,batch_id,printed_at/);
  assert.match(archive.csv, /https:\/\/app\.rel8tion\.me\/pass\?code=ep-fresh123456/);
  assert.doesNotMatch(archive.csv, /wrong\.example/);
  assert.match(archive.readme, /fresh smart_sign_inventory Event Pass inventory/);
}

async function verifySmartSignBatch() {
  const calls = [];
  const res = await requestBatch({ quantity: 2, inventory_type: 'smart_sign' }, async (url, options = {}) => {
    calls.push({ url, options });
    if (options.method === 'POST') {
      assert.equal(url, 'https://example.supabase.co/rest/v1/smart_sign_inventory');
      const rows = JSON.parse(options.body);
      assert.equal(rows.length, 2);
      assert.equal(new Set(rows.map((row) => row.public_code)).size, 2);
      for (const row of rows) {
        assert.match(row.public_code, /^[a-f0-9]{12}$/);
        assert.equal(row.inventory_type, 'smart_sign');
        assert.equal(row.is_printed, true);
        assert.equal(row.qr_url, `https://app.rel8tion.me/s?code=${row.public_code}`);
        assert.match(row.notes, /^Smart Sign admin print batch smart-sign-qr-/);
        assert.match(row.metadata.print_batch_id, /^smart-sign-qr-/);
        assert.equal(row.metadata.print_source, 'admin_qr_batch');
        assert.equal('smart_sign_id' in row, false);
        assert.equal('assigned_agent_slug' in row, false);
        assert.equal('pass_model' in row, false);
      }
      return responseJson(rows.map((row, index) => ({ id: `smart-sign-${index + 1}`, ...row })));
    }
    assert.match(url, /smart_sign_inventory\?public_code=in\.\(/);
    assert.match(url, /select=public_code/);
    return responseJson([]);
  });

  assert.equal(res.statusCode, 200);
  assert.equal(res.headers['x-rel8tion-inventory-type'], 'smart_sign');
  assert.match(res.headers['content-disposition'], /^attachment; filename="smart-sign-qr-/);
  assert.equal(calls.length, 2);

  const archive = await readArchive(res.body);
  assert.equal(archive.csvName, 'smart-sign-qr-batch.csv');
  const imageFiles = archive.files.filter((name) => /^images\/[a-f0-9]{12}\.png$/.test(name));
  assert.equal(imageFiles.length, 2);
  assert.match(archive.csv, /sequence,public_code,qr_url,image_file,batch_id,printed_at/);
  assert.match(archive.csv, /https:\/\/app\.rel8tion\.me\/s\?code=[a-f0-9]{12}/);
  assert.match(archive.readme, /regular Smart Sign resolver/);
  assert.match(archive.readme, /inventory_type=smart_sign/);
}

async function verifyGuards() {
  let called = false;
  const invalid = await requestBatch({ quantity: 1, inventory_type: 'loan_officer' }, async () => {
    called = true;
    return responseJson([]);
  });
  assert.equal(invalid.statusCode, 400);
  assert.equal(called, false);
  assert.match(invalid.body.error, /agent, smart_sign, or event_pass/);

  const empty = await requestBatch({ quantity: 1, inventory_type: 'event_pass' }, async () => responseJson([]));
  assert.equal(empty.statusCode, 409);
  assert.match(empty.body.error, /No fresh unprinted Event Pass/);
}

(async () => {
  try {
    await verifyAgentBatch();
    await verifySmartSignBatch();
    await verifyEventPassBatch();
    await verifyGuards();
    console.log('Admin Agent/Smart Sign/Event Pass QR batch verification passed.');
  } finally {
    delete global.fetch;
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
