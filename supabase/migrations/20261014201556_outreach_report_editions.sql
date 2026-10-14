-- Editions are separate immutable snapshots; all original rows remain version 1.
alter table public.outreach_performance_reports add column report_version integer not null default 1 check (report_version > 0);
alter table public.outreach_performance_reports drop constraint outreach_performance_reports_pkey;
alter table public.outreach_performance_reports add primary key (week_start, report_version);
create function public.protect_outreach_report_edition() returns trigger
language plpgsql set search_path = public as $$
begin
  if new.report_version is distinct from old.report_version then
    raise exception 'A saved report edition cannot be changed';
  end if;
  return new;
end;
$$;
revoke all on function public.protect_outreach_report_edition() from public, anon, authenticated;
create trigger protect_outreach_report_edition before update on public.outreach_performance_reports
for each row execute function public.protect_outreach_report_edition();
comment on column public.outreach_performance_reports.report_version is 'Immutable edition: 1 original restoration, 2 expanded conversion and lead metrics. Existing snapshot protection and private grants remain in force.';
