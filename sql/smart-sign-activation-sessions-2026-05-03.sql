create table if not exists public.smart_sign_activation_sessions (
  id uuid primary key default gen_random_uuid(),
  public_code text not null,
  sign_id uuid null references public.smart_signs(id) on delete cascade,
  inventory_id uuid null references public.smart_sign_inventory(id) on delete set null,
  agent_key_uid text null,
  agent_slug text null,
  owner_agent_slug text null,
  stage text not null default 'waiting_for_agent_keychain',
  primary_chip_uid text null,
  secondary_chip_uid text null,
  status text not null default 'pending',
  started_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '45 minutes'),
  constraint smart_sign_activation_sessions_stage_check check (
    stage in (
      'waiting_for_agent_keychain',
      'waiting_for_sign_code',
      'waiting_for_sign_chip_1',
      'waiting_for_second_sign_chip',
      'waiting_for_handshake',
      'handshake_complete',
      'completed',
      'cancelled'
    )
  ),
  constraint smart_sign_activation_sessions_status_check check (
    status in ('pending', 'completed', 'cancelled', 'expired')
  )
);

create index if not exists idx_smart_sign_activation_sessions_pending
  on public.smart_sign_activation_sessions (status, stage, updated_at desc)
  where status = 'pending';

create index if not exists idx_smart_sign_activation_sessions_public_code
  on public.smart_sign_activation_sessions (public_code, status, updated_at desc);

alter table public.smart_sign_activation_sessions enable row level security;

drop policy if exists "public read pending smart sign activation sessions" on public.smart_sign_activation_sessions;
create policy "public read pending smart sign activation sessions"
  on public.smart_sign_activation_sessions
  for select
  to anon, authenticated
  using (
    status = 'pending'
    and expires_at > now()
  );

drop policy if exists "public create smart sign activation sessions" on public.smart_sign_activation_sessions;
create policy "public create smart sign activation sessions"
  on public.smart_sign_activation_sessions
  for insert
  to anon, authenticated
  with check (
    status = 'pending'
    and expires_at > now()
  );

drop policy if exists "public update pending smart sign activation sessions" on public.smart_sign_activation_sessions;
create policy "public update pending smart sign activation sessions"
  on public.smart_sign_activation_sessions
  for update
  to anon, authenticated
  using (
    status = 'pending'
    and expires_at > now()
  )
  with check (
    expires_at > now()
  );
