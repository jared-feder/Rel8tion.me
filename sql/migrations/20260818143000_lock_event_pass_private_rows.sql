-- Event Pass buyer PII and operator state must not be readable or mutable through the public browser key.
-- Older non-Event-Pass Smart Sign flows retain their existing Data API access until they are migrated.

alter table public.event_checkins enable row level security;

drop policy if exists "event_checkins_non_event_pass_legacy_select" on public.event_checkins;
drop policy if exists "event_checkins_non_event_pass_legacy_insert" on public.event_checkins;
drop policy if exists "event_checkins_non_event_pass_legacy_update" on public.event_checkins;

create policy "event_checkins_non_event_pass_legacy_select"
on public.event_checkins
for select
to anon, authenticated
using (
  not exists (
    select 1
    from public.open_house_events event_row
    left join public.smart_signs sign_row on sign_row.id = event_row.smart_sign_id
    where event_row.id = event_checkins.open_house_event_id
      and (
        coalesce(event_row.setup_context ->> 'flow', '') = 'event-pass'
        or coalesce(event_row.setup_context ->> 'qr_source', '') = 'event_pass'
        or coalesce(event_row.setup_context ->> 'source', '') = 'event-pass-keychain'
        or sign_row.activation_method = 'event_pass_keychain'
        or sign_row.primary_device_type in ('event_pass_keychain', 'event_pass_qr')
      )
  )
);

create policy "event_checkins_non_event_pass_legacy_insert"
on public.event_checkins
for insert
to anon, authenticated
with check (
  not exists (
    select 1
    from public.open_house_events event_row
    left join public.smart_signs sign_row on sign_row.id = event_row.smart_sign_id
    where event_row.id = event_checkins.open_house_event_id
      and (
        coalesce(event_row.setup_context ->> 'flow', '') = 'event-pass'
        or coalesce(event_row.setup_context ->> 'qr_source', '') = 'event_pass'
        or coalesce(event_row.setup_context ->> 'source', '') = 'event-pass-keychain'
        or sign_row.activation_method = 'event_pass_keychain'
        or sign_row.primary_device_type in ('event_pass_keychain', 'event_pass_qr')
      )
  )
);

create policy "event_checkins_non_event_pass_legacy_update"
on public.event_checkins
for update
to anon, authenticated
using (
  not exists (
    select 1
    from public.open_house_events event_row
    left join public.smart_signs sign_row on sign_row.id = event_row.smart_sign_id
    where event_row.id = event_checkins.open_house_event_id
      and (
        coalesce(event_row.setup_context ->> 'flow', '') = 'event-pass'
        or coalesce(event_row.setup_context ->> 'qr_source', '') = 'event_pass'
        or coalesce(event_row.setup_context ->> 'source', '') = 'event-pass-keychain'
        or sign_row.activation_method = 'event_pass_keychain'
        or sign_row.primary_device_type in ('event_pass_keychain', 'event_pass_qr')
      )
  )
)
with check (
  not exists (
    select 1
    from public.open_house_events event_row
    left join public.smart_signs sign_row on sign_row.id = event_row.smart_sign_id
    where event_row.id = event_checkins.open_house_event_id
      and (
        coalesce(event_row.setup_context ->> 'flow', '') = 'event-pass'
        or coalesce(event_row.setup_context ->> 'qr_source', '') = 'event_pass'
        or coalesce(event_row.setup_context ->> 'source', '') = 'event-pass-keychain'
        or sign_row.activation_method = 'event_pass_keychain'
        or sign_row.primary_device_type in ('event_pass_keychain', 'event_pass_qr')
      )
  )
);

revoke delete on table public.event_checkins from anon, authenticated;
grant select, insert, update on table public.event_checkins to anon, authenticated;
grant select, insert, update, delete on table public.event_checkins to service_role;

alter table public.open_house_events enable row level security;

drop policy if exists "open_house_events_public_read" on public.open_house_events;
drop policy if exists "open_house_events_non_event_pass_legacy_insert" on public.open_house_events;
drop policy if exists "open_house_events_non_event_pass_legacy_update" on public.open_house_events;

create policy "open_house_events_public_read"
on public.open_house_events for select to anon, authenticated using (true);

create policy "open_house_events_non_event_pass_legacy_insert"
on public.open_house_events for insert to anon, authenticated
with check (
  coalesce(setup_context ->> 'flow', '') <> 'event-pass'
  and coalesce(setup_context ->> 'qr_source', '') <> 'event_pass'
  and coalesce(setup_context ->> 'source', '') <> 'event-pass-keychain'
);

create policy "open_house_events_non_event_pass_legacy_update"
on public.open_house_events for update to anon, authenticated
using (
  coalesce(setup_context ->> 'flow', '') <> 'event-pass'
  and coalesce(setup_context ->> 'qr_source', '') <> 'event_pass'
  and coalesce(setup_context ->> 'source', '') <> 'event-pass-keychain'
)
with check (
  coalesce(setup_context ->> 'flow', '') <> 'event-pass'
  and coalesce(setup_context ->> 'qr_source', '') <> 'event_pass'
  and coalesce(setup_context ->> 'source', '') <> 'event-pass-keychain'
);

revoke delete on table public.open_house_events from anon, authenticated;
grant select, insert, update on table public.open_house_events to anon, authenticated;
grant select, insert, update, delete on table public.open_house_events to service_role;

alter table public.smart_signs enable row level security;

drop policy if exists "smart_signs_public_read" on public.smart_signs;
drop policy if exists "smart_signs_non_event_pass_legacy_insert" on public.smart_signs;
drop policy if exists "smart_signs_non_event_pass_legacy_update" on public.smart_signs;

create policy "smart_signs_public_read"
on public.smart_signs for select to anon, authenticated using (true);

create policy "smart_signs_non_event_pass_legacy_insert"
on public.smart_signs for insert to anon, authenticated
with check (
  coalesce(activation_method, '') <> 'event_pass_keychain'
  and coalesce(primary_device_type, '') not in ('event_pass_keychain', 'event_pass_qr')
);

create policy "smart_signs_non_event_pass_legacy_update"
on public.smart_signs for update to anon, authenticated
using (
  coalesce(activation_method, '') <> 'event_pass_keychain'
  and coalesce(primary_device_type, '') not in ('event_pass_keychain', 'event_pass_qr')
)
with check (
  coalesce(activation_method, '') <> 'event_pass_keychain'
  and coalesce(primary_device_type, '') not in ('event_pass_keychain', 'event_pass_qr')
);

revoke delete on table public.smart_signs from anon, authenticated;
grant select, insert, update on table public.smart_signs to anon, authenticated;
grant select, insert, update, delete on table public.smart_signs to service_role;
