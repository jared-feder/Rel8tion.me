alter table public.agent_websites
add column if not exists listing_sync_enabled boolean not null default true,
add column if not exists listing_sync_status text not null default 'pending',
add column if not exists listing_sync_last_run_at timestamptz,
add column if not exists listing_sync_next_run_at timestamptz not null default now(),
add column if not exists listing_sync_last_error text;

create table if not exists public.agent_website_listing_sync_queue (
  id uuid primary key default gen_random_uuid(),
  agent_website_id uuid not null references public.agent_websites(id) on delete cascade,
  agent_name text not null,
  brokerage text,
  phone text,
  email text,
  status text not null default 'pending',
  priority integer not null default 5,
  attempts integer not null default 0,
  last_error text,
  run_after timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.agent_website_listing_sync_queue enable row level security;

drop policy if exists "agent_website_listing_sync_queue_service_role_all"
  on public.agent_website_listing_sync_queue;

create policy "agent_website_listing_sync_queue_service_role_all"
  on public.agent_website_listing_sync_queue
  for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

create index if not exists idx_agent_website_listing_sync_queue_status_run_after
  on public.agent_website_listing_sync_queue(status, run_after, priority, created_at);

create unique index if not exists agent_website_listing_sync_queue_pending_uidx
on public.agent_website_listing_sync_queue(agent_website_id)
where status in ('pending', 'running');

create or replace function public.queue_agent_website_listing_sync()
returns trigger
language plpgsql
as $$
begin
  if new.listing_sync_enabled is true then
    insert into public.agent_website_listing_sync_queue (
      agent_website_id,
      agent_name,
      brokerage,
      phone,
      email,
      status,
      priority,
      run_after
    )
    values (
      new.id,
      new.name,
      new.brokerage,
      new.phone,
      new.email,
      'pending',
      1,
      now()
    )
    on conflict do nothing;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_queue_agent_website_listing_sync on public.agent_websites;

create trigger trg_queue_agent_website_listing_sync
after insert on public.agent_websites
for each row
execute function public.queue_agent_website_listing_sync();

drop trigger if exists trg_requeue_agent_website_listing_sync on public.agent_websites;

create trigger trg_requeue_agent_website_listing_sync
after update of name, brokerage, phone, email on public.agent_websites
for each row
when (
  old.name is distinct from new.name
  or old.brokerage is distinct from new.brokerage
  or old.phone is distinct from new.phone
  or old.email is distinct from new.email
)
execute function public.queue_agent_website_listing_sync();

drop index if exists public.agent_website_listings_source_uidx;
