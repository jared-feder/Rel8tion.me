const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const migration = fs.readFileSync(
  path.join(
    __dirname,
    '..',
    'supabase',
    'migrations',
    '20260818185810_lock_backend_only_security_surfaces.sql'
  ),
  'utf8'
);

const publicCatalogMigration = fs.readFileSync(
  path.join(
    __dirname,
    '..',
    'supabase',
    'migrations',
    '20260818190418_lock_public_catalog_writes.sql'
  ),
  'utf8'
);

const scanEventMigration = fs.readFileSync(
  path.join(
    __dirname,
    '..',
    'supabase',
    'migrations',
    '20260818190921_lock_scan_events.sql'
  ),
  'utf8'
);

const backendOnlyTables = [
  'open_houses_backup',
  'open_houses_onekey_time_backup_20260509',
  'open_house_agents',
  'open_house_dates',
  'open_house_photos',
  'buyer_agent_links',
  'onekey_members',
  'onekey_member_active_listings',
  'agent_outreach_log'
];

test('phase one enables and forces RLS only on reviewed backend-only tables', () => {
  for (const table of backendOnlyTables) {
    assert.match(
      migration,
      new RegExp(`alter table public\\.${table} enable row level security`, 'i')
    );
    assert.match(
      migration,
      new RegExp(`alter table public\\.${table} force row level security`, 'i')
    );
  }

  for (const deferredTable of [
    'open_houses',
    'listing_agents',
    'agent_outreach_queue',
    'agent_outreach_replies',
    'smart_sign_inventory',
    'smart_sign_scan_events',
    'event_loan_officer_sessions',
    'brokerages',
    'spatial_ref_sys'
  ]) {
    assert.doesNotMatch(
      migration,
      new RegExp(`alter table public\\.${deferredTable} (?:enable|force) row level security`, 'i')
    );
  }
});

test('browser table privileges are revoked while service-role CRUD is retained', () => {
  assert.match(
    migration,
    /revoke all privileges on table[\s\S]*from public, anon, authenticated;/i
  );
  assert.match(
    migration,
    /grant select, insert, update, delete on table[\s\S]*to service_role;/i
  );
});

test('operational views are security invoker and service-role only', () => {
  for (const view of [
    'agent_outreach_hot_list',
    'agent_outreach_inbox',
    'onekey_member_summary'
  ]) {
    assert.match(
      migration,
      new RegExp(`alter view public\\.${view} set \\(security_invoker = true\\)`, 'i')
    );
  }

  assert.match(
    migration,
    /grant select on table[\s\S]*agent_outreach_inbox[\s\S]*to service_role;/i
  );
});

test('outreach queue RPCs lose browser execution but retain protected worker access', () => {
  for (const signature of [
    'queue_recent_outreach_candidates\\(\\)',
    'queue_outreach_candidate\\(text\\)'
  ]) {
    assert.match(
      migration,
      new RegExp(`revoke execute on function public\\.${signature}[\\s\\S]*from public, anon, authenticated;`, 'i')
    );
    assert.match(
      migration,
      new RegExp(`grant execute on function public\\.${signature}[\\s\\S]*to service_role;`, 'i')
    );
  }

  assert.match(migration, /set search_path = pg_catalog, public;/i);
});

test('phase two keeps required catalogs publicly readable but removes browser writes', () => {
  for (const table of ['brokerages', 'open_houses', 'listing_agents']) {
    assert.match(
      publicCatalogMigration,
      new RegExp(`alter table public\\.${table} enable row level security`, 'i')
    );
    assert.match(
      publicCatalogMigration,
      new RegExp(`alter table public\\.${table} force row level security`, 'i')
    );
    assert.match(
      publicCatalogMigration,
      new RegExp(`create policy ${table}_public_read[\\s\\S]*on public\\.${table}[\\s\\S]*for select[\\s\\S]*to anon, authenticated[\\s\\S]*using \\(true\\);`, 'i')
    );
  }

  assert.match(
    publicCatalogMigration,
    /revoke all privileges on table[\s\S]*from public, anon, authenticated;/i
  );
  assert.match(
    publicCatalogMigration,
    /grant select on table[\s\S]*to anon, authenticated;/i
  );
  assert.doesNotMatch(
    publicCatalogMigration,
    /grant (?:insert|update|delete|all)[\s\S]*to (?:anon|authenticated)/i
  );
  assert.doesNotMatch(publicCatalogMigration, /spatial_ref_sys/i);
});

test('phase three makes legacy scan-event metadata service-role only', () => {
  assert.match(
    scanEventMigration,
    /alter table public\.smart_sign_scan_events enable row level security;/i
  );
  assert.match(
    scanEventMigration,
    /alter table public\.smart_sign_scan_events force row level security;/i
  );
  assert.match(
    scanEventMigration,
    /revoke all privileges on table public\.smart_sign_scan_events\s+from public, anon, authenticated;/i
  );
  assert.match(
    scanEventMigration,
    /grant select, insert, update, delete on table public\.smart_sign_scan_events\s+to service_role;/i
  );

  for (const currentRoute of [
    'apps/rel8tion-app/k.html',
    'apps/rel8tion-app/sign-demo-activate.html'
  ]) {
    const source = fs.readFileSync(path.join(__dirname, '..', currentRoute), 'utf8');
    assert.doesNotMatch(source, /smart_sign_scan_events|src\/api\/scanEvents\.js/i);
  }
});
