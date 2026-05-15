create table if not exists public.field_coverage_availability (
  id uuid primary key default gen_random_uuid(),
  participant_profile_id uuid references public.verified_profiles(uid) on delete set null,
  participant_uid text,
  participant_slug text,
  participant_name text,
  participant_phone text,
  participant_email text,
  participant_company text,
  role text not null default 'loan_officer'
    check (role in ('loan_officer', 'field_sales_rep', 'demo_presenter', 'onboarding_specialist', 'dispatcher', 'admin')),
  responsibility text not null default 'financing_support'
    check (responsibility in ('financing_support', 'product_demo', 'agent_onboarding', 'sign_setup', 'follow_up_owner')),
  available_start timestamptz not null,
  available_end timestamptz not null,
  service_zip text not null,
  service_radius_miles integer not null default 15,
  base_lat numeric,
  base_lng numeric,
  status text not null default 'open'
    check (status in ('open', 'held', 'booked', 'unavailable', 'cancelled')),
  linked_visit_id uuid references public.field_demo_visits(id) on delete set null,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (available_end > available_start),
  check (service_radius_miles between 1 and 250)
);

alter table public.field_demo_visits
  add column if not exists property_zip text,
  add column if not exists assignment_source text,
  add column if not exists assigned_by_availability_id uuid references public.field_coverage_availability(id) on delete set null;

alter table public.field_demo_visit_participants
  add column if not exists availability_id uuid references public.field_coverage_availability(id) on delete set null,
  add column if not exists assignment_score numeric,
  add column if not exists assignment_reason text;

create index if not exists idx_field_coverage_availability_profile
  on public.field_coverage_availability(participant_profile_id);

create index if not exists idx_field_coverage_availability_uid
  on public.field_coverage_availability(participant_uid);

create index if not exists idx_field_coverage_availability_slug
  on public.field_coverage_availability(participant_slug);

create index if not exists idx_field_coverage_availability_window
  on public.field_coverage_availability(available_start, available_end);

create index if not exists idx_field_coverage_availability_zip_status
  on public.field_coverage_availability(service_zip, status);

create index if not exists idx_field_demo_visits_property_zip
  on public.field_demo_visits(property_zip);

create index if not exists idx_field_demo_participants_availability
  on public.field_demo_visit_participants(availability_id);

alter table public.field_coverage_availability enable row level security;

revoke all on public.field_coverage_availability from anon, authenticated;
grant all on public.field_coverage_availability to service_role;

comment on table public.field_coverage_availability is 'Availability slots for loan officers and field operators. Assignment can rank by time overlap and service ZIP proximity before creating field demo participants.';
comment on column public.field_coverage_availability.service_zip is 'Primary ZIP where this participant is available to provide coverage for the slot.';
comment on column public.field_coverage_availability.service_radius_miles is 'Coverage radius for assignment. Exact distance requires lat/lng or zip centroid data; otherwise matching falls back to ZIP proximity.';
