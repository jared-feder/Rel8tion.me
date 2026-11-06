-- REVIEW PROPOSAL ONLY. NOT A MIGRATION. NOT APPLIED.
-- Before approval: inventory/migrate every direct browser check-in reader/writer,
-- test agent, field, guest and legacy Smart Sign paths against a test database,
-- inspect current grants/RLS and private signed-disclosures storage policies,
-- and verify that server routes enforce exact record access.
-- The existing legacy non-Event-Pass policies can otherwise bypass the API.
-- Use the normal Supabase migration workflow after that review; do not execute
-- this file against production as an isolated quick fix.
begin;
revoke select, insert, update, delete on table public.event_checkins
  from public, anon, authenticated;
grant select, insert, update, delete on table public.event_checkins to service_role;
-- Keep existing RLS enabled. Add no blanket authenticated-user policy.
-- Explicit server authorization must precede privileged reads and writes.
rollback; -- Deliberately non-applying until a reviewed migration is approved.
