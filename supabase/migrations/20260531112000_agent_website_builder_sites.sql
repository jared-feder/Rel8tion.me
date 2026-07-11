create table if not exists public.agent_websites (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text unique not null,
  title text,
  brokerage text,
  email text,
  phone text,
  bio text,
  photo_url text,
  hero_image_url text,
  color_scheme text default 'warm-earth',
  font_pairing text default 'classic-elegant',
  custom_domain text unique,
  status text default 'published' check (status in ('published', 'pending_dns', 'draft')),
  facebook_url text,
  instagram_url text,
  linkedin_url text,
  views integer default 0,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table public.agent_websites enable row level security;

drop policy if exists "agent_websites_public_read_published" on public.agent_websites;
create policy "agent_websites_public_read_published"
  on public.agent_websites
  for select
  using (status in ('published', 'pending_dns'));

drop policy if exists "agent_websites_service_role_all" on public.agent_websites;
create policy "agent_websites_service_role_all"
  on public.agent_websites
  for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

create index if not exists idx_agent_websites_slug on public.agent_websites(slug);
create index if not exists idx_agent_websites_custom_domain on public.agent_websites(custom_domain);
create index if not exists idx_agent_websites_status on public.agent_websites(status);
