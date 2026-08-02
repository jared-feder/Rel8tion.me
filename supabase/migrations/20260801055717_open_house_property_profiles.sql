create table if not exists public.open_house_property_profiles (
  id uuid primary key default gen_random_uuid(),
  open_house_id text not null unique,
  source text,
  source_listing_id text,
  address text,
  city text,
  state text,
  zip text,
  latitude double precision,
  longitude double precision,
  price numeric,
  beds numeric,
  baths numeric,
  sqft numeric,
  lot_size_sqft numeric,
  year_built integer,
  annual_property_taxes numeric,
  hoa_monthly numeric,
  price_per_sqft numeric,
  property_type text,
  listing_status text,
  description text,
  features jsonb not null default '[]'::jsonb,
  images jsonb not null default '[]'::jsonb,
  primary_image text,
  listing_url text,
  brokerage text,
  agent_name text,
  agent_phone text,
  agent_email text,
  open_start timestamptz,
  open_end timestamptz,
  source_payload jsonb not null default '{}'::jsonb,
  source_checked_at timestamptz,
  images_checked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists open_house_property_profiles_source_listing_idx
  on public.open_house_property_profiles (source_listing_id);

create index if not exists open_house_property_profiles_updated_idx
  on public.open_house_property_profiles (updated_at desc);

alter table public.open_house_property_profiles enable row level security;

revoke all on table public.open_house_property_profiles from anon, authenticated;
grant all on table public.open_house_property_profiles to service_role;

comment on table public.open_house_property_profiles is
  'Server-managed durable buyer property profiles for REL8TION open-house experiences.';

comment on column public.open_house_property_profiles.source_payload is
  'Private upstream listing snapshot. This column must not be exposed directly to buyers.';
