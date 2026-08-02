create table if not exists public.rel8tion_call_bookings (
  id bigint generated always as identity primary key,
  booking_code text not null unique,
  call_type text not null check (call_type in ('loan_officer', 'broker_team')),
  status text not null default 'confirmed' check (status in ('confirmed', 'cancelled')),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  timezone text not null default 'America/New_York',
  contact_name text not null,
  email text not null,
  email_normalized text not null,
  phone text,
  company_name text,
  team_size integer check (team_size is null or team_size between 1 and 100000),
  notes text,
  source text,
  request_ip_hash text,
  confirmation_sent_at timestamptz,
  notification_error text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_at > starts_at)
);

create unique index if not exists rel8tion_call_bookings_confirmed_start_uidx
  on public.rel8tion_call_bookings (starts_at)
  where status = 'confirmed';

create index if not exists rel8tion_call_bookings_status_start_idx
  on public.rel8tion_call_bookings (status, starts_at);

create index if not exists rel8tion_call_bookings_email_created_idx
  on public.rel8tion_call_bookings (email_normalized, created_at desc);

alter table public.rel8tion_call_bookings enable row level security;
alter table public.rel8tion_call_bookings force row level security;

revoke all on table public.rel8tion_call_bookings from anon, authenticated;
revoke all on sequence public.rel8tion_call_bookings_id_seq from anon, authenticated;
grant select, insert, update on table public.rel8tion_call_bookings to service_role;
grant usage, select on sequence public.rel8tion_call_bookings_id_seq to service_role;

comment on table public.rel8tion_call_bookings is
  'Private REL8TION sales-call bookings. Browser roles have no direct access; Vercel server routes use service_role.';

comment on column public.rel8tion_call_bookings.request_ip_hash is
  'One-way request fingerprint used only for basic booking-abuse controls; never store the raw IP address.';
