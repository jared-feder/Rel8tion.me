create table if not exists public.agent_listing_inventory (
  id uuid primary key default gen_random_uuid(),
  relationship_key text not null,
  relationship_source text not null,
  relationship_status text not null,
  source text not null default 'onekey',
  source_listing_id text not null,
  agent_id text,
  queue_row_id uuid,
  agent_name text not null,
  agent_name_normalized text not null,
  brokerage text,
  phone text,
  phone_normalized text,
  email text,
  listing_status text not null,
  address text not null,
  city text,
  state text,
  zip text,
  price numeric,
  beds numeric,
  baths numeric,
  sqft numeric,
  property_type text,
  image_url text,
  listing_url text,
  open_start timestamptz,
  open_end timestamptz,
  lat double precision,
  lng double precision,
  is_current boolean not null default true,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  source_checked_at timestamptz not null default now(),
  inactive_at timestamptz,
  source_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint agent_listing_inventory_relationship_source_listing_key
    unique (relationship_key, source, source_listing_id)
);

create index if not exists agent_listing_inventory_agent_name_idx
  on public.agent_listing_inventory(agent_name_normalized, is_current, last_seen_at desc);

create index if not exists agent_listing_inventory_phone_idx
  on public.agent_listing_inventory(phone_normalized, is_current, last_seen_at desc)
  where phone_normalized is not null;

create index if not exists agent_listing_inventory_current_open_house_idx
  on public.agent_listing_inventory(is_current, open_start, open_end)
  where is_current = true;

alter table public.agent_listing_inventory enable row level security;

revoke all on table public.agent_listing_inventory from anon, authenticated;
grant select, insert, update, delete on table public.agent_listing_inventory to service_role;

comment on table public.agent_listing_inventory is
  'Service-only current listing inventory for ranked agents, claimed REL8TION agents, and agents with positive outreach/working-relationship signals.';

comment on column public.agent_listing_inventory.relationship_status is
  'Why REL8TION follows this agent, such as ranking_only, worked_with, interested, confirmed_open_house, or accepted_open_house.';

comment on column public.agent_listing_inventory.is_current is
  'True while the listing continues to appear in successful upstream active/pending scans; stale rows are retained for audit instead of deleted.';
