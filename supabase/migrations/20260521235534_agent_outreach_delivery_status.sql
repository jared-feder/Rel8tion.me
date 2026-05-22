alter table public.agent_outreach_queue
  add column if not exists initial_delivery_status text,
  add column if not exists initial_delivery_status_updated_at timestamptz,
  add column if not exists initial_delivery_error_code text,
  add column if not exists initial_delivery_error_message text,
  add column if not exists followup_delivery_status text,
  add column if not exists followup_delivery_status_updated_at timestamptz,
  add column if not exists followup_delivery_error_code text,
  add column if not exists followup_delivery_error_message text,
  add column if not exists last_delivery_status text,
  add column if not exists last_delivery_status_updated_at timestamptz,
  add column if not exists last_delivery_error_code text,
  add column if not exists last_delivery_error_message text;

create table if not exists public.agent_outreach_delivery_events (
  id uuid primary key default gen_random_uuid(),
  queue_row_id uuid references public.agent_outreach_queue(id) on delete set null,
  open_house_id text,
  message_sid text not null,
  message_step text not null default 'unknown',
  message_status text not null,
  error_code text,
  error_message text,
  from_phone text,
  to_phone text,
  account_sid text,
  raw_payload jsonb not null default '{}'::jsonb,
  received_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists agent_outreach_delivery_events_queue_idx
  on public.agent_outreach_delivery_events(queue_row_id, received_at desc);

create index if not exists agent_outreach_delivery_events_sid_idx
  on public.agent_outreach_delivery_events(message_sid, received_at desc);

create index if not exists agent_outreach_queue_initial_delivery_idx
  on public.agent_outreach_queue(initial_delivery_status, initial_delivery_status_updated_at desc);

create index if not exists agent_outreach_queue_followup_delivery_idx
  on public.agent_outreach_queue(followup_delivery_status, followup_delivery_status_updated_at desc);

alter table public.agent_outreach_delivery_events enable row level security;
