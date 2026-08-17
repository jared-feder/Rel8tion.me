-- Immutable evidence ledger for completed disclosure-signing packets.
-- This migration is additive. Existing packet objects and event_checkins metadata remain intact.

create extension if not exists pgcrypto;

create table if not exists public.disclosure_signing_events (
  id uuid primary key,
  checkin_id uuid not null references public.event_checkins(id) on delete restrict,
  event_id uuid not null references public.open_house_events(id) on delete restrict,
  record_source text not null
    check (record_source in ('server_request', 'legacy_import')),
  packet_version text not null,
  document_type text not null,
  signature_type text not null,
  signature_value text not null,
  esign_consent boolean not null,
  consent_text text,
  consent_text_version text not null,
  consumer_role text,
  client_signed_at timestamptz not null,
  server_received_at timestamptz not null default now(),
  request_ip inet,
  client_user_agent text,
  server_user_agent text,
  request_id text,
  provided_by_agent_name text,
  provided_by_brokerage text,
  source_forms jsonb not null default '[]'::jsonb,
  storage_bucket text not null,
  storage_path text not null unique,
  storage_file_name text not null,
  document_sha256 text not null
    check (document_sha256 ~ '^[0-9a-f]{64}$'),
  signed_pdf jsonb not null,
  evidence jsonb not null default '{}'::jsonb,
  event_hash text not null unique,
  created_at timestamptz not null default now(),
  check (
    record_source = 'legacy_import'
    or (consent_text is not null and length(btrim(consent_text)) > 0)
  )
);

create unique index if not exists disclosure_signing_events_current_packet_idx
  on public.disclosure_signing_events (checkin_id, packet_version);

create index if not exists disclosure_signing_events_checkin_time_idx
  on public.disclosure_signing_events (checkin_id, created_at desc);

create index if not exists disclosure_signing_events_event_time_idx
  on public.disclosure_signing_events (event_id, created_at desc);

create or replace function public.disclosure_signing_event_set_hash()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  new.event_hash := encode(
    digest(
      jsonb_build_object(
        'id', new.id,
        'checkin_id', new.checkin_id,
        'event_id', new.event_id,
        'record_source', new.record_source,
        'packet_version', new.packet_version,
        'document_type', new.document_type,
        'signature_type', new.signature_type,
        'signature_value', new.signature_value,
        'esign_consent', new.esign_consent,
        'consent_text', new.consent_text,
        'consent_text_version', new.consent_text_version,
        'consumer_role', new.consumer_role,
        'client_signed_at', new.client_signed_at,
        'server_received_at', new.server_received_at,
        'request_ip', new.request_ip,
        'client_user_agent', new.client_user_agent,
        'server_user_agent', new.server_user_agent,
        'request_id', new.request_id,
        'provided_by_agent_name', new.provided_by_agent_name,
        'provided_by_brokerage', new.provided_by_brokerage,
        'source_forms', new.source_forms,
        'storage_bucket', new.storage_bucket,
        'storage_path', new.storage_path,
        'storage_file_name', new.storage_file_name,
        'document_sha256', new.document_sha256,
        'signed_pdf', new.signed_pdf,
        'evidence', new.evidence
      )::text,
      'sha256'
    ),
    'hex'
  );
  return new;
end;
$$;

create or replace function public.prevent_disclosure_signing_event_mutation()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  raise exception 'disclosure_signing_events is append-only'
    using errcode = '55000';
end;
$$;

drop trigger if exists disclosure_signing_events_set_hash
  on public.disclosure_signing_events;
create trigger disclosure_signing_events_set_hash
  before insert on public.disclosure_signing_events
  for each row execute function public.disclosure_signing_event_set_hash();

drop trigger if exists disclosure_signing_events_prevent_mutation
  on public.disclosure_signing_events;
create trigger disclosure_signing_events_prevent_mutation
  before update or delete on public.disclosure_signing_events
  for each row execute function public.prevent_disclosure_signing_event_mutation();

alter table public.disclosure_signing_events enable row level security;
alter table public.disclosure_signing_events force row level security;

revoke all on public.disclosure_signing_events from anon;
revoke all on public.disclosure_signing_events from authenticated;
revoke all on function public.disclosure_signing_event_set_hash() from public;
revoke all on function public.prevent_disclosure_signing_event_mutation() from public;
grant select, insert on public.disclosure_signing_events to service_role;

comment on table public.disclosure_signing_events is
  'Append-only, service-role-only evidence ledger for NY disclosure signing packets. Updates and deletes are rejected by trigger.';
comment on column public.disclosure_signing_events.request_ip is
  'Server-observed request IP. Null for legacy imports or when the hosting platform does not supply it.';
comment on column public.disclosure_signing_events.event_hash is
  'Database-computed SHA-256 over the immutable event evidence.';
