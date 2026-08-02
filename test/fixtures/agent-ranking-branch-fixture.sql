-- Preview-branch-only fixture for the Agent Rankings inventory UI.
-- Do not add this file to supabase/migrations or apply it to production.

create table if not exists public.agent_production_uploads (
  id uuid primary key,
  source_name text not null,
  market_area text,
  period_start date,
  period_end date,
  original_filename text,
  notes text,
  row_count integer not null default 0,
  raw_metadata jsonb not null default '{}'::jsonb,
  uploaded_by uuid,
  created_at timestamptz not null default now()
);

alter table public.agent_production_uploads enable row level security;
revoke all on table public.agent_production_uploads from anon, authenticated;
grant select, insert, update, delete on table public.agent_production_uploads to service_role;

create table if not exists public.agent_rankings (
  id uuid primary key,
  identity_key text not null,
  agent_id text,
  agent_name text not null,
  first_name text,
  last_name text,
  brokerage text,
  phone text,
  phone_normalized text,
  email text,
  production_volume numeric not null default 0,
  transaction_count integer not null default 0,
  active_listing_count integer not null default 0,
  sold_listing_count integer not null default 0,
  listings_days_since_last integer not null default 0,
  listings_active_last_12_months integer not null default 0,
  buyside_last_90_days integer not null default 0,
  buyside_last_12_months integer not null default 0,
  average_price numeric not null default 0,
  market_area text,
  county text,
  primary_county text,
  city text,
  state text,
  zip text,
  inferred_county text,
  location_confidence numeric not null default 0,
  location_source text,
  open_house_count integer not null default 0,
  matched_open_house_count integer not null default 0,
  matched_weekend_open_house_count integer not null default 0,
  matched_active_listing_count integer not null default 0,
  matched_open_house_ids jsonb not null default '[]'::jsonb,
  last_matched_open_house_at timestamptz,
  has_open_house_this_weekend boolean not null default false,
  opportunity_gap_score numeric not null default 0,
  recommended_tier text,
  agent_rank_score numeric not null default 0,
  recommended_pitch text,
  gap_summary text,
  next_best_action text,
  rel8tion_value_summary text,
  raw_sources jsonb not null default '{}'::jsonb,
  is_not_fit boolean not null default false,
  last_activity_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists agent_rankings_fixture_identity_idx
  on public.agent_rankings(identity_key);

create index if not exists agent_rankings_fixture_location_idx
  on public.agent_rankings(primary_county, market_area);

alter table public.agent_rankings enable row level security;
revoke all on table public.agent_rankings from anon, authenticated;
grant select, insert, update, delete on table public.agent_rankings to service_role;

insert into public.agent_production_uploads (
  id,
  source_name,
  market_area,
  period_start,
  period_end,
  original_filename,
  notes,
  row_count,
  raw_metadata
) values (
  '33333333-3333-4333-8333-333333333333',
  'ListReports',
  'Long Island',
  current_date - 30,
  current_date,
  'branch-test-fixture.csv',
  'Preview branch fixture only. Contains no production contact data.',
  1,
  '{
    "mapping": {
      "agent_name": {"source": "Agent Name"},
      "brokerage": {"source": "Brokerage"},
      "phone": {"source": "Phone"},
      "active_listing_count": {"source": "Active Listings"},
      "listings_days_since_last": {"source": "Days Since Last"},
      "listings_active_last_12_months": {"source": "Listing Side 12m"},
      "buyside_last_90_days": {"source": "Buyside 90d"},
      "buyside_last_12_months": {"source": "Buyside 12m"}
    }
  }'::jsonb
)
on conflict (id) do update set
  source_name = excluded.source_name,
  raw_metadata = excluded.raw_metadata,
  notes = excluded.notes;

insert into public.agent_rankings (
  id,
  identity_key,
  agent_name,
  first_name,
  last_name,
  brokerage,
  phone,
  phone_normalized,
  email,
  active_listing_count,
  listings_days_since_last,
  listings_active_last_12_months,
  buyside_last_90_days,
  buyside_last_12_months,
  market_area,
  county,
  primary_county,
  city,
  state,
  zip,
  location_confidence,
  location_source,
  open_house_count,
  matched_open_house_count,
  matched_weekend_open_house_count,
  matched_active_listing_count,
  has_open_house_this_weekend,
  opportunity_gap_score,
  recommended_tier,
  agent_rank_score,
  gap_summary,
  next_best_action,
  rel8tion_value_summary,
  raw_sources,
  last_activity_at
) values (
  '11111111-1111-4111-8111-111111111111',
  'import:ruth chalco|local test brokerage|5165550142|nassau',
  'Ruth Chalco',
  'Ruth',
  'Chalco',
  'Local Test Brokerage',
  '(516) 555-0142',
  '5165550142',
  'ruth.preview@example.test',
  3,
  9,
  13,
  2,
  8,
  'Long Island',
  'Nassau',
  'Nassau',
  'Lynbrook',
  'NY',
  '11563',
  100,
  'preview_branch_fixture',
  1,
  0,
  0,
  0,
  false,
  76,
  'A',
  88,
  'ListReports reports three active listings, while the protected REL8TION inventory contains one matching current listing.',
  'Review the current listing and its upcoming open house before preparing manual marketing.',
  'REL8TION can prepare listing-specific open-house marketing without requiring a full enrichment pass first.',
  '{
    "upload_id": "33333333-3333-4333-8333-333333333333",
    "source_upload_id": "33333333-3333-4333-8333-333333333333",
    "labels": ["PREVIEW BRANCH FIXTURE", "Worked with"]
  }'::jsonb,
  now()
)
on conflict (id) do update set
  active_listing_count = excluded.active_listing_count,
  raw_sources = excluded.raw_sources,
  updated_at = now();

insert into public.agent_listing_inventory (
  relationship_key,
  relationship_source,
  relationship_status,
  source,
  source_listing_id,
  agent_name,
  agent_name_normalized,
  brokerage,
  phone,
  phone_normalized,
  email,
  listing_status,
  address,
  city,
  state,
  zip,
  price,
  beds,
  baths,
  sqft,
  property_type,
  open_start,
  open_end,
  is_current,
  first_seen_at,
  last_seen_at,
  source_checked_at,
  source_payload
) values (
  'phone:5165550142',
  'agent',
  'worked_with',
  'onekey_preview_fixture',
  'FIXTURE-RUTH-001',
  'Ruth Chalco',
  'ruth chalco',
  'Local Test Brokerage',
  '(516) 555-0142',
  '5165550142',
  'ruth.preview@example.test',
  'active',
  'PREVIEW FIXTURE - 100 Preview Lane, Lynbrook, NY 11563',
  'Lynbrook',
  'NY',
  '11563',
  749000,
  4,
  2,
  1850,
  'Single Family Residence',
  now() + interval '3 days',
  now() + interval '3 days 2 hours',
  true,
  now(),
  now(),
  now(),
  '{"match_score": 100, "match_reason": "preview_branch_fixture"}'::jsonb
)
on conflict (relationship_key, source, source_listing_id) do update set
  listing_status = excluded.listing_status,
  address = excluded.address,
  open_start = excluded.open_start,
  open_end = excluded.open_end,
  is_current = true,
  last_seen_at = now(),
  source_checked_at = now(),
  updated_at = now();

