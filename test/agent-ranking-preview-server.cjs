const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const HOST = '127.0.0.1';
const PORT = Number(process.env.AGENT_RANKING_PREVIEW_PORT || 4177);
const ROOT = path.resolve(__dirname, '..');
const PAGE_PATH = path.join(ROOT, 'apps', 'rel8tion-app', 'agent-ranking.html');
const RANKING_ID = '11111111-1111-4111-8111-111111111111';

const ranking = {
  id: RANKING_ID,
  identity_key: 'fixture:ruth-chalco',
  agent_name: 'Ruth Chalco',
  first_name: 'Ruth',
  last_name: 'Chalco',
  brokerage: 'Local Test Brokerage',
  phone: '(516) 555-0142',
  phone_normalized: '5165550142',
  email: 'ruth.preview@example.test',
  primary_county: 'Nassau',
  county: 'Nassau',
  market_area: 'Long Island',
  city: 'Lynbrook',
  state: 'NY',
  zip: '11563',
  location_source: 'test_fixture',
  location_confidence: 100,
  active_listing_count: 3,
  listings_days_since_last: 9,
  listings_active_last_12_months: 13,
  buyside_last_90_days: 2,
  buyside_last_12_months: 8,
  database_current_listing_count: 1,
  database_upcoming_open_house_count: 1,
  matched_open_house_count: 1,
  matched_active_listing_count: 1,
  matched_weekend_open_house_count: 1,
  has_open_house_this_weekend: true,
  open_house_count: 1,
  agent_rank_score: 88,
  opportunity_gap_score: 76,
  recommended_tier: 'A',
  gap_summary: 'ListReports reports three active listings, while the protected REL8TION inventory currently contains one matching listing.',
  next_best_action: 'Review the current listing and its upcoming open house before preparing manual marketing.',
  rel8tion_value_summary: 'REL8TION can prepare listing-specific open-house marketing without requiring a full enrichment pass first.',
  recommended_pitch: 'Offer Ruth a ready-to-use Event Pass for the upcoming open house.',
  raw_sources: {
    labels: ['LOCAL TEST FIXTURE', 'Worked with']
  },
  updated_at: '2026-07-29T22:00:00.000Z'
};

const listing = {
  id: '22222222-2222-4222-8222-222222222222',
  source: 'onekey_test_fixture',
  source_listing_id: 'FIXTURE-RUTH-001',
  relationship_status: 'worked_with',
  listing_status: 'active',
  address: 'TEST FIXTURE - 100 Preview Lane, Lynbrook, NY 11563',
  city: 'Lynbrook',
  state: 'NY',
  zip: '11563',
  price: 749000,
  beds: 4,
  baths: 2,
  sqft: 1850,
  agent_name: 'Ruth Chalco',
  brokerage: 'Local Test Brokerage',
  agent_phone: '(516) 555-0142',
  agent_email: 'ruth.preview@example.test',
  match_score: 100,
  open_start: '2026-08-01T16:00:00.000Z',
  open_end: '2026-08-01T18:00:00.000Z',
  updated_at: '2026-07-29T22:00:00.000Z'
};

function sendJson(response, status, payload) {
  response.writeHead(status, {
    'Cache-Control': 'no-store',
    'Content-Type': 'application/json; charset=utf-8'
  });
  response.end(JSON.stringify(payload));
}

