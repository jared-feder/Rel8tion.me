create table if not exists public.agent_website_listings (
  id uuid primary key default gen_random_uuid(),
  agent_website_id uuid not null references public.agent_websites(id) on delete cascade,
  source text not null default 'manual'
    check (source in ('manual', 'scraper', 'import', 'rel8tion')),
  source_listing_id text,
  mls_id text,
  title text,
  address text not null,
  city text,
  state text default 'NY',
  zip text,
  price numeric,
  beds numeric,
  baths numeric,
  sqft integer,
  lot_size numeric,
  year_built integer,
  property_type text,
  listing_status text not null default 'active'
    check (listing_status in ('active', 'pending', 'sold', 'off_market', 'draft')),
  description text,
  features text[] not null default '{}',
  images text[] not null default '{}',
  primary_image text,
  listing_url text,
  brokerage text,
  agent_name text,
  agent_phone text,
  agent_email text,
  open_house_start timestamptz,
  open_house_end timestamptz,
  lat double precision,
  lng double precision,
  sort_order integer not null default 0,
  is_featured boolean not null default true,
  disclaimer text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.agent_website_listings is
  'Listings that belong to a specific generated agent website. Use this table for agent-entered listings and scraper imports that are authorized for that agent/site.';

alter table public.agent_website_listings enable row level security;

drop policy if exists "agent_website_listings_service_role_all" on public.agent_website_listings;
create policy "agent_website_listings_service_role_all"
  on public.agent_website_listings
  for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

create index if not exists idx_agent_website_listings_agent_website_id
  on public.agent_website_listings(agent_website_id);

create index if not exists idx_agent_website_listings_status
  on public.agent_website_listings(listing_status);

create index if not exists idx_agent_website_listings_created_at
  on public.agent_website_listings(created_at desc);

create unique index if not exists idx_agent_website_listings_source_unique
  on public.agent_website_listings(agent_website_id, source, source_listing_id);
