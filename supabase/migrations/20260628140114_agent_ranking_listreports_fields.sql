alter table public.agent_production_import_rows
  add column if not exists listings_days_since_last int default 0,
  add column if not exists listings_active_last_12_months int default 0,
  add column if not exists buyside_last_90_days int default 0,
  add column if not exists buyside_last_12_months int default 0;

alter table public.agent_rankings
  add column if not exists listings_days_since_last int default 0,
  add column if not exists listings_active_last_12_months int default 0,
  add column if not exists buyside_last_90_days int default 0,
  add column if not exists buyside_last_12_months int default 0;

create index if not exists agent_rankings_listreports_activity_idx
  on public.agent_rankings(
    active_listing_count desc,
    listings_active_last_12_months desc,
    buyside_last_12_months desc,
    listings_days_since_last asc
  );

create index if not exists agent_production_import_rows_listreports_activity_idx
  on public.agent_production_import_rows(
    upload_id,
    active_listing_count desc,
    listings_active_last_12_months desc,
    buyside_last_12_months desc
  );

comment on column public.agent_production_import_rows.listings_days_since_last is
  'ListReports days since this agent last had listing activity.';

comment on column public.agent_production_import_rows.listings_active_last_12_months is
  'ListReports listing-side activity count for the last 12 months.';

comment on column public.agent_production_import_rows.buyside_last_90_days is
  'ListReports buyside activity count for the last 90 days.';

comment on column public.agent_production_import_rows.buyside_last_12_months is
  'ListReports buyside activity count for the last 12 months.';

comment on column public.agent_rankings.listings_days_since_last is
  'Current ranking copy of ListReports days since last listing activity.';

comment on column public.agent_rankings.listings_active_last_12_months is
  'Current ranking copy of ListReports listing-side activity count for the last 12 months.';

comment on column public.agent_rankings.buyside_last_90_days is
  'Current ranking copy of ListReports buyside activity count for the last 90 days.';

comment on column public.agent_rankings.buyside_last_12_months is
  'Current ranking copy of ListReports buyside activity count for the last 12 months.';
