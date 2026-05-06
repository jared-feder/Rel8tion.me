# Live Verification Checklist

Use this checklist before assuming the repo matches live Supabase or the currently configured Vercel app routes.

The automated script is read-only and should be run first:

```powershell
npm run verify:live
```

## Supabase Environment

- [ ] Confirm `SUPABASE_URL` points to the intended project.
- [ ] Confirm `SUPABASE_ANON_KEY` is present.
- [ ] Optional: confirm `SUPABASE_SERVICE_ROLE_KEY` is present only in a trusted local shell or secure CI context.
- [ ] Confirm the generated report did not print full keys.

## Tables

The verifier checks table exposure with zero-row PostgREST reads. If anon cannot prove a table exists, use service-role read-only verification or Supabase dashboard inspection.

- [ ] `agents`
- [ ] `keys`
- [ ] `open_houses`
- [ ] `listing_agents`
- [ ] `smart_sign_inventory`
- [ ] `smart_signs`
- [ ] `smart_sign_activation_sessions`
- [ ] `open_house_events`
- [ ] `event_checkins`
- [ ] `event_loan_officer_sessions`
- [ ] `verified_profiles`
- [ ] `leads`
- [ ] `agent_outreach_queue`
- [ ] `agent_outreach_replies`

## Important Columns

- [ ] `keys.uid`
- [ ] `keys.agent_slug`
- [ ] `keys.claimed`
- [ ] `keys.device_role`
- [ ] `keys.assigned_slot`
- [ ] `smart_signs.public_code`
- [ ] `smart_signs.uid_primary`
- [ ] `smart_signs.uid_secondary`
- [ ] `smart_signs.primary_device_type`
- [ ] `smart_signs.secondary_device_type`
- [ ] `smart_signs.owner_agent_slug`
- [ ] `smart_signs.assigned_agent_slug`
- [ ] `smart_signs.active_event_id`
- [ ] `smart_sign_inventory.public_code`
- [ ] `smart_sign_inventory.smart_sign_id`
- [ ] `open_house_events.smart_sign_id`
- [ ] `open_house_events.host_agent_slug`
- [ ] `open_house_events.open_house_source_id`
- [ ] `open_house_events.status`
- [ ] `open_house_events.ended_at`
- [ ] `event_checkins.open_house_event_id`
- [ ] `event_checkins.visitor_name`
- [ ] `event_checkins.visitor_phone`
- [ ] `event_checkins.pre_approved`
- [ ] `event_checkins.metadata`
- [ ] `event_loan_officer_sessions.open_house_event_id`
- [ ] `event_loan_officer_sessions.loan_officer_slug`
- [ ] `event_loan_officer_sessions.loan_officer_phone`
- [ ] `event_loan_officer_sessions.status`
- [ ] `verified_profiles.uid`
- [ ] `verified_profiles.slug`
- [ ] `verified_profiles.is_active`
- [ ] `leads.agent_slug`
- [ ] `leads.phone`
- [ ] `leads.preapproved`

## Relationships And Field Expectations

These are expected by current code and/or product rules. Formal foreign keys may need Supabase dashboard verification.

- [ ] `keys.agent_slug` maps to `agents.slug`.
- [ ] `smart_signs.public_code` maps the printed/public sign identity.
- [ ] `smart_sign_inventory.public_code` is the QR/public code inventory source used by activation.
- [ ] `smart_sign_inventory.smart_sign_id` links inventory to `smart_signs`.
- [ ] `smart_signs.uid_primary` is the front/buyer sign chip UID.
- [ ] `smart_signs.uid_secondary` is the rear/agent sign chip UID.
- [ ] `smart_signs.primary_device_type` identifies front/buyer role.
- [ ] `smart_signs.secondary_device_type` identifies rear/agent role.
- [ ] `smart_signs.owner_agent_slug` or `assigned_agent_slug` identifies sign ownership/assignment.
- [ ] `smart_signs.active_event_id` points to the current `open_house_events` row.
- [ ] `open_house_events.smart_sign_id` points back to the active sign.
- [ ] `open_house_events.host_agent_slug` identifies the hosting agent.
- [ ] `open_house_events.open_house_source_id` links to source listing/open house data when available.
- [ ] `open_house_events.status` and `ended_at` control active/inactive behavior.
- [ ] `event_checkins.open_house_event_id` links buyer attendance to the event.
- [ ] `event_loan_officer_sessions.open_house_event_id` links LO coverage to the event.
- [ ] `verified_profiles.uid` verifies an LO tag/keychain.
- [ ] `verified_profiles.slug` identifies the verified loan officer.
- [ ] `leads` is the global CRM/person table for `/b`.
- [ ] `event_checkins` is the event-specific attendance/action table for `/event`.

## RPCs

The script checks local references/definitions only. Live RPC existence needs Supabase verification.

- [ ] `find_nearest_open_house`
- [ ] `queue_recent_outreach_candidates`
- [ ] `verified_profiles_lookup`
- [ ] `verified_profiles_activate_or_create`

## Edge Functions

Do not call these from the verification script because they can mutate data, send SMS, or trigger sync/outreach side effects.

- [ ] `send-lead-sms`
- [ ] `twilio-inbound-router`
- [ ] `twilio-inbound-reply`
- [ ] `sync-openhouses`
- [ ] `generate-agent-outreach`
- [ ] `send-agent-outreach`
- [ ] `send-agent-manual-reply`

## Security And RLS

- [ ] Identify which tables can be checked with anon zero-row reads.
- [ ] Identify which tables require service-role schema confirmation.
- [ ] Review RLS policies in Supabase dashboard or SQL editor.
- [ ] Do not test RLS by inserting/updating/deleting production rows.
- [ ] Confirm browser-side writes still match RLS policy expectations.
- [ ] Confirm sensitive writes that should move behind Edge Functions are tracked as future hardening work.
- [ ] Confirm `event_loan_officer_sessions` RLS is safe before relying on it for public traffic.

## Product Rules To Preserve

- [ ] Front smart sign NFC equals buyer check-in.
- [ ] Rear smart sign NFC equals agent dashboard challenge only.
- [ ] Rear sign scan must be followed by agent keychain scan.
- [ ] Loan officer tag scan verifies event support.
- [ ] Buyer not preapproved should route to an active paired LO when present.
- [ ] WordPress is marketing/presentation, not the product brain.
- [ ] Vercel/app routes are product routes.
- [ ] Supabase sensitive writes should move through Edge Functions or serverless APIs as the system hardens.

## Data Model Warning

`/b` saves buyer profile leads into `leads`. `/event` saves event attendance/check-ins into `event_checkins`. These should be unified by treating `leads` as the global CRM/person record and `event_checkins` as the event-specific attendance/action record. This is not fully implemented yet.
