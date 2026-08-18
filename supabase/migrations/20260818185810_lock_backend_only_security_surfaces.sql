-- Phase 1 of the production security-advisor remediation.
--
-- These tables have no active browser callers. Their supported access path is
-- the server-side service role, so anonymous/authenticated Data API access can
-- be removed without changing public NFC, Event Pass, check-in, or listing
-- behavior.

alter table public.open_houses_backup enable row level security;
alter table public.open_houses_backup force row level security;

alter table public.open_houses_onekey_time_backup_20260509 enable row level security;
alter table public.open_houses_onekey_time_backup_20260509 force row level security;

alter table public.open_house_agents enable row level security;
alter table public.open_house_agents force row level security;

alter table public.open_house_dates enable row level security;
alter table public.open_house_dates force row level security;

alter table public.open_house_photos enable row level security;
alter table public.open_house_photos force row level security;

alter table public.buyer_agent_links enable row level security;
alter table public.buyer_agent_links force row level security;

alter table public.onekey_members enable row level security;
alter table public.onekey_members force row level security;

alter table public.onekey_member_active_listings enable row level security;
alter table public.onekey_member_active_listings force row level security;

alter table public.agent_outreach_log enable row level security;
alter table public.agent_outreach_log force row level security;

revoke all privileges on table
  public.open_houses_backup,
  public.open_houses_onekey_time_backup_20260509,
  public.open_house_agents,
  public.open_house_dates,
  public.open_house_photos,
  public.buyer_agent_links,
  public.onekey_members,
  public.onekey_member_active_listings,
  public.agent_outreach_log
from public, anon, authenticated;

grant select, insert, update, delete on table
  public.open_houses_backup,
  public.open_houses_onekey_time_backup_20260509,
  public.open_house_agents,
  public.open_house_dates,
  public.open_house_photos,
  public.buyer_agent_links,
  public.onekey_members,
  public.onekey_member_active_listings,
  public.agent_outreach_log
to service_role;

-- These operational views are consumed only by authenticated server routes.
-- SECURITY INVOKER makes them respect the caller's permissions and RLS.

alter view public.agent_outreach_hot_list set (security_invoker = true);
alter view public.agent_outreach_inbox set (security_invoker = true);
alter view public.onekey_member_summary set (security_invoker = true);

revoke all privileges on table
  public.agent_outreach_hot_list,
  public.agent_outreach_inbox,
  public.onekey_member_summary
from public, anon, authenticated;

grant select on table
  public.agent_outreach_hot_list,
  public.agent_outreach_inbox,
  public.onekey_member_summary
to service_role;

-- Queue staging is a protected cron/worker action. PostgreSQL grants function
-- execution to PUBLIC by default, so revoke both that inherited grant and the
-- explicit browser-role grants. Keep the service-role contract unchanged.

alter function public.queue_recent_outreach_candidates()
  set search_path = pg_catalog, public;

alter function public.queue_outreach_candidate(text)
  set search_path = pg_catalog, public;

revoke execute on function public.queue_recent_outreach_candidates()
from public, anon, authenticated;

revoke execute on function public.queue_outreach_candidate(text)
from public, anon, authenticated;

grant execute on function public.queue_recent_outreach_candidates()
to service_role;

grant execute on function public.queue_outreach_candidate(text)
to service_role;
