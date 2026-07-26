create schema if not exists private;

create table if not exists public.agent_relationships (
  id uuid primary key default gen_random_uuid(),
  canonical_key text not null unique,
  agent_source_id text null,
  agent_slug text null,
  display_name text not null,
  phone text null,
  phone_normalized text null,
  email text null,
  brokerage text null,
  photo_url text null,
  pinned boolean not null default false,
  priority_rank integer null,
  pin_reason text null,
  pinned_at timestamptz null,
  relationship_status text not null default 'known',
  last_contact_at timestamptz null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint agent_relationships_priority_rank_check
    check (priority_rank is null or priority_rank >= 0)
);

create table if not exists public.agent_relationship_events (
  id uuid primary key default gen_random_uuid(),
  relationship_id uuid not null references public.agent_relationships(id) on delete cascade,
  event_type text not null,
  source_system text not null default 'rel8tion',
  source_table text not null,
  source_record_id text not null,
  summary text null,
  occurred_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint agent_relationship_events_source_unique
    unique (source_system, source_table, source_record_id, event_type)
);

create index if not exists agent_relationships_phone_idx
  on public.agent_relationships(phone_normalized)
  where phone_normalized is not null;

create index if not exists agent_relationships_email_idx
  on public.agent_relationships(lower(email))
  where email is not null;

create index if not exists agent_relationships_slug_idx
  on public.agent_relationships(agent_slug)
  where agent_slug is not null;

create index if not exists agent_relationships_board_order_idx
  on public.agent_relationships(pinned desc, priority_rank asc nulls last, last_contact_at desc nulls last);

create index if not exists agent_relationship_events_relationship_time_idx
  on public.agent_relationship_events(relationship_id, occurred_at desc);

alter table public.agent_relationships enable row level security;
alter table public.agent_relationship_events enable row level security;

revoke all on table public.agent_relationships from anon, authenticated;
revoke all on table public.agent_relationship_events from anon, authenticated;
grant select, insert, update, delete on table public.agent_relationships to service_role;
grant select, insert, update, delete on table public.agent_relationship_events to service_role;

