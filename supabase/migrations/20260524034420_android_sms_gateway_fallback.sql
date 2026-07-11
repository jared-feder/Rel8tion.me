create table if not exists public.sms_message_log (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  route text null,
  category text null,
  to_phone text not null,
  body text null,
  status text not null,
  external_id text null,
  device_id text null,
  error text null,
  metadata jsonb default '{}'::jsonb,
  created_at timestamptz default now()
);

create index if not exists sms_message_log_created_at_idx
  on public.sms_message_log(created_at desc);

create index if not exists sms_message_log_to_phone_idx
  on public.sms_message_log(to_phone, created_at desc);

create index if not exists sms_message_log_category_status_idx
  on public.sms_message_log(category, status, created_at desc);

create table if not exists public.sms_suppression_list (
  id uuid primary key default gen_random_uuid(),
  phone text unique not null,
  reason text null,
  provider text null,
  source text null,
  raw_payload jsonb default '{}'::jsonb,
  created_at timestamptz default now()
);

create index if not exists sms_suppression_list_created_at_idx
  on public.sms_suppression_list(created_at desc);

create table if not exists public.sms_inbound_messages (
  id uuid primary key default gen_random_uuid(),
  provider text not null default 'android_gateway',
  device_id text null,
  from_phone text not null,
  body text not null,
  raw_payload jsonb default '{}'::jsonb,
  is_stop boolean default false,
  created_at timestamptz default now()
);

create index if not exists sms_inbound_messages_from_phone_idx
  on public.sms_inbound_messages(from_phone, created_at desc);

create index if not exists sms_inbound_messages_is_stop_idx
  on public.sms_inbound_messages(is_stop, created_at desc);

alter table public.sms_message_log enable row level security;
alter table public.sms_suppression_list enable row level security;
alter table public.sms_inbound_messages enable row level security;

grant insert, select on public.sms_message_log to service_role;
grant insert, select, update on public.sms_suppression_list to service_role;
grant insert, select on public.sms_inbound_messages to service_role;
