# Rel8tion Schema Snapshot

Date: `2026-04-23`

This file is the most accurate schema snapshot available from the current repository and the exact SQL/table definitions referenced during the last 24 hours.

Important note:

- some tables are fully defined in SQL available in the repo
- some tables are only partially visible through app code and API usage
- the `agent_outreach_replies` table is included from the exact SQL definition supplied in the working session, even though that file is not currently present in the workspace

## 1. Exact SQL-Defined Tables / Fields

## `public.keys`

Exact fields confirmed in repo/work session:

- `uid`
- `agent_slug`
- `claimed`
- `device_role`
- `assigned_slot`

Added/confirmed by:

- `sql/migrations/20260423_device_assignment_slots.sql`

Rules:

- `assigned_slot` must be `1`, `2`, or `null`
- unique index:
  - `(agent_slug, assigned_slot)`
  - where:
    - `claimed = true`
    - `agent_slug is not null`
    - `assigned_slot is not null`
    - `device_role in ('keychain', 'chip')`

Meaning:

- an agent can have explicit keychain/chip slots
- launch assumption is two keychain slots per agent

## `public.smart_signs`

Exact fields confirmed in repo/work session:

- `id`
- `public_code`
- `active_event_id`
- `status`
- `activation_uid_primary`
- `activation_uid_secondary`
- `activation_method`
- `setup_confirmed_at`
- `primary_device_type`
- `secondary_device_type`
- `assigned_agent_slug`
- `assigned_slot`
- `assigned_at`

Added/confirmed by:

- `sql/migrations/20260409_smart_sign_phase_1_1_cleanup.sql`
- `sql/migrations/20260423_device_assignment_slots.sql`

Rules:

- unique index on `activation_uid_primary` when not null
- unique index on `activation_uid_secondary` when not null
- trigger prevents the same UID from appearing as primary on one sign and secondary on another
- `assigned_slot` must be `1`, `2`, or `null`
- unique index:
  - `(assigned_agent_slug, assigned_slot)`
  - where both are not null

Meaning:

- one sign has one buyer-facing `public_code`
- one sign should also have two embedded sign-chip UIDs:
  - `activation_uid_primary`
  - `activation_uid_secondary`
- signs can be assigned to an agent and a sign slot

## `public.open_house_events`

Exact fields confirmed in repo/work session:

- `id`
- `smart_sign_id`
- `open_house_source_id`
- `resumed_from_event_id`
- `ended_at`
- `last_activity_at`
- `activation_uid_primary`
- `activation_uid_secondary`
- `activation_method`
- `setup_confirmed_at`
- `agent_slug`
- `status`
- `created_at`

Added/confirmed by:

- `sql/migrations/20260409_smart_sign_phase_1_1_cleanup.sql`
- app usage in `apps/rel8tion-app/src/api/events.js`

Rules:

- unique index:
  - one active event per sign
  - `(smart_sign_id)` where `ended_at is null`

Meaning:

- this is the live event binding table
- it connects a Smart Sign to a specific open house event state

## `public.smart_sign_scan_events`

Exact fields confirmed in repo/work session:

- `device_type`
- `agent_id`
- `agent_slug`

Added/confirmed by:

- `sql/migrations/20260409_smart_sign_phase_1_1_cleanup.sql`

Meaning:

- stores observed scan activity and device typing
- intended for smart sign / keychain / chip scan history and handshake logic

## `public.event_checkins`

Exact fields confirmed in repo/work session:

- `visitor_name`
- `visitor_phone`
- `visitor_email`
- `buyer_agent_name`
- `buyer_agent_phone`
- `buyer_agent_email`
- `pre_approved`
- `represented_buyer_confirmed`

Used by app code:

- `open_house_event_id`
- `visitor_type`
- `metadata`

Added/confirmed by:

- `sql/migrations/20260409_smart_sign_phase_1_1_cleanup.sql`
- `apps/rel8tion-app/src/api/events.js`
- `apps/rel8tion-app/src/modules/eventShell/bootstrap.js`

Meaning:

- this is the buyer/agent check-in capture layer for live events

## `public.agent_outreach_replies`

Exact definition provided during the work session:

