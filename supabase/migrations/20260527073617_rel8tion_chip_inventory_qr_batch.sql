create table if not exists public.rel8tion_chip_inventory (
  id uuid primary key default gen_random_uuid(),
  chip_code text not null unique,
  chip_type text not null default 'agent',
  company_slug text,
  uid text,
  agent_slug text,
  verified_profile_uid uuid references public.verified_profiles(uid) on delete set null,
  qr_url text not null,
  status text not null default 'unassigned',
  is_printed boolean not null default false,
  claimed_at timestamptz,
  linked_at timestamptz,
  last_scanned_at timestamptz,
  notes text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint rel8tion_chip_inventory_type_chk
    check (chip_type in ('agent', 'nmb', 'verified', 'professional', 'generic')),
  constraint rel8tion_chip_inventory_status_chk
    check (status in ('unassigned', 'linked', 'disabled', 'retired'))
);

create unique index if not exists rel8tion_chip_inventory_uid_uidx
  on public.rel8tion_chip_inventory(uid)
  where uid is not null;

create index if not exists rel8tion_chip_inventory_agent_slug_idx
  on public.rel8tion_chip_inventory(agent_slug)
  where agent_slug is not null;

create index if not exists rel8tion_chip_inventory_company_slug_idx
  on public.rel8tion_chip_inventory(company_slug)
  where company_slug is not null;

create index if not exists rel8tion_chip_inventory_type_status_idx
  on public.rel8tion_chip_inventory(chip_type, status, created_at desc);

alter table public.rel8tion_chip_inventory enable row level security;

grant select, insert, update, delete on public.rel8tion_chip_inventory to service_role;

create or replace function public.set_rel8tion_chip_inventory_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_rel8tion_chip_inventory_updated_at on public.rel8tion_chip_inventory;
create trigger set_rel8tion_chip_inventory_updated_at
before update on public.rel8tion_chip_inventory
for each row
execute function public.set_rel8tion_chip_inventory_updated_at();

with needed as (
  select greatest(
    1000 - count(*) filter (
      where chip_type = 'agent'
        and metadata->>'batch' = 'agent-keychain-001'
    ),
    0
  )::int as remaining
  from public.rel8tion_chip_inventory
),
candidates as (
  select distinct
    ('ra' || lower(substr(md5(gen_random_uuid()::text || clock_timestamp()::text || gs::text), 1, 6))) as chip_code
  from generate_series(1, 2500) as gs
),
available as (
  select c.chip_code
  from candidates c
  where not exists (
    select 1
    from public.rel8tion_chip_inventory existing
    where existing.chip_code = c.chip_code
  )
  order by c.chip_code
  limit (select remaining from needed)
)
insert into public.rel8tion_chip_inventory (
  chip_code,
  chip_type,
  qr_url,
  status,
  is_printed,
  metadata
)
select
  chip_code,
  'agent',
  'https://irel8.me/c/' || chip_code,
  'unassigned',
  false,
  jsonb_build_object(
    'batch', 'agent-keychain-001',
    'created_for', 'agent_rel8tionchip_qr',
    'quantity_target', 1000
  )
from available
on conflict (chip_code) do nothing;
