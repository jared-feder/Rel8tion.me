create table if not exists public.event_loan_officer_sessions (
  id uuid primary key default gen_random_uuid(),
  open_house_event_id uuid not null references public.open_house_events(id) on delete cascade,
  verified_profile_uid uuid references public.verified_profiles(uid) on delete set null,
  loan_officer_uid uuid,
  loan_officer_slug text,
  loan_officer_name text,
  loan_officer_title text,
  loan_officer_company text,
  loan_officer_phone text,
  loan_officer_email text,
  loan_officer_photo_url text,
  loan_officer_cta_url text,
  loan_officer_calendar_url text,
  status text not null default 'live' check (status in ('live','ended')),
  signed_in_at timestamptz not null default now(),
  signed_out_at timestamptz,
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists idx_event_loan_officer_one_live_per_event
  on public.event_loan_officer_sessions(open_house_event_id)
  where status = 'live';

create index if not exists idx_event_loan_officer_sessions_event_status
  on public.event_loan_officer_sessions(open_house_event_id, status);

create index if not exists idx_event_loan_officer_sessions_uid
  on public.event_loan_officer_sessions(loan_officer_uid);

grant select, insert, update on public.event_loan_officer_sessions to anon, authenticated;

comment on table public.event_loan_officer_sessions is 'Live NMB/loan officer coverage attached to a smart sign open house event.';
