create table if not exists public.agent_phone_verifications (
  id uuid primary key default gen_random_uuid(),
  agent_slug text not null,
  key_uid text not null,
  code_hash text not null,
  code_salt text not null,
  phone_last_four text,
  attempts integer not null default 0,
  expires_at timestamptz not null,
  verified_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists idx_agent_phone_verifications_subject_created
  on public.agent_phone_verifications(agent_slug, key_uid, created_at desc);

alter table public.agent_phone_verifications enable row level security;
revoke all on public.agent_phone_verifications from anon, authenticated;

comment on table public.agent_phone_verifications is
  'Service-role-only SMS challenges used before enrolling an agent dashboard phone lock.';
