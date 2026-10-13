create table public.weekly_production_reports (
  week_start date primary key check (extract(isodow from week_start) = 1),
  window_start timestamptz not null,
  window_end timestamptz not null check (window_end > window_start),
  generation_status text not null default 'pending' check (generation_status in ('pending','building','ready','failed')),
  generation_error text,
  generated_at timestamptz,
  summary jsonb,
  processing_started_at timestamptz,
  processing_token uuid,
  closeout_status text not null default 'pending' check (closeout_status in ('pending','complete','failed')),
  closeout_result jsonb,
  email_status text not null default 'not_requested' check (email_status in ('not_requested','not_configured','sending','sent','failed','unknown')),
  email_error text,
  email_attempted_at timestamptz,
  email_sent_at timestamptz,
  email_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (generation_status <> 'ready' or (summary is not null and generated_at is not null))
);

alter table public.weekly_production_reports enable row level security;
revoke all on public.weekly_production_reports from public, anon, authenticated;
grant select, insert, update on public.weekly_production_reports to service_role;

comment on table public.weekly_production_reports is
  'Admin-only weekly snapshots. Email acceptance is separate from report generation and is not proof of inbox delivery.';

create function public.protect_weekly_report_snapshot()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.week_start is distinct from old.week_start
    or new.window_start is distinct from old.window_start
    or new.window_end is distinct from old.window_end then
    raise exception 'A reporting week cannot be changed';
  end if;
  if old.generation_status = 'ready' and (
    new.summary is distinct from old.summary
    or new.generated_at is distinct from old.generated_at
    or new.generation_status is distinct from old.generation_status
  ) then
    raise exception 'A saved weekly report snapshot cannot be replaced';
  end if;
  return new;
end;
$$;
revoke all on function public.protect_weekly_report_snapshot() from public, anon, authenticated;
create trigger protect_weekly_report_snapshot before update on public.weekly_production_reports
for each row execute function public.protect_weekly_report_snapshot();
