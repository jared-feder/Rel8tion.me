-- PROPOSAL ONLY. Not a migration; do not include in an unattended db push.
-- Verify source ID types, trigger/RLS behavior and check-in reliability first.
-- This file creates no messages, enrollment, schedule, cron or external call.
begin;

create table public.buyer_followup_capture_control (
  singleton boolean primary key default true check (singleton = true),
  capture_enabled boolean not null default false
);
insert into public.buyer_followup_capture_control (singleton, capture_enabled) values (true, false);

create table public.buyer_followup_intake (
  source_checkin_id uuid primary key references public.event_checkins(id) on delete cascade,
  source_event_id uuid not null references public.open_house_events(id) on delete cascade,
  captured_at timestamptz not null default now(),
  intake_origin text not null default 'live_capture' check (intake_origin = 'live_capture'),
  status text not null default 'pending_review' check (status in ('pending_review', 'suppressed')),
  outbound_enabled boolean not null default false check (outbound_enabled = false)
);

create index buyer_followup_intake_pending_idx
  on public.buyer_followup_intake (captured_at, source_checkin_id)
  where status = 'pending_review';

alter table public.buyer_followup_capture_control enable row level security;
alter table public.buyer_followup_capture_control force row level security;
alter table public.buyer_followup_intake enable row level security;
alter table public.buyer_followup_intake force row level security;
revoke all on public.buyer_followup_capture_control from public, anon, authenticated, service_role;
revoke all on public.buyer_followup_intake from public, anon, authenticated, service_role;
grant select on public.buyer_followup_capture_control to service_role;
grant select on public.buyer_followup_intake to service_role;
-- A service process may suppress an intake but may never reactivate or send it.
grant update (status) on public.buyer_followup_intake to service_role;

create function public.capture_buyer_followup_intake()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (select 1 from public.buyer_followup_capture_control where singleton and capture_enabled) then
    insert into public.buyer_followup_intake (source_checkin_id, source_event_id)
    values (new.id, new.open_house_event_id)
    on conflict (source_checkin_id) do nothing;
  end if;
  return new;
end;
$$;
revoke all on function public.capture_buyer_followup_intake() from public, anon, authenticated, service_role;

create function public.guard_buyer_followup_intake_status()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.status = 'suppressed' and new.status <> 'suppressed' then
    raise exception 'Buyer follow-up intake suppression cannot be reversed.';
  end if;
  return new;
end;
$$;
revoke all on function public.guard_buyer_followup_intake_status() from public, anon, authenticated, service_role;
create trigger guard_buyer_followup_intake_status
before update of status on public.buyer_followup_intake
for each row execute function public.guard_buyer_followup_intake_status();

create trigger capture_buyer_followup_intake
after insert on public.event_checkins
for each row execute function public.capture_buyer_followup_intake();

comment on table public.buyer_followup_intake is
  'Review-only source receipt. Not consent, buyer agency, enrollment, a send queue or permission to contact. No historical backfill.';
comment on table public.buyer_followup_capture_control is
  'Capture defaults OFF. Only the database owner may enable after separately approved schema and rollout verification.';

commit;
