-- Phase 2 of the production security-advisor remediation.
--
-- These are public read catalogs used by current browser flows. Preserve the
-- existing SELECT contract while removing anonymous/authenticated mutation.

alter table public.brokerages enable row level security;
alter table public.brokerages force row level security;

alter table public.open_houses enable row level security;
alter table public.open_houses force row level security;

alter table public.listing_agents enable row level security;
alter table public.listing_agents force row level security;

revoke all privileges on table
  public.brokerages,
  public.open_houses,
  public.listing_agents
from public, anon, authenticated;

grant select on table
  public.brokerages,
  public.open_houses,
  public.listing_agents
to anon, authenticated;

grant select, insert, update, delete on table
  public.brokerages,
  public.open_houses,
  public.listing_agents
to service_role;

create policy brokerages_public_read
on public.brokerages
for select
to anon, authenticated
using (true);

create policy open_houses_public_read
on public.open_houses
for select
to anon, authenticated
using (true);

create policy listing_agents_public_read
on public.listing_agents
for select
to anon, authenticated
using (true);
