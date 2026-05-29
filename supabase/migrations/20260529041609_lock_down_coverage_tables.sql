-- Keep Sponsored Event Pass and LO Coverage Sign records behind server-side APIs.
-- Browser pages call Vercel serverless routes that use the service role; direct
-- anon/authenticated table access should not be available for these records.

alter table public.event_pass_coverage_consents enable row level security;
alter table public.loan_officer_coverage_signs enable row level security;
alter table public.loan_officer_sign_events enable row level security;

drop policy if exists "service role manages event pass coverage consents"
  on public.event_pass_coverage_consents;
create policy "service role manages event pass coverage consents"
  on public.event_pass_coverage_consents
  for all
  to service_role
  using (true)
  with check (true);

drop policy if exists "service role manages loan officer coverage signs"
  on public.loan_officer_coverage_signs;
create policy "service role manages loan officer coverage signs"
  on public.loan_officer_coverage_signs
  for all
  to service_role
  using (true)
  with check (true);

drop policy if exists "service role manages loan officer sign events"
  on public.loan_officer_sign_events;
create policy "service role manages loan officer sign events"
  on public.loan_officer_sign_events
  for all
  to service_role
  using (true)
  with check (true);
