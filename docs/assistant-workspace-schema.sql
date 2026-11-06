-- REVIEW DRAFT ONLY. Not a migration, not applied by this build.
-- Generate the reviewed migration through Supabase CLI after isolated DB validation.
begin;
create table public.assistant_workspace_actions (
  id text primary key check (id ~ '^[a-zA-Z0-9_-]{12,100}$'),
  thread_key text not null,
  in_reply_to text not null,
  body text not null check (length(body) between 1 and 1400),
  sender text not null check (sender = '+18448211802'),
  author text not null,
  identity text not null,
  fingerprint text not null check (length(fingerprint) = 64),
  status text not null check (status in ('pending_approval','approved','simulated','dismissed')),
  created_at timestamptz not null,
  audit jsonb not null check (jsonb_typeof(audit) = 'array')
);
alter table public.assistant_workspace_actions enable row level security;
revoke all on public.assistant_workspace_actions from public, anon, authenticated;
grant select, insert, update on public.assistant_workspace_actions to service_role;
create index assistant_workspace_actions_thread on public.assistant_workspace_actions(thread_key,created_at desc);
-- A state/audit guard blocks mutation of approved content and terminal records.
create function public.guard_assistant_workspace_action() returns trigger
language plpgsql security invoker set search_path = pg_catalog, public as $$
begin
  if (to_jsonb(new) - 'status' - 'audit') is distinct from (to_jsonb(old) - 'status' - 'audit') then
    raise exception 'Assistant content is immutable; create a fresh draft';
  end if;
  if not ((old.status = 'pending_approval' and new.status in ('approved','dismissed')) or
          (old.status = 'approved' and new.status in ('simulated','dismissed'))) then
    raise exception 'Invalid assistant transition';
  end if;
  if jsonb_array_length(new.audit) <> jsonb_array_length(old.audit) + 1 or
    (new.audit - (jsonb_array_length(new.audit)-1)) is distinct from old.audit then
    raise exception 'Audit must be append-only';
  end if;
  return new;
end $$;
revoke all on function public.guard_assistant_workspace_action() from public, anon, authenticated;
create trigger guard_assistant_workspace_action before update on public.assistant_workspace_actions
for each row execute function public.guard_assistant_workspace_action();
commit;
