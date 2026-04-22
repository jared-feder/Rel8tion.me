create extension if not exists pgcrypto;

create table if not exists public.agent_outreach_replies (
  id uuid primary key default gen_random_uuid(),
  queue_row_id uuid references public.agent_outreach_queue(id) on delete set null,
  open_house_id text,
  from_phone text not null,
  from_phone_normalized text not null,
  to_phone text,
  body text not null default '',
  message_sid text not null unique,
  account_sid text,
  direction text not null default 'inbound',
  opt_out boolean not null default false,
  raw_payload jsonb not null default '{}'::jsonb,
  received_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists agent_outreach_replies_queue_row_id_idx
  on public.agent_outreach_replies(queue_row_id, received_at desc);

create index if not exists agent_outreach_replies_from_phone_idx
  on public.agent_outreach_replies(from_phone_normalized, received_at desc);

create index if not exists agent_outreach_replies_open_house_idx
  on public.agent_outreach_replies(open_house_id, received_at desc);