function listPayload(requestUrl) {
  const filtersRaw = requestUrl.searchParams.get('filters') || '{}';
  let filters = {};
  try {
    filters = JSON.parse(filtersRaw);
  } catch (_) {
    filters = {};
  }
  const query = String(filters.q || '').trim().toLowerCase();
  const visible = !query || ['ruth', 'chalco', 'ruth chalco', 'local test brokerage', 'lynbrook']
    .some((value) => value.includes(query) || query.includes(value));
  const rankings = visible ? [ranking] : [];
  return {
    ok: true,
    rankings,
    uploads: [],
    total: rankings.length,
    page: 1,
    page_size: 50,
    sort_by: 'agent_rank_score',
    sort_direction: 'desc',
    summary: {
      total_agents_analyzed: 1,
      total_active_listings: 3,
      total_listings_active_last_12_months: 13,
      total_buyside_last_90_days: 2,
      total_buyside_last_12_months: 8,
      matched_open_house_total: 1,
      location_review_needed: 0
    },
    options: {
      tiers: ['A'],
      brokerages: ['Local Test Brokerage'],
      markets: ['Long Island'],
      counties: ['Nassau'],
      cities: ['Lynbrook'],
      states: ['NY'],
      location_sources: ['test_fixture']
    },
    data_quality: {
      is_fixture: true,
      note: 'Local read-only fixture. No production data is connected.'
    }
  };
}

function profilePayload() {
  return {
    ok: true,
    ranking,
    profile_photo_url: '',
    profile_url: '',
    area_comparison: null,
    current_listings: [listing],
    open_houses: [listing],
    listing_inventory_available: true,
    listing_inventory_outreach_enabled: false,
    listing_agents: [],
    summary: {
      matched_open_house_count: 1,
      matched_listing_agent_count: 0,
      imported_active_listing_count: 3,
      database_current_listing_count: 1,
      database_upcoming_open_house_count: 1,
      matched_active_listing_count: 1,
      weekend_open_house_count: 1
    }
  };
}

function readBody(request) {
  return new Promise((resolve, reject) => {
    let body = '';
    request.setEncoding('utf8');
    request.on('data', (chunk) => {
      body += chunk;
      if (body.length > 1_000_000) request.destroy();
    });
    request.on('end', () => resolve(body));
    request.on('error', reject);
  });
}

const server = http.createServer(async (request, response) => {
  const requestUrl = new URL(request.url || '/', `http://${HOST}:${PORT}`);

  if (requestUrl.pathname === '/api/admin/auth') {
    sendJson(response, 200, { ok: true, method: 'local_fixture' });
    return;
  }

  if (requestUrl.pathname === '/api/admin/agent-ranking' && request.method === 'GET') {
    sendJson(response, 200, listPayload(requestUrl));
    return;
  }

  if (requestUrl.pathname === '/api/admin/agent-ranking' && request.method === 'POST') {
    const raw = await readBody(request);
    let body = {};
    try {
      body = raw ? JSON.parse(raw) : {};
    } catch (_) {
      body = {};
    }
    if (body.action === 'profile_details' && body.ranking_id === RANKING_ID) {
      sendJson(response, 200, profilePayload());
      return;
    }
    sendJson(response, 403, {
      ok: false,
      error: 'This local test fixture is read-only. No outreach or database action was performed.'
    });
    return;
  }

  if (
    requestUrl.pathname === '/'
    || requestUrl.pathname === '/admin/agent-ranking'
    || requestUrl.pathname === '/apps/rel8tion-app/agent-ranking'
    || requestUrl.pathname === '/apps/rel8tion-app/agent-ranking.html'
  ) {
    const banner = `
      <div style="position:sticky;top:0;z-index:99999;padding:10px 16px;background:#7c2d12;color:#fff;text-align:center;font:800 14px/1.3 system-ui;">
        LOCAL READ-ONLY TEST FIXTURE - no production database or live deployment is connected
      </div>`;
    const html = fs.readFileSync(PAGE_PATH, 'utf8').replace('<body>', `<body>${banner}`);
    response.writeHead(200, {
      'Cache-Control': 'no-store',
      'Content-Type': 'text/html; charset=utf-8'
    });
    response.end(html);
    return;
  }

  response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
  response.end('Not found');
});

server.listen(PORT, HOST, () => {
  process.stdout.write(`Agent Rankings local fixture: http://${HOST}:${PORT}/admin/agent-ranking\n`);
});

