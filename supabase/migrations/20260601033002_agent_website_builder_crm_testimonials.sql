alter table public.agent_websites
  add column if not exists testimonials_json jsonb not null default '[]'::jsonb;

comment on column public.agent_websites.testimonials_json is
  'Ordered public testimonials for generated agent websites.';

create table if not exists public.contact_submissions (
  id uuid primary key default gen_random_uuid(),
  agent_website_id uuid references public.agent_websites(id) on delete set null,
  agent_name text,
  agent_email text,
  agent_phone text,
  site_slug text,
  source_url text,
  name text not null,
  email text not null,
  phone text,
  message text not null,
  preferred_contact text not null default 'email'
    check (preferred_contact in ('email', 'phone')),
  status text not null default 'new'
    check (status in ('new', 'contacted', 'archived')),
  email_sent boolean not null default false,
  email_error text,
  crm_synced boolean not null default false,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.contact_submissions enable row level security;

drop policy if exists "contact_submissions_service_role_all" on public.contact_submissions;
create policy "contact_submissions_service_role_all"
  on public.contact_submissions
  for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

create index if not exists idx_contact_submissions_agent_website_id
  on public.contact_submissions(agent_website_id);

create index if not exists idx_contact_submissions_created_at
  on public.contact_submissions(created_at desc);

create index if not exists idx_contact_submissions_status
  on public.contact_submissions(status);

create table if not exists public.agent_website_ai_media (
  id uuid primary key default gen_random_uuid(),
  agent_website_id uuid references public.agent_websites(id) on delete set null,
  media_type text not null
    check (media_type in ('staging_image', 'social_video')),
  status text not null default 'created'
    check (status in ('created', 'queued', 'in_progress', 'completed', 'failed')),
  source_url text,
  result_url text,
  thumbnail_url text,
  openai_id text,
  prompt text not null,
  caption text,
  metadata jsonb not null default '{}'::jsonb,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.agent_website_ai_media enable row level security;

drop policy if exists "agent_website_ai_media_service_role_all" on public.agent_website_ai_media;
create policy "agent_website_ai_media_service_role_all"
  on public.agent_website_ai_media
  for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

create index if not exists idx_agent_website_ai_media_agent_website_id
  on public.agent_website_ai_media(agent_website_id);

create index if not exists idx_agent_website_ai_media_created_at
  on public.agent_website_ai_media(created_at desc);

create index if not exists idx_agent_website_ai_media_openai_id
  on public.agent_website_ai_media(openai_id);
