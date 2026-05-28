-- Sponsored Event Passes and Loan Officer Coverage Signs.
-- The current repo uses verified_profiles.uid in older LO coverage tables, while
-- newer product specs expect verified_profiles.id. These FK blocks prefer id and
-- fall back to uid so the migration stays compatible with the live contract.

alter table public.smart_sign_inventory
  add column if not exists sponsor_loan_officer_profile_id uuid,
  add column if not exists sponsor_loan_officer_uid text,
  add column if not exists assigned_agent_slug text,
  add column if not exists assigned_agent_phone text,
  add column if not exists pass_model text default 'single_event',
  add column if not exists sponsor_coverage_required boolean default false,
  add column if not exists sponsor_coverage_consent_required boolean default true,
  add column if not exists reuse_allowed boolean default false,
  add column if not exists reuse_status text default 'not_reusable',
  add column if not exists last_activated_at timestamptz,
  add column if not exists metadata jsonb default '{}'::jsonb;

alter table public.smart_sign_inventory
  alter column pass_model set default 'single_event',
  alter column sponsor_coverage_required set default false,
  alter column sponsor_coverage_consent_required set default true,
  alter column reuse_allowed set default false,
  alter column reuse_status set default 'not_reusable',
  alter column metadata set default '{}'::jsonb;

alter table public.event_loan_officer_sessions
  add column if not exists source text,
  add column if not exists metadata jsonb default '{}'::jsonb;

create table if not exists public.event_pass_coverage_consents (
  id uuid primary key default gen_random_uuid(),
  event_pass_inventory_id uuid null references public.smart_sign_inventory(id) on delete set null,
  open_house_event_id uuid null references public.open_house_events(id) on delete set null,
  sponsor_loan_officer_profile_id uuid null,
  sponsor_loan_officer_uid text null,
  agent_slug text null,
  agent_name text null,
  agent_phone text null,
  agent_email text null,
  brokerage text null,
  open_house_id text null,
  property_address text null,
  consent_text text not null,
  consent_version text default 'sponsored_event_pass_v1',
  consented_at timestamptz default now(),
  ip_address text null,
  user_agent text null,
  metadata jsonb default '{}'::jsonb,
  created_at timestamptz default now()
);

create table if not exists public.loan_officer_coverage_signs (
  id uuid primary key default gen_random_uuid(),
  public_code text unique not null,
  uid text unique null,
  loan_officer_profile_id uuid null,
  loan_officer_uid text null,
  status text default 'available',
  active_event_id uuid null references public.open_house_events(id) on delete set null,
  active_event_pass_inventory_id uuid null references public.smart_sign_inventory(id) on delete set null,
  active_smart_sign_id uuid null references public.smart_signs(id) on delete set null,
  last_open_house_id text null,
  last_agent_slug text null,
  last_used_at timestamptz null,
  metadata jsonb default '{}'::jsonb,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists public.loan_officer_sign_events (
  id uuid primary key default gen_random_uuid(),
  loan_officer_sign_id uuid null references public.loan_officer_coverage_signs(id) on delete set null,
  loan_officer_profile_id uuid null,
  open_house_event_id uuid null references public.open_house_events(id) on delete set null,
  event_pass_inventory_id uuid null references public.smart_sign_inventory(id) on delete set null,
  open_house_id text null,
  host_agent_slug text null,
  setup_method text null,
  status text default 'live',
  started_at timestamptz default now(),
  ended_at timestamptz null,
  metadata jsonb default '{}'::jsonb,
  created_at timestamptz default now()
);

do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'verified_profiles' and column_name = 'id'
  ) then
    alter table public.smart_sign_inventory
      add constraint smart_sign_inventory_sponsor_profile_id_fkey
      foreign key (sponsor_loan_officer_profile_id) references public.verified_profiles(id) on delete set null;
    alter table public.event_pass_coverage_consents
      add constraint event_pass_consents_sponsor_profile_id_fkey
      foreign key (sponsor_loan_officer_profile_id) references public.verified_profiles(id) on delete set null;
    alter table public.loan_officer_coverage_signs
      add constraint loan_officer_coverage_signs_profile_id_fkey
      foreign key (loan_officer_profile_id) references public.verified_profiles(id) on delete set null;
    alter table public.loan_officer_sign_events
      add constraint loan_officer_sign_events_profile_id_fkey
      foreign key (loan_officer_profile_id) references public.verified_profiles(id) on delete set null;
  elsif exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'verified_profiles' and column_name = 'uid'
  ) then
    alter table public.smart_sign_inventory
      add constraint smart_sign_inventory_sponsor_profile_id_fkey
      foreign key (sponsor_loan_officer_profile_id) references public.verified_profiles(uid) on delete set null;
    alter table public.event_pass_coverage_consents
      add constraint event_pass_consents_sponsor_profile_id_fkey
      foreign key (sponsor_loan_officer_profile_id) references public.verified_profiles(uid) on delete set null;
    alter table public.loan_officer_coverage_signs
      add constraint loan_officer_coverage_signs_profile_id_fkey
      foreign key (loan_officer_profile_id) references public.verified_profiles(uid) on delete set null;
    alter table public.loan_officer_sign_events
      add constraint loan_officer_sign_events_profile_id_fkey
      foreign key (loan_officer_profile_id) references public.verified_profiles(uid) on delete set null;
  end if;
exception
  when duplicate_object then null;
end $$;

create index if not exists idx_smart_sign_inventory_public_code
  on public.smart_sign_inventory(public_code);

create index if not exists idx_smart_sign_inventory_inventory_type
  on public.smart_sign_inventory(inventory_type);

create index if not exists idx_smart_sign_inventory_sponsor_lo_profile_id
  on public.smart_sign_inventory(sponsor_loan_officer_profile_id);

create index if not exists idx_smart_sign_inventory_assigned_agent_slug
  on public.smart_sign_inventory(assigned_agent_slug);

create index if not exists idx_event_pass_consents_open_house_event_id
  on public.event_pass_coverage_consents(open_house_event_id);

create index if not exists idx_event_pass_consents_inventory_id
  on public.event_pass_coverage_consents(event_pass_inventory_id);

create index if not exists idx_event_pass_consents_sponsor_profile_id
  on public.event_pass_coverage_consents(sponsor_loan_officer_profile_id);

create index if not exists idx_loan_officer_coverage_signs_public_code
  on public.loan_officer_coverage_signs(public_code);

create index if not exists idx_loan_officer_coverage_signs_uid
  on public.loan_officer_coverage_signs(uid);

create index if not exists idx_loan_officer_coverage_signs_profile_id
  on public.loan_officer_coverage_signs(loan_officer_profile_id);

create index if not exists idx_loan_officer_sign_events_open_house_event_id
  on public.loan_officer_sign_events(open_house_event_id);

create index if not exists idx_loan_officer_sign_events_profile_id
  on public.loan_officer_sign_events(loan_officer_profile_id);

comment on column public.smart_sign_inventory.pass_model is
  'single_event for existing passes; sponsored_agent_pass for reusable LO-sponsored passes.';

comment on table public.event_pass_coverage_consents is
  'Per-activation host agent consent for Sponsored Event Pass loan officer coverage and check-in visibility.';

comment on table public.loan_officer_coverage_signs is
  'Reusable loan-officer-owned coverage signs that route to the current live event when active.';

comment on table public.loan_officer_sign_events is
  'History of open-house coverage activations created through Loan Officer Coverage Signs.';
