-- Phase 3 of the production security-advisor remediation.
-- Current production NFC and Event Pass routes do not use this legacy scan
-- event table from the browser. Keep it available only to server-side code.

alter table public.smart_sign_scan_events enable row level security;
alter table public.smart_sign_scan_events force row level security;

revoke all privileges on table public.smart_sign_scan_events
from public, anon, authenticated;

grant select, insert, update, delete on table public.smart_sign_scan_events
to service_role;