create or replace function private.agent_relationship_phone(value text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when length(regexp_replace(coalesce(value, ''), '\D', '', 'g')) = 11
      and regexp_replace(coalesce(value, ''), '\D', '', 'g') like '1%'
      then substr(regexp_replace(coalesce(value, ''), '\D', '', 'g'), 2)
    else nullif(regexp_replace(coalesce(value, ''), '\D', '', 'g'), '')
  end
$$;

create or replace function private.agent_relationship_key(
  phone_value text,
  email_value text,
  slug_value text,
  name_value text,
  brokerage_value text
)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when private.agent_relationship_phone(phone_value) is not null
      then 'phone:' || private.agent_relationship_phone(phone_value)
    when nullif(lower(trim(coalesce(email_value, ''))), '') is not null
      then 'email:' || lower(trim(email_value))
    when nullif(lower(trim(coalesce(slug_value, ''))), '') is not null
      then 'slug:' || lower(trim(slug_value))
    else 'name:' || md5(
      lower(trim(coalesce(name_value, ''))) || '|' ||
      lower(trim(coalesce(brokerage_value, '')))
    )
  end
$$;

create or replace function private.upsert_agent_relationship(
  phone_value text,
  email_value text,
  slug_value text,
  name_value text,
  brokerage_value text,
  photo_value text default null,
  source_id_value text default null,
  contact_at_value timestamptz default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  relationship_uuid uuid;
  normalized_phone text := private.agent_relationship_phone(phone_value);
  relationship_key text := private.agent_relationship_key(
    phone_value,
    email_value,
    slug_value,
    name_value,
    brokerage_value
  );
begin
  insert into public.agent_relationships (
    canonical_key,
    agent_source_id,
    agent_slug,
    display_name,
    phone,
    phone_normalized,
    email,
    brokerage,
    photo_url,
    last_contact_at
  )
  values (
    relationship_key,
    nullif(source_id_value, ''),
    nullif(slug_value, ''),
    coalesce(nullif(trim(name_value), ''), 'Unknown agent'),
    nullif(phone_value, ''),
    normalized_phone,
    nullif(lower(trim(email_value)), ''),
    nullif(trim(brokerage_value), ''),
    nullif(photo_value, ''),
    contact_at_value
  )
  on conflict (canonical_key) do update set
    agent_source_id = coalesce(excluded.agent_source_id, public.agent_relationships.agent_source_id),
    agent_slug = coalesce(excluded.agent_slug, public.agent_relationships.agent_slug),
    display_name = coalesce(nullif(excluded.display_name, 'Unknown agent'), public.agent_relationships.display_name),
    phone = coalesce(excluded.phone, public.agent_relationships.phone),
    phone_normalized = coalesce(excluded.phone_normalized, public.agent_relationships.phone_normalized),
    email = coalesce(excluded.email, public.agent_relationships.email),
    brokerage = coalesce(excluded.brokerage, public.agent_relationships.brokerage),
    photo_url = coalesce(excluded.photo_url, public.agent_relationships.photo_url),
    last_contact_at = greatest(public.agent_relationships.last_contact_at, excluded.last_contact_at),
    updated_at = now()
  returning id into relationship_uuid;

  return relationship_uuid;
end
$$;

create or replace function private.record_agent_relationship_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  relationship_uuid uuid;
  queue_row record;
  next_event_type text;
  event_time timestamptz;
  event_summary text;
  source_metadata jsonb;
begin
  if tg_table_name = 'agent_outreach_queue' then
    relationship_uuid := private.upsert_agent_relationship(
      new.agent_phone,
      new.agent_email,
      null,
      new.agent_name,
      new.brokerage,
      new.agent_photo_url,
      new.id::text,
      coalesce(new.last_outreach_at, new.initial_sent_at, new.created_at, now())
    );

    if tg_op = 'INSERT' then
      insert into public.agent_relationship_events (
        relationship_id, event_type, source_table, source_record_id, summary, occurred_at, metadata
      )
      values (
        relationship_uuid,
        'outreach_created',
        tg_table_name,
        new.id::text,
        'Agent outreach record created',
        coalesce(new.created_at, now()),
        jsonb_build_object('open_house_id', new.open_house_id, 'review_status', new.review_status)
      )
      on conflict do nothing;
    end if;

    next_event_type := case
      when new.review_status = 'confirmed_open_house' then 'confirmed_open_house'
      when new.review_status = 'accepted_open_house' then 'accepted_open_house'
      when new.review_status in ('interested', 'replied') then 'two_way_engagement'
      else null
    end;
    if next_event_type is not null then
      insert into public.agent_relationship_events (
        relationship_id, event_type, source_table, source_record_id, summary, occurred_at, metadata
      )
      values (
        relationship_uuid,
        next_event_type,
        tg_table_name,
        new.id::text,
        replace(initcap(next_event_type), '_', ' '),
        coalesce(new.last_outreach_at, new.initial_sent_at, new.created_at, now()),
        jsonb_build_object('open_house_id', new.open_house_id, 'review_status', new.review_status)
      )
      on conflict do nothing;
    end if;
  elsif tg_table_name = 'agent_outreach_replies' then
    select *
    into queue_row
    from public.agent_outreach_queue
    where id = new.queue_row_id
    limit 1;

    if queue_row.id is not null then
      relationship_uuid := private.upsert_agent_relationship(
        queue_row.agent_phone,
        queue_row.agent_email,
        null,
        queue_row.agent_name,
        queue_row.brokerage,
        queue_row.agent_photo_url,
        queue_row.id::text,
        coalesce(new.received_at, new.created_at, now())
      );
      next_event_type := case when new.direction = 'outbound' then 'message_sent' else 'reply_received' end;
      insert into public.agent_relationship_events (
        relationship_id, event_type, source_table, source_record_id, summary, occurred_at, metadata
      )
      values (
        relationship_uuid,
        next_event_type,
        tg_table_name,
        new.id::text,
        case when new.direction = 'outbound' then 'Outbound message sent' else 'Agent reply received' end,
        coalesce(new.received_at, new.created_at, now()),
        jsonb_build_object('queue_row_id', new.queue_row_id, 'open_house_id', new.open_house_id, 'direction', new.direction)
      )
      on conflict do nothing;
    end if;
  elsif tg_table_name = 'field_demo_visits' then
    if coalesce(new.status, '') <> 'cancelled' then
      relationship_uuid := private.upsert_agent_relationship(
        new.agent_phone,
        new.agent_email,
        new.agent_slug,
        new.agent_name,
        new.brokerage,
        null,
        new.id::text,
        coalesce(new.confirmed_at, new.scheduled_start, new.created_at, now())
      );
      insert into public.agent_relationship_events (
        relationship_id, event_type, source_table, source_record_id, summary, occurred_at, metadata
      )
      values (
        relationship_uuid,
        'field_visit',
        tg_table_name,
        new.id::text,
        'Open-house field visit',
        coalesce(new.confirmed_at, new.scheduled_start, new.created_at, now()),
        jsonb_build_object(
          'open_house_id', new.open_house_id,
          'outreach_queue_id', new.outreach_queue_id,
          'status', new.status
        )
      )
      on conflict do nothing;
    end if;
  end if;

  return new;
end
$$;

revoke all on function private.agent_relationship_phone(text) from public, anon, authenticated;
revoke all on function private.agent_relationship_key(text, text, text, text, text) from public, anon, authenticated;
revoke all on function private.upsert_agent_relationship(text, text, text, text, text, text, text, timestamptz) from public, anon, authenticated;
revoke all on function private.record_agent_relationship_event() from public, anon, authenticated;

drop trigger if exists agent_relationship_queue_stream on public.agent_outreach_queue;
create trigger agent_relationship_queue_stream
after insert or update of review_status, last_outreach_at, initial_sent_at
on public.agent_outreach_queue
for each row execute function private.record_agent_relationship_event();

drop trigger if exists agent_relationship_reply_stream on public.agent_outreach_replies;
create trigger agent_relationship_reply_stream
after insert on public.agent_outreach_replies
for each row execute function private.record_agent_relationship_event();

drop trigger if exists agent_relationship_visit_stream on public.field_demo_visits;
create trigger agent_relationship_visit_stream
after insert or update of status, confirmed_at, scheduled_start
on public.field_demo_visits
for each row execute function private.record_agent_relationship_event();

insert into public.agent_relationships (
  canonical_key,
  agent_source_id,
  agent_slug,
  display_name,
  phone,
  phone_normalized,
  email,
  brokerage,
  photo_url,
  last_contact_at
)
select
  private.agent_relationship_key(phone, email, slug, name, brokerage),
  id::text,
  slug,
  coalesce(nullif(trim(name), ''), 'Unknown agent'),
  phone,
  private.agent_relationship_phone(coalesce(phone_normalized, phone)),
  nullif(lower(trim(email)), ''),
  nullif(trim(brokerage), ''),
  image_url,
  null
from public.agents
where coalesce(nullif(trim(name), ''), nullif(trim(phone), ''), nullif(trim(email), '')) is not null
on conflict (canonical_key) do update set
  agent_source_id = coalesce(excluded.agent_source_id, public.agent_relationships.agent_source_id),
  agent_slug = coalesce(excluded.agent_slug, public.agent_relationships.agent_slug),
  display_name = coalesce(nullif(excluded.display_name, 'Unknown agent'), public.agent_relationships.display_name),
  phone = coalesce(excluded.phone, public.agent_relationships.phone),
  phone_normalized = coalesce(excluded.phone_normalized, public.agent_relationships.phone_normalized),
  email = coalesce(excluded.email, public.agent_relationships.email),
  brokerage = coalesce(excluded.brokerage, public.agent_relationships.brokerage),
  photo_url = coalesce(excluded.photo_url, public.agent_relationships.photo_url),
  updated_at = now();

insert into public.agent_relationships (
  canonical_key,
  agent_source_id,
  display_name,
  phone,
  phone_normalized,
  email,
  brokerage,
  photo_url,
  last_contact_at
)
select distinct on (private.agent_relationship_key(agent_phone, agent_email, null, agent_name, brokerage))
  private.agent_relationship_key(agent_phone, agent_email, null, agent_name, brokerage),
  id::text,
  coalesce(nullif(trim(agent_name), ''), 'Unknown agent'),
  agent_phone,
  private.agent_relationship_phone(coalesce(agent_phone_normalized, agent_phone)),
  nullif(lower(trim(agent_email)), ''),
  nullif(trim(brokerage), ''),
  agent_photo_url,
  coalesce(last_outreach_at, initial_sent_at, created_at)
from public.agent_outreach_queue
where coalesce(nullif(trim(agent_name), ''), nullif(trim(agent_phone), ''), nullif(trim(agent_email), '')) is not null
order by
  private.agent_relationship_key(agent_phone, agent_email, null, agent_name, brokerage),
  coalesce(last_outreach_at, initial_sent_at, created_at) desc nulls last
on conflict (canonical_key) do update set
  agent_source_id = coalesce(excluded.agent_source_id, public.agent_relationships.agent_source_id),
  display_name = coalesce(nullif(excluded.display_name, 'Unknown agent'), public.agent_relationships.display_name),
  phone = coalesce(excluded.phone, public.agent_relationships.phone),
  phone_normalized = coalesce(excluded.phone_normalized, public.agent_relationships.phone_normalized),
  email = coalesce(excluded.email, public.agent_relationships.email),
  brokerage = coalesce(excluded.brokerage, public.agent_relationships.brokerage),
  photo_url = coalesce(excluded.photo_url, public.agent_relationships.photo_url),
  last_contact_at = greatest(public.agent_relationships.last_contact_at, excluded.last_contact_at),
  updated_at = now();

insert into public.agent_relationship_events (
  relationship_id,
  event_type,
  source_table,
  source_record_id,
  summary,
  occurred_at,
  metadata
)
select
  relationship.id,
  case
    when queue.review_status = 'confirmed_open_house' then 'confirmed_open_house'
    when queue.review_status = 'accepted_open_house' then 'accepted_open_house'
    when queue.review_status in ('interested', 'replied') then 'two_way_engagement'
    else 'outreach_created'
  end,
  'agent_outreach_queue',
  queue.id::text,
  coalesce(nullif(replace(initcap(queue.review_status), '_', ' '), ''), 'Agent outreach record'),
  coalesce(queue.last_outreach_at, queue.initial_sent_at, queue.created_at, now()),
  jsonb_build_object('open_house_id', queue.open_house_id, 'review_status', queue.review_status)
from public.agent_outreach_queue queue
join public.agent_relationships relationship
  on relationship.canonical_key = private.agent_relationship_key(
    queue.agent_phone,
    queue.agent_email,
    null,
    queue.agent_name,
    queue.brokerage
  )
on conflict do nothing;

insert into public.agent_relationship_events (
  relationship_id,
  event_type,
  source_table,
  source_record_id,
  summary,
  occurred_at,
  metadata
)
select
  relationship.id,
  'field_visit',
  'field_demo_visits',
  visit.id::text,
  'Open-house field visit',
  coalesce(visit.confirmed_at, visit.scheduled_start, visit.created_at, now()),
  jsonb_build_object(
    'open_house_id', visit.open_house_id,
    'outreach_queue_id', visit.outreach_queue_id,
    'status', visit.status
  )
from public.field_demo_visits visit
join public.agent_relationships relationship
  on relationship.canonical_key = private.agent_relationship_key(
    visit.agent_phone,
    visit.agent_email,
    visit.agent_slug,
    visit.agent_name,
    visit.brokerage
  )
where coalesce(visit.status, '') <> 'cancelled'
on conflict do nothing;

insert into public.agent_relationship_events (
  relationship_id,
  event_type,
  source_table,
  source_record_id,
  summary,
  occurred_at,
  metadata
)
select
  relationship.id,
  case when reply.direction = 'outbound' then 'message_sent' else 'reply_received' end,
  'agent_outreach_replies',
  reply.id::text,
  case when reply.direction = 'outbound' then 'Outbound message sent' else 'Agent reply received' end,
  coalesce(reply.received_at, reply.created_at, now()),
  jsonb_build_object(
    'queue_row_id', reply.queue_row_id,
    'open_house_id', reply.open_house_id,
    'direction', reply.direction
  )
from public.agent_outreach_replies reply
join public.agent_outreach_queue queue on queue.id = reply.queue_row_id
join public.agent_relationships relationship
  on relationship.canonical_key = private.agent_relationship_key(
    queue.agent_phone,
    queue.agent_email,
    null,
    queue.agent_name,
    queue.brokerage
  )
on conflict do nothing;

create or replace view public.agent_board_v1
with (security_invoker = true)
as
select
  relationship.id,
  relationship.canonical_key,
  relationship.agent_source_id,
  relationship.agent_slug,
  relationship.display_name as name,
  relationship.phone,
  relationship.phone_normalized,
  relationship.email,
  relationship.brokerage as company,
  relationship.photo_url,
  relationship.pinned,
  relationship.pinned as flagged,
  relationship.priority_rank,
  relationship.pin_reason,
  relationship.pinned_at,
  relationship.relationship_status,
  relationship.last_contact_at,
  coalesce(event_counts.communications, 0)::integer as communications,
  coalesce(event_counts.confirmed_open_houses, 0)::integer as confirmed_open_houses,
  coalesce(event_counts.field_visits, 0)::integer as open_houses_together,
  coalesce(event_counts.confirmed_open_houses, 0) > 0 as confirmed_open_house_agent,
  coalesce(event_counts.worked_with_events, 0) > 0 as worked_with_agent,
  coalesce(event_counts.relationship_sources, array[]::text[]) as relationship_sources,
  coalesce(notes.notes, '[]'::jsonb) as notes,
  relationship.metadata,
  relationship.created_at,
  relationship.updated_at
from public.agent_relationships relationship
left join lateral (
  select
    count(*) filter (where event.event_type in ('message_sent', 'reply_received', 'two_way_engagement')) as communications,
    count(*) filter (where event.event_type in ('confirmed_open_house', 'accepted_open_house')) as confirmed_open_houses,
    count(*) filter (where event.event_type = 'field_visit') as field_visits,
    count(*) filter (
      where event.event_type in (
        'reply_received',
        'two_way_engagement',
        'confirmed_open_house',
        'accepted_open_house',
        'field_visit',
        'mortgage_referral',
        'relationship_sync'
      )
    ) as worked_with_events,
    array_agg(distinct event.event_type) filter (
      where event.event_type in (
        'reply_received',
        'two_way_engagement',
        'confirmed_open_house',
        'accepted_open_house',
        'field_visit',
        'mortgage_referral',
        'relationship_sync'
      )
    ) as relationship_sources
  from public.agent_relationship_events event
  where event.relationship_id = relationship.id
) event_counts on true
left join lateral (
  select jsonb_agg(
    jsonb_build_object(
      'id', note.id,
      'text', note.summary,
      'created_at', note.occurred_at,
      'source', note.source_system
    )
    order by note.occurred_at
  ) as notes
  from (
    select event.id, event.summary, event.occurred_at, event.source_system
    from public.agent_relationship_events event
    where event.relationship_id = relationship.id
      and event.event_type = 'note_added'
    order by event.occurred_at desc
    limit 50
  ) note
) notes on true;

revoke all on table public.agent_board_v1 from anon, authenticated;
grant select on table public.agent_board_v1 to service_role;
