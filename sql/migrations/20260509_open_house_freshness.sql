-- Open house source freshness and price-change auditing.
-- This migration is intentionally additive. It does not rewrite existing rows.

alter table public.open_houses
  add column if not exists last_verified_at timestamptz,
  add column if not exists last_verified_source text,
  add column if not exists source_price numeric,
  add column if not exists source_price_verified_at timestamptz,
  add column if not exists price_last_changed_at timestamptz,
  add column if not exists manual_price_override numeric,
  add column if not exists manual_price_override_at timestamptz,
  add column if not exists manual_price_override_by text,
  add column if not exists freshness_status text,
  add column if not exists freshness_notes jsonb not null default '{}'::jsonb;

create table if not exists public.open_house_price_history (
  id uuid primary key default gen_random_uuid(),
  open_house_id text not null references public.open_houses(id) on delete cascade,
  old_price numeric,
  new_price numeric,
  source_price numeric,
  displayed_price numeric,
  source text not null default 'onekey',
  change_reason text not null,
  source_snapshot jsonb not null default '{}'::jsonb,
  detected_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists open_house_price_history_open_house_detected_idx
  on public.open_house_price_history(open_house_id, detected_at desc);

create index if not exists open_house_price_history_source_idx
  on public.open_house_price_history(source, detected_at desc);

create index if not exists open_houses_freshness_idx
  on public.open_houses(source, open_start, last_verified_at);

alter table public.open_house_price_history enable row level security;

comment on column public.open_houses.source_price is
  'Latest price observed from the upstream listing source. Display price may differ when manual_price_override is active.';

comment on column public.open_houses.manual_price_override is
  'Manual display price override. Freshness workers should not overwrite open_houses.price from source while this value is set.';

comment on table public.open_house_price_history is
  'Append-only audit of listing price changes detected during source freshness checks.';
