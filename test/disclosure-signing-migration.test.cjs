const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const migrationPath = path.join(
  __dirname,
  '..',
  'supabase',
  'migrations',
  '20260817145636_disclosure_signing_audit.sql'
);

test('disclosure signing ledger is service-role-only and append-only', () => {
  const sql = fs.readFileSync(migrationPath, 'utf8');
  assert.match(sql, /create table if not exists public\.disclosure_signing_events/i);
  assert.match(sql, /enable row level security/i);
  assert.match(sql, /force row level security/i);
  assert.match(sql, /revoke all on public\.disclosure_signing_events from anon/i);
  assert.match(sql, /revoke all on public\.disclosure_signing_events from authenticated/i);
  assert.match(sql, /grant select, insert on public\.disclosure_signing_events to service_role/i);
  assert.match(sql, /before update or delete on public\.disclosure_signing_events/i);
  assert.match(sql, /raise exception 'disclosure_signing_events is append-only'/i);
  assert.match(sql, /disclosure_signing_event_set_hash/i);
  assert.match(sql, /digest\(/i);
});

test('packets are unique per check-in and packet version', () => {
  const sql = fs.readFileSync(migrationPath, 'utf8');
  assert.match(
    sql,
    /on public\.disclosure_signing_events \(checkin_id, packet_version\);/i
  );
  assert.match(sql, /storage_path text not null unique/i);
  assert.match(sql, /document_sha256 text not null/i);
});

test('packet uploader explicitly disables storage upsert', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'api', 'compliance', 'ny-disclosure.js'), 'utf8');
  assert.match(source, /'x-upsert': 'false'/);
  assert.doesNotMatch(source, /'x-upsert': 'true'/);
});

test('buyer UI and server audit use the same versioned consent wording', () => {
  const browserSource = fs.readFileSync(
    path.join(__dirname, '..', 'apps', 'rel8tion-app', 'src', 'modules', 'eventShell', 'bootstrap.js'),
    'utf8'
  );
  const disclosure = require('../api/compliance/ny-disclosure.js').__test;
  assert.ok(browserSource.includes(disclosure.DISCLOSURE_CONSENT_TEXT));
  assert.ok(browserSource.includes(disclosure.DISCLOSURE_CONSENT_VERSION));
});
