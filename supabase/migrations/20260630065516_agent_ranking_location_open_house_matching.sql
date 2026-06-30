alter table public.agent_production_import_rows
  add column if not exists primary_county text,
  add column if not exists zip text,
  add column if not exists inferred_county text,
  add column if not exists location_confidence int default 0,
  add column if not exists location_source text;

alter table public.agent_rankings
  add column if not exists county text,
  add column if not exists primary_county text,
  add column if not exists city text,
  add column if not exists state text,
  add column if not exists zip text,
  add column if not exists inferred_county text,
  add column if not exists location_confidence int default 0,
  add column if not exists location_source text,
  add column if not exists matched_open_house_count int default 0,
  add column if not exists matched_weekend_open_house_count int default 0,
  add column if not exists matched_active_listing_count int default 0,
  add column if not exists matched_open_house_ids text[] default '{}'::text[],
  add column if not exists last_matched_open_house_at timestamptz,
  add column if not exists created_at timestamptz default now();

create index if not exists agent_production_import_rows_location_idx
  on public.agent_production_import_rows(primary_county, market_area, city, state, zip);

create index if not exists agent_rankings_location_idx
  on public.agent_rankings(primary_county, market_area, city, state, zip);

create index if not exists agent_rankings_oh_match_idx
  on public.agent_rankings(
    matched_weekend_open_house_count desc,
    matched_open_house_count desc,
    opportunity_gap_score desc
  );

create index if not exists agent_rankings_location_source_idx
  on public.agent_rankings(location_source, location_confidence desc);

comment on column public.agent_production_import_rows.primary_county is
  'Normalized county used for targeting and filtering.';

comment on column public.agent_production_import_rows.inferred_county is
  'County inferred from city, zip, market, address, or open-house data.';

comment on column public.agent_production_import_rows.location_confidence is
  'Location confidence: 100 imported/manual, 85 zip inferred, 75 city inferred, 70 upload default, 80 open-house match, 0 missing.';

comment on column public.agent_production_import_rows.location_source is
  'Location source: imported_county, zip_city_inferred, upload_default, open_house_match, manual_admin, or missing.';

comment on column public.agent_rankings.primary_county is
  'Normalized county used for targeting and filtering.';

comment on column public.agent_rankings.matched_open_house_ids is
  'Rel8tion open_houses ids matched to this ranking by phone, email, name/brokerage, or location.';
