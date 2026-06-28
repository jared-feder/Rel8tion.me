create table if not exists public.agent_production_uploads (
  id uuid primary key default gen_random_uuid(),
  source_name text,
  market_area text,
  period_start date,
  period_end date,
  original_filename text,
  row_count int,
  uploaded_by uuid null,
  notes text,
  raw_metadata jsonb default '{}'::jsonb,
  created_at timestamptz default now()
);

create table if not exists public.agent_production_import_rows (
  id uuid primary key default gen_random_uuid(),
  upload_id uuid references public.agent_production_uploads(id) on delete cascade,
  matched_agent_id uuid null references public.agents(id),
  agent_name text,
  first_name text,
  last_name text,
  brokerage text,
  phone text,
  phone_normalized text,
  email text,
  market_area text,
  city text,
  county text,
  state text,
  production_volume numeric default 0,
  transaction_count int default 0,
  active_listing_count int default 0,
  sold_listing_count int default 0,
  average_price numeric default 0,
  raw jsonb default '{}'::jsonb,
  match_confidence int default 0,
  created_at timestamptz default now()
);

create table if not exists public.agent_rankings (
  id uuid primary key default gen_random_uuid(),
  agent_id uuid null references public.agents(id),
  latest_import_row_id uuid null references public.agent_production_import_rows(id),
  agent_name text,
  brokerage text,
  phone text,
  phone_normalized text,
  email text,
  market_area text,
  production_volume numeric default 0,
  transaction_count int default 0,
  active_listing_count int default 0,
  sold_listing_count int default 0,
  average_price numeric default 0,
  open_house_count int default 0,
  rel8tion_lead_capture_score int default 0,
  opportunity_gap_score int default 0,
  agent_rank_score int default 0,
  recommended_tier text,
  recommended_pitch text,
  next_best_action text,
  gap_summary text,
  rel8tion_value_summary text,
  has_open_house_this_weekend boolean default false,
  has_phone boolean default false,
  has_email boolean default false,
  last_activity_at timestamptz,
  raw_sources jsonb default '{}'::jsonb,
  updated_at timestamptz default now()
);

alter table public.agent_production_uploads enable row level security;
alter table public.agent_production_import_rows enable row level security;
alter table public.agent_rankings enable row level security;

drop policy if exists "agent_production_uploads_service_role_all" on public.agent_production_uploads;
create policy "agent_production_uploads_service_role_all"
  on public.agent_production_uploads
  for all
  using ((select auth.role()) = 'service_role')
  with check ((select auth.role()) = 'service_role');

drop policy if exists "agent_production_import_rows_service_role_all" on public.agent_production_import_rows;
create policy "agent_production_import_rows_service_role_all"
  on public.agent_production_import_rows
  for all
  using ((select auth.role()) = 'service_role')
  with check ((select auth.role()) = 'service_role');

drop policy if exists "agent_rankings_service_role_all" on public.agent_rankings;
create policy "agent_rankings_service_role_all"
  on public.agent_rankings
  for all
  using ((select auth.role()) = 'service_role')
  with check ((select auth.role()) = 'service_role');

create index if not exists agent_production_uploads_created_idx
  on public.agent_production_uploads(created_at desc);

create index if not exists agent_production_uploads_period_idx
  on public.agent_production_uploads(period_start, period_end);

create index if not exists agent_production_import_rows_upload_idx
  on public.agent_production_import_rows(upload_id);

create index if not exists agent_production_import_rows_agent_idx
  on public.agent_production_import_rows(matched_agent_id)
  where matched_agent_id is not null;

create index if not exists agent_production_import_rows_phone_idx
  on public.agent_production_import_rows(phone_normalized)
  where phone_normalized is not null and phone_normalized <> '';

create index if not exists agent_production_import_rows_email_idx
  on public.agent_production_import_rows(lower(email))
  where email is not null and email <> '';

create index if not exists agent_rankings_agent_idx
  on public.agent_rankings(agent_id)
  where agent_id is not null;

create index if not exists agent_rankings_phone_idx
  on public.agent_rankings(phone_normalized)
  where phone_normalized is not null and phone_normalized <> '';

create index if not exists agent_rankings_tier_score_idx
  on public.agent_rankings(recommended_tier, agent_rank_score desc);

create index if not exists agent_rankings_market_idx
  on public.agent_rankings(market_area);

create unique index if not exists agent_rankings_identity_uidx
  on public.agent_rankings(coalesce(agent_id::text, phone_normalized, lower(email), lower(agent_name) || '|' || lower(coalesce(brokerage, ''))))
  where coalesce(agent_id::text, phone_normalized, lower(email), lower(agent_name) || '|' || lower(coalesce(brokerage, ''))) is not null;

create or replace function public.set_agent_rankings_updated_at()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_agent_rankings_updated_at on public.agent_rankings;
create trigger set_agent_rankings_updated_at
before update on public.agent_rankings
for each row
execute function public.set_agent_rankings_updated_at();

comment on table public.agent_production_uploads is
  'Admin-only metadata for permitted manual agent production report uploads.';

comment on table public.agent_production_import_rows is
  'Admin-only normalized production rows parsed from uploaded reports before/after matching to REL8TION agents.';

comment on table public.agent_rankings is
  'Admin-only production intelligence rankings that score agent opportunity for REL8TION open-house capture.';
