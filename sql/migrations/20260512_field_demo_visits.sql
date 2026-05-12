create table if not exists public.field_demo_visits (
  id uuid primary key default gen_random_uuid(),
  open_house_id text,
  open_house_event_id uuid references public.open_house_events(id) on delete set null,
  outreach_queue_id uuid references public.agent_outreach_queue(id) on delete set null,
  agent_slug text,
  agent_name text,
  agent_phone text,
  agent_email text,
  brokerage text,
  demo_sign_id uuid references public.smart_signs(id) on delete set null,
  demo_public_code text,
  scheduled_start timestamptz not null,
  scheduled_end timestamptz not null,
  status text not null default 'scheduled'
    check (status in ('scheduled', 'confirmed', 'en_route', 'on_site', 'live', 'completed', 'converted', 'cancelled')),
  coverage_mode text not null default 'physical_demo'
    check (coverage_mode in ('physical_demo', 'physical_support', 'remote_support')),
  demo_type text not null default 'agent_onboarding'
    check (demo_type in ('agent_onboarding', 'buyer_financing_support', 'brokerage_demo', 'follow_up_visit')),
  agent_onboarded boolean not null default false,
  agent_keychain_uid text,
  converted_to_virtual_support boolean not null default false,
  virtual_support_enabled_at timestamptz,
  source text not null default 'agent_outreach',
  notes text,
  created_at timestamptz not null default now(),
  confirmed_at timestamptz,
  arrived_at timestamptz,
  live_started_at timestamptz,
  completed_at timestamptz,
  converted_at timestamptz
);

create table if not exists public.field_demo_visit_participants (
  id uuid primary key default gen_random_uuid(),
  field_demo_visit_id uuid not null references public.field_demo_visits(id) on delete cascade,
  participant_profile_id uuid references public.verified_profiles(uid) on delete set null,
  participant_uid text,
  participant_name text,
  participant_phone text,
  participant_email text,
  participant_company text,
  role text not null
    check (role in ('loan_officer', 'field_sales_rep', 'demo_presenter', 'onboarding_specialist', 'dispatcher', 'admin')),
  responsibility text not null
    check (responsibility in ('financing_support', 'product_demo', 'agent_onboarding', 'sign_setup', 'follow_up_owner')),
  status text not null default 'assigned'
    check (status in ('assigned', 'confirmed', 'en_route', 'on_site', 'live', 'completed', 'cancelled')),
  is_primary boolean not null default false,
  created_at timestamptz not null default now(),
  confirmed_at timestamptz,
  arrived_at timestamptz,
  completed_at timestamptz
);

create index if not exists idx_field_demo_visits_scheduled_start
  on public.field_demo_visits(scheduled_start);

create index if not exists idx_field_demo_visits_open_house_event
  on public.field_demo_visits(open_house_event_id);

create index if not exists idx_field_demo_visits_agent_slug
  on public.field_demo_visits(agent_slug);

create index if not exists idx_field_demo_visits_status
  on public.field_demo_visits(status);

create index if not exists idx_field_demo_participants_visit
  on public.field_demo_visit_participants(field_demo_visit_id);

create index if not exists idx_field_demo_participants_uid
  on public.field_demo_visit_participants(participant_uid);

create index if not exists idx_field_demo_participants_profile
  on public.field_demo_visit_participants(participant_profile_id);

create index if not exists idx_field_demo_participants_role_status
  on public.field_demo_visit_participants(role, responsibility, status);

alter table public.field_demo_visits enable row level security;
alter table public.field_demo_visit_participants enable row level security;

drop policy if exists field_demo_visits_read_all on public.field_demo_visits;
create policy field_demo_visits_read_all
  on public.field_demo_visits
  for select
  to anon, authenticated
  using (true);

drop policy if exists field_demo_visit_participants_read_all on public.field_demo_visit_participants;
create policy field_demo_visit_participants_read_all
  on public.field_demo_visit_participants
  for select
  to anon, authenticated
  using (true);

grant select on public.field_demo_visits to anon, authenticated;
grant select on public.field_demo_visit_participants to anon, authenticated;

comment on table public.field_demo_visits is 'Scheduled REL8TION field/demo coverage visits connecting outreach, smart sign activation, NMB financing support, and agent onboarding.';
comment on table public.field_demo_visit_participants is 'Role-based people assigned to field demo visits. One visit can have multiple roles/responsibilities and one person can hold multiple responsibilities.';