- `id uuid primary key default gen_random_uuid()`
- `queue_row_id uuid references public.agent_outreach_queue(id) on delete set null`
- `open_house_id text`
- `from_phone text not null`
- `from_phone_normalized text not null`
- `to_phone text`
- `body text not null default ''`
- `message_sid text not null unique`
- `account_sid text`
- `direction text not null default 'inbound'`
- `opt_out boolean not null default false`
- `raw_payload jsonb not null default '{}'::jsonb`
- `received_at timestamptz not null default now()`
- `created_at timestamptz not null default now()`

Indexes supplied during session:

- `(queue_row_id, received_at desc)`
- `(from_phone_normalized, received_at desc)`
- `(open_house_id, received_at desc)`

## 2. App-Observed Tables / Columns

These are not fully defined in SQL inside the current repo, but the app directly depends on these columns.

## `public.agents`

Observed columns:

- `slug`
- `name`
- `phone`
- `phone_normalized`
- `email`
- `brokerage`
- `image_url`
- `bio`

Used by:

- claim flow
- chip routing follow-up
- event host display

## `public.open_houses`

Observed columns:

- `id`
- `address`
- `price`
- `brokerage`
- `image`
- `link`
- `open_start`
- `open_end`
- `agent`
- `agent_phone`
- `agent_email`

Used by:

- GPS listing detection
- sign resolver
- event shell

## `public.listing_agents`

Observed columns:

- `open_house_id`
- `name`
- `phone`
- `phone_normalized`
- `email`
- `brokerage`
- `primary_photo_url`
- `directory_photo_url`

Used by:

- agent verification/matching during claim

## `public.brokerages`

Observed columns:

- `name`
- `match_keywords`
- `logo_url`
- `primary_color`
- `accent_color`
- `bg_color`
- `text_color`
- `font_family`
- `button_style`

Used by:

- claim branding and brokerage matching

## `public.verified_profiles`

Observed columns:

- `uid`
- `slug`
- `is_active`
- `industry`
- `full_name`
- `title`
- `company_name`
- `phone`
- `email`
- `photo_url`
- `logo_url`
- `cta_url`
- `calendar_url`
- `bio`
- `areas`

Used by:

- `nmb-activate`
- `nmb-verified`

Related RPCs observed:

- `verified_profiles_lookup`
- `verified_profiles_activate_or_create`

## `public.agent_outreach_queue`

Observed / referenced:

- `id`
- `mockup_image_url`

Referenced by:

- outreach renderer app
- `agent_outreach_replies.queue_row_id`

## 3. Relationship Summary

Most important current relationships:

- `keys.agent_slug -> agents.slug`
- `smart_signs.assigned_agent_slug -> agents.slug`
- `open_house_events.smart_sign_id -> smart_signs.id`
- `open_house_events.open_house_source_id -> open_houses.id`
- `open_house_events.resumed_from_event_id -> open_house_events.id`
- `event_checkins.open_house_event_id -> open_house_events.id`
- `agent_outreach_replies.queue_row_id -> agent_outreach_queue.id`

## 4. Current Behavioral Model

### Chip layer

- `keys` represents physical claimed identity devices
- new slot model allows:
  - keychain slot `1`
  - keychain slot `2`

### Sign layer

- `smart_signs.public_code` is the public buyer-facing sign code
- each sign should also have:
  - `activation_uid_primary`
  - `activation_uid_secondary`
- these are the two embedded sign-chip UIDs

### Event layer

- `open_house_events` is the temporary live binding between:
  - sign
  - host
  - open house

### Check-in layer

- `event_checkins` captures:
  - buyer identity
  - buyer agent identity
  - representation state
  - financing state

### Outreach layer

- `agent_outreach_queue` and `agent_outreach_replies` support outbound and inbound follow-up logic

## 5. What The Schema Still Needs Later

Likely future additions:

- automatic dual-chip sign registration ceremony
- stronger normalized foreign keys for `assigned_agent_slug`
- explicit key ownership/assignment history
- sign inventory / shipping / beta device tracking
- more formal service-partner lead handoff tables
- admin/operator audit tables

## 6. Practical Schema Truth Right Now

Right now the most important working schema idea is:

- one physical Smart Sign should have:
  - one `smart_signs` row
  - one `public_code`
  - two registered embedded sign UIDs

And one agent should be able to have:

- two keychain slots
- two Smart Sign slots

That is the model the current app logic now expects.
