const BASE_URL = (process.env.BASE_URL || 'https://app.rel8tion.me').replace(/\/$/, '');
const ADMIN_UID = process.env.REL8TION_COMMAND_ADMIN_UID || process.env.ADMIN_UID || '';
const ADMIN_TOKEN =
  process.env.REL8TION_COMMAND_ADMIN_TOKEN ||
  process.env.KEY_RESET_ADMIN_TOKEN ||
  process.env.ADMIN_TOKEN ||
  '';
const REQUIRE_AUTH = process.env.REQUIRE_COMMAND_SEARCH_AUTH === '1';

function fail(message) {
  console.error(`COMMAND search verification failed: ${message}`);
  process.exit(1);
}

async function request(path, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(`${BASE_URL}${path}`, {
      method: options.method || 'GET',
      headers: {
        Accept: 'application/json,text/html;q=0.9,*/*;q=0.8',
        ...(options.headers || {})
      },
      signal: controller.signal
    });
    const text = await response.text();
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch (_) {}
    return { response, text, json };
  } finally {
    clearTimeout(timeout);
  }
}

function authHeaders() {
  const headers = { 'Content-Type': 'application/json' };
  if (ADMIN_UID) headers['x-admin-uid'] = ADMIN_UID;
  if (ADMIN_TOKEN) headers['x-admin-token'] = ADMIN_TOKEN;
  return headers;
}

function includesName(rows, name) {
  const expected = String(name || '').toLowerCase();
  return (rows || []).some((row) => String(row.agent_name || '').toLowerCase().includes(expected));
}

function includesAddress(rows, address) {
  const expected = String(address || '').toLowerCase();
  return (rows || []).some((row) => String(row.address || '').toLowerCase().includes(expected));
}

async function verifyPreflight() {
  const { response } = await request('/api/admin/outreach-search?q=118%20s%2031st%20st%20wyandanch&limit=5', {
    method: 'OPTIONS',
    headers: {
      Origin: BASE_URL,
      'Access-Control-Request-Method': 'GET',
      'Access-Control-Request-Headers': 'x-admin-token,x-admin-uid,content-type'
    }
  });

  if (response.status !== 204) fail(`preflight returned ${response.status}, expected 204`);
  const allowMethods = response.headers.get('access-control-allow-methods') || '';
  const allowHeaders = response.headers.get('access-control-allow-headers') || '';
  if (!allowMethods.includes('GET') || !allowMethods.includes('OPTIONS')) {
    fail(`preflight allow-methods header is wrong: ${allowMethods}`);
  }
  if (!/x-admin-token/i.test(allowHeaders) || !/x-admin-uid/i.test(allowHeaders)) {
    fail(`preflight allow-headers missing admin headers: ${allowHeaders}`);
  }
}

async function verifyUnauthenticated() {
  const { response, json, text } = await request('/api/admin/outreach-search?q=test&limit=1');
  if (response.status !== 401) fail(`unauthenticated search returned ${response.status}, expected 401`);
  if (json?.ok !== false || !/unauthorized/i.test(json?.error || text || '')) {
    fail('unauthenticated search did not return a clear JSON Unauthorized error');
  }
}

async function verifyAuthenticatedSearch() {
  if (!ADMIN_TOKEN && !ADMIN_UID) {
    if (REQUIRE_AUTH) fail('missing REL8TION_COMMAND_ADMIN_TOKEN or REL8TION_COMMAND_ADMIN_UID');
    console.warn('Skipping authenticated COMMAND search checks because no admin credential env var is set.');
    return;
  }

  const wyandanch = await request('/api/admin/outreach-search?q=118%20s%2031st%20st%20wyandanch&limit=20', {
    headers: authHeaders()
  });
  if (wyandanch.response.status !== 200 || wyandanch.json?.ok !== true) {
    fail(`authenticated Wyandanch search returned ${wyandanch.response.status}: ${wyandanch.text.slice(0, 300)}`);
  }
  const rows = wyandanch.json.rows || [];
  if (!includesAddress(rows, '118 S 31st St')) fail('Wyandanch search did not include 118 S 31st St');
  if (!includesName(rows, 'Kavneet Baweja')) fail('Wyandanch search did not include Kavneet Baweja');
  if (!includesName(rows, 'Genessis Miranda')) fail('Wyandanch search did not include Genessis Miranda');
  if (!rows.some((row) => row.search_result_type === 'listing_agent' && /genessis miranda/i.test(row.agent_name || ''))) {
    fail('Genessis Miranda was not marked as a listing-agent search result');
  }

  const wellesley = await request('/api/admin/outreach-search?q=165%20Wellesley&limit=20', {
    headers: authHeaders()
  });
  if (wellesley.response.status !== 200 || wellesley.json?.ok !== true) {
    fail(`authenticated Wellesley search returned ${wellesley.response.status}: ${wellesley.text.slice(0, 300)}`);
  }
  if (!includesAddress(wellesley.json.rows || [], '165 Wellesley')) {
    fail('Wellesley search did not include 165 Wellesley');
  }
}

async function main() {
  await verifyPreflight();
  await verifyUnauthenticated();
  await verifyAuthenticatedSearch();
  console.log(`COMMAND search verification passed for ${BASE_URL}.`);
}

main().catch((error) => fail(error.message || String(error)));
