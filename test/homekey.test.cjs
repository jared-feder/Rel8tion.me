const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

process.env.SUPABASE_URL = 'https://example.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-test-key';
process.env.KEY_RESET_ADMIN_TOKEN = 'admin-test-token';
process.env.PUBLIC_APP_URL = 'https://app.rel8tion.me';

const homekeyHandler = require('../api/admin/open-house-homekey.js');
const interestHandler = require('../api/open-house-keepsake-interest.js');
const { renderListingPage } = require('../api/open-house-link.js').__test;

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), { status, headers: { 'content-type': 'application/json' } });
}

function createResponse() {
  return {
    headers: {},
    statusCode: 200,
    body: null,
    setHeader(name, value) { this.headers[String(name).toLowerCase()] = String(value); },
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; },
    send(payload) { this.body = payload; return this; },
    writeHead(code, headers = {}) { this.statusCode = code; Object.entries(headers).forEach(([key, value]) => this.setHeader(key, value)); return this; },
    end(payload) { this.body = payload ?? this.body; return this; }
  };
}

async function request(handler, { method = 'POST', body = {}, query = {}, headers = {} } = {}) {
  const req = { method, body, query, headers, url: '/test' };
  const res = createResponse();
  await handler(req, res);
  return res;
}

test('HomeKey generation is idempotent for one open-house assignment and downloads a print PNG', async () => {
  let stored = null;
  let creates = 0;
  global.fetch = async (url, options = {}) => {
    const target = String(url);
    if (target.includes('/open_houses?')) return jsonResponse([{ id: 'house-1', address: '12 Home Key Lane', image: 'https://images.example/home.webp', open_start: '2026-08-09T17:00:00Z' }]);
    if (target.includes('/open_house_property_profiles?')) return jsonResponse([{ open_house_id: 'house-1', address: '12 Home Key Lane', city: 'Queens', state: 'NY', zip: '11375', primary_image: 'https://images.example/home.webp', open_start: '2026-08-09T17:00:00Z' }]);
    if (target.includes('/field_demo_visits?')) return jsonResponse([{ id: 'visit-1', open_house_id: 'house-1', open_house_event_id: 'event-1', scheduled_start: '2026-08-09T17:00:00Z', status: 'confirmed' }]);
    if (target.includes('/listing_agents?')) return jsonResponse([{ id: '11111111-1111-4111-8111-111111111111', name: 'Listing Agent', phone: '5165550101', is_primary: true }]);
    if (target.includes('/field_demo_visit_participants?')) return jsonResponse([{ participant_profile_id: '22222222-2222-4222-8222-222222222222', participant_uid: '22222222-2222-4222-8222-222222222222', role: 'loan_officer', is_primary: true }]);
    if (target.includes('/verified_profiles?')) return jsonResponse([{ uid: '22222222-2222-4222-8222-222222222222', full_name: 'Assigned LO', company_name: 'NMB', phone: '5165550102' }]);
    if (target.includes('/property_keepsakes?attribution_key=')) return jsonResponse(stored ? [stored] : []);
    if (target.endsWith('/rest/v1/property_keepsakes') && options.method === 'POST') {
      creates += 1;
      stored = { id: '33333333-3333-4333-8333-333333333333', ...JSON.parse(options.body) };
      return jsonResponse([stored]);
    }
    if (target.includes('/property_keepsakes?public_code=')) return jsonResponse(stored ? [stored] : []);
    throw new Error(`Unexpected request: ${target}`);
  };

  const first = await request(homekeyHandler, {
    headers: { 'x-admin-token': 'admin-test-token' },
    body: { open_house_id: 'house-1', field_visit_id: 'visit-1' }
  });
  const second = await request(homekeyHandler, {
    headers: { 'x-admin-token': 'admin-test-token' },
    body: { open_house_id: 'house-1', field_visit_id: 'visit-1' }
  });

  assert.equal(first.statusCode, 200);
  assert.equal(first.body.reused, false);
  assert.equal(second.body.reused, true);
  assert.equal(second.body.homekey.public_code, first.body.homekey.public_code);
  assert.equal(second.body.homekey.loan_officer_uid, '22222222-2222-4222-8222-222222222222');
  assert.equal(creates, 1);
  assert.match(first.body.url, /^https:\/\/app\.rel8tion\.me\/h\/[A-Za-z0-9_-]+$/);
  assert.match(first.body.qr_data_url, /^data:image\/png;base64,/);

  const png = await request(homekeyHandler, {
    method: 'GET',
    headers: { 'x-admin-token': 'admin-test-token' },
    query: { format: 'png', code: stored.public_code }
  });
  assert.equal(png.statusCode, 200);
  assert.equal(png.headers['content-type'], 'image/png');
  assert.ok(Buffer.isBuffer(png.body));
  assert.deepEqual([...png.body.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
});

test('HomeKey buyer action upserts an attributed lead and records the focused event', async () => {
  const calls = [];
  let leadPayload = null;
  global.fetch = async (url, options = {}) => {
    const target = String(url);
    calls.push({ target, options });
    if (target.includes('/property_keepsakes?public_code=')) return jsonResponse([{
      id: '33333333-3333-4333-8333-333333333333', public_code: 'HK-code', open_house_id: 'house-1', open_house_event_id: 'event-1', field_demo_visit_id: 'visit-1', listing_agent_id: '11111111-1111-4111-8111-111111111111', loan_officer_uid: '22222222-2222-4222-8222-222222222222', status: 'active'
    }]);
    if (target.includes('/open_houses?')) return jsonResponse([{ id: 'house-1', address: '12 Home Key Lane', price: 725000 }]);
    if (target.includes('/open_house_property_profiles?')) return jsonResponse([{ address: '12 Home Key Lane', price: 725000 }]);
    if (target.includes('/listing_agents?')) return jsonResponse([{ id: '11111111-1111-4111-8111-111111111111', name: 'Listing Agent', phone: '5165550101' }]);
    if (target.includes('/verified_profiles?')) return jsonResponse([{ uid: '22222222-2222-4222-8222-222222222222', full_name: 'Assigned LO' }]);
    if (target.includes('/agent_websites?')) return jsonResponse([{ slug: 'listing-agent', name: 'Listing Agent', phone: '5165550101' }]);
    if (target.includes('/leads?chip_uid=')) return jsonResponse([]);
    if (target.includes('/leads?on_conflict=source_key')) {
      leadPayload = JSON.parse(options.body);
      return jsonResponse([{ id: 'lead-1', ...leadPayload }]);
    }
    if (target.endsWith('/rest/v1/property_keepsake_events')) return jsonResponse([]);
    throw new Error(`Unexpected request: ${target}`);
  };

  const response = await request(interestHandler, {
    body: {
      homekey_code: 'HK-code',
      selected_action: 'off_market',
      request_detail: 'Tell Me About Off-Market Opportunities',
      name: 'Buyer Person',
      phone: '(516) 555-0199',
      consent: true
    }
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.body.homekey_code, 'HK-code');
  assert.equal(leadPayload.source, 'homekey');
  assert.equal(leadPayload.agent_slug, 'listing-agent');
  assert.equal(leadPayload.metadata.open_house_id, 'house-1');
  assert.equal(leadPayload.metadata.listing_agent_id, '11111111-1111-4111-8111-111111111111');
  assert.equal(leadPayload.metadata.loan_officer_uid, '22222222-2222-4222-8222-222222222222');
  assert.deepEqual(leadPayload.metadata.actions, ['off_market']);
  const eventCall = calls.find((call) => call.target.endsWith('/rest/v1/property_keepsake_events'));
  assert.equal(JSON.parse(eventCall.options.body).event_type, 'off_market_requested');
});

test('HomeKey migration keeps durable records and events server-managed', () => {
  const migration = fs.readFileSync(path.join(__dirname, '../supabase/migrations/20260808085230_open_house_keepsake_lead_source.sql'), 'utf8');
  assert.match(migration, /create table if not exists public\.property_keepsakes/);
  assert.match(migration, /attribution_key text not null unique/);
  assert.match(migration, /loan_officer_uid uuid references public\.verified_profiles/);
  assert.match(migration, /alter table public\.property_keepsakes enable row level security/);
  assert.match(migration, /revoke all on table public\.property_keepsakes from anon, authenticated/);
  assert.match(migration, /create unique index if not exists leads_source_key_unique_idx/);
});

test('real linked open-house fixture renders its verified property, agent, and assigned loan officer', () => {
  const html = renderListingPage({
    id: 'M00000489-1025483',
    house: {
      id: 'M00000489-1025483',
      address: '238 Laclede Ave, Uniondale, NY 11553',
      image: 'https://brokerdata-b.b-cdn.net/mlsgrid/onekey/property/M00000489-1025483/508ed3bb-1262-4a40-8e15-032351633a9b.webp',
      price: 770000,
      beds: 4,
      baths: 3,
      sqft: 1273
    },
    profile: {
      open_house_id: 'M00000489-1025483',
      address: '238 Laclede Ave, Uniondale, NY 11553',
      listing_status: 'Active',
      property_type: 'Residential',
      features: ['Attic', 'Central cooling', 'Single Family Residence'],
      images: ['https://brokerdata-b.b-cdn.net/mlsgrid/onekey/property/M00000489-1025483/508ed3bb-1262-4a40-8e15-032351633a9b.webp']
    },
    targetUrl: '',
    externalCheck: { available: false },
    keepsake: true,
    homekey: { id: 'local-fixture-homekey', public_code: 'local-fixture-code' },
    agents: [{
      name: 'Katia Santesteban',
      brokerage: 'Success King Realty',
      phone: '(917) 939-6235',
      email: 'katiasantesteban@gmail.com',
      photo_url: 'https://nicanqrfqlbnlmnoernb.supabase.co/storage/v1/object/public/agent-images/command/katia-santesteban-3c26a129fa54/1785981132488.jpg'
    }],
    loanOfficer: {
      uid: '38e5ab84-c1a2-4107-9f05-47a6caeda341',
      name: 'Jared Feder',
      title: 'Mortgage Loan Officer',
      company: 'NMB',
      phone: '3477758059',
      email: 'jfeder@nmbnow.com',
      website_url: 'https://www.nmbnow.com/jared-feder'
    }
  });
  assert.match(html, /238 Laclede Ave, Uniondale, NY 11553/);
  assert.match(html, /Katia Santesteban/);
  assert.match(html, /Success King Realty/);
  assert.match(html, /Jared Feder/);
  assert.match(html, /FINANCING SUPPORT/);
  assert.doesNotMatch(html, />Instagram</);
});

test('route map exposes the clean permanent HomeKey URL', () => {
  const config = JSON.parse(fs.readFileSync(path.join(__dirname, '../vercel.json'), 'utf8'));
  assert.ok(config.rewrites.some((rewrite) => rewrite.source === '/h/:code' && rewrite.destination === '/api/open-house-link?homekey=:code'));
});

test.after(() => {
  delete global.fetch;
});
