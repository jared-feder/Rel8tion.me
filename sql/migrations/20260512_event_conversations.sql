create table if not exists public.event_conversations (
  id uuid primary key default gen_random_uuid(),
  open_house_event_id uuid not null references public.open_house_events(id) on delete cascade,
  field_demo_visit_id uuid references public.field_demo_visits(id) on delete set null,
  buyer_checkin_id uuid references public.event_checkins(id) on delete set null,
  buyer_name text,
  buyer_phone text,
  agent_slug text,
  agent_name text,
  agent_phone text,
  loan_officer_slug text,
  loan_officer_name text,
  loan_officer_phone text,
  status text not null default 'open' check (status in ('open', 'waiting', 'closed')),
  source text not null default 'event_checkin',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.event_conversation_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.event_conversations(id) on delete cascade,
  open_house_event_id uuid not null references public.open_house_events(id) on delete cascade,
  sender_role text not null check (sender_role in ('buyer', 'agent', 'loan_officer', 'field_specialist', 'system', 'admin')),
  sender_name text,
  sender_phone text,
  sender_uid text,
  sender_slug text,
  body text not null,
  delivery_channel text not null default 'in_app',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_event_conversations_event
  on public.event_conversations(open_house_event_id, updated_at desc);

create index if not exists idx_event_conversations_checkin
  on public.event_conversations(buyer_checkin_id);

create index if not exists idx_event_conversations_status
  on public.event_conversations(status);

create index if not exists idx_event_conversation_messages_conversation
  on public.event_conversation_messages(conversation_id, created_at asc);

create index if not exists idx_event_conversation_messages_event
  on public.event_conversation_messages(open_house_event_id, created_at desc);

alter table public.event_conversations enable row level security;
alter table public.event_conversation_messages enable row level security;

grant select on public.event_conversations to service_role;
grant select, insert, update on public.event_conversations to service_role;
grant select on public.event_conversation_messages to service_role;
grant select, insert on public.event_conversation_messages to service_role;

comment on table public.event_conversations is 'In-app REL8TION conversation headers linking buyer check-ins, host agents, and NMB/field support for an open house event.';
comment on table public.event_conversation_messages is 'In-app REL8TION conversation messages for buyer, agent, and loan/field support participants.';
