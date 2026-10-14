create table public.outreach_performance_reports
  (like public.weekly_production_reports including defaults including constraints including indexes);
alter table public.outreach_performance_reports enable row level security;
revoke all on public.outreach_performance_reports from public, anon, authenticated;
revoke all on public.outreach_performance_reports from service_role;
grant select, insert, update on public.outreach_performance_reports to service_role;
create trigger protect_outreach_report_snapshot before update on public.outreach_performance_reports
for each row execute function public.protect_weekly_report_snapshot();
comment on table public.outreach_performance_reports is
  'Private immutable outreach performance briefs. Separate from event production and closeout. No client grants.';
