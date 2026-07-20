create table if not exists public.event_pass_requests (
  id uuid primary key default gen_random_uuid(),
  agent_name text not null,
  agent_brokerage text,
  agent_phone text not null,
  agent_phone_normalized text not null,
  agent_email text not null,
  open_house_address text,
  open_house_date text,
  market text,
  has_current_loan_specialist boolean not null default false,
  wants_current_loan_specialist_coverage boolean not null default false,
  loan_officer_name text,
  loan_officer_company text,
  loan_officer_phone text,
  loan_officer_phone_normalized text,
  loan_officer_email text,
  sponsorship_route text not null default 'nmb_default'
    check (sponsorship_route in ('agent_loan_officer', 'nmb_default')),
  status text not null default 'new',
  source text not null default 'wordpress-home',
  source_url text,
  notes text,
  user_agent text,
  ip_address text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists event_pass_requests_created_at_idx
  on public.event_pass_requests (created_at desc);

create index if not exists event_pass_requests_status_route_idx
  on public.event_pass_requests (status, sponsorship_route, created_at desc);

alter table public.event_pass_requests enable row level security;

comment on table public.event_pass_requests is
  'Agent Event Pass requests submitted from public Rel8tion pages. Writes use the service-role API only.';
