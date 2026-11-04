# Agent nurture: offline preview foundation

Status: review-branch draft only. Not merged, deployed, connected to live data, or a sending funnel.

## Purpose

Produce a deterministic review list for existing worked-with agents without putting messages into an outbound queue. The module has no database client, network call, environment-variable read, provider integration, or write operation. Every result has `mode: preview_only` and `send_allowed: false`, including `review_ready` results. No result is delivery authorization.

Proposed first cycle, subject to owner review:

1. Day 0, SMS: Event Pass usage/support check-in.
2. Day 7, email: verified REL8TION news and aggregate stats.
3. Day 21, SMS: business/deal check-in, without referral payments or promises.
4. Day 35, email: practical Event Pass/open-house playbook.

This is one finite cycle. It does not automatically repeat, switch channels when consent is missing, or backfill missed messages in a burst. The preview adds a seven-day gap after all accepted outbound contact and a two-touch rolling 30-day limit per channel. These are conservative proposed nurture limits, not changes to existing approved outreach caps. Existing lower live caps always win.

## Inspected sources

Read-only baseline: `jared-feder/Rel8tion.me` commit `ad31361d5b1a22993def74736ab769151f04f392`.

- `api/admin/agent-relationships.js`: authenticated canonical relationship board, hydrated historical/worked-with evidence, human follow-up markers. Its summary omits `last_contact_at` and conversation detail; a summary-only export is not sufficient for a complete send-history review.
- `supabase/migrations/20260726193000_agent_relationship_stream.sql`: canonical relationship IDs, append-only relationship events and service-role-only `agent_board_v1`. Existing `worked_with_agent` includes engagement, confirmed houses, field visits, referrals and synchronization; it is relationship evidence, not marketing consent.
- `supabase/migrations/20260522002148_sms_consent_records.sql` and existing SMS consent page: event-related SMS consent. Do not repurpose this as authorization for recurring deal requests or promotional newsletters.
- `supabase/functions/_shared/sms.ts`: existing global SMS suppression, provider routing and New York quiet hours. Keep this enforcement layer for any future sends; do not route nurture as `event_transactional` or an internal operational alert.
- `supabase/functions/send-agent-outreach/index.ts`: sender pause, operator mode, health gates, duplicate cooldown and send ceilings. Those remain authoritative.
- `vercel.json`: current cron map. This draft adds no route or cron.

Source links:

- https://github.com/jared-feder/Rel8tion.me/blob/ad31361d5b1a22993def74736ab769151f04f392/api/admin/agent-relationships.js
- https://github.com/jared-feder/Rel8tion.me/blob/ad31361d5b1a22993def74736ab769151f04f392/supabase/migrations/20260522002148_sms_consent_records.sql
- https://github.com/jared-feder/Rel8tion.me/blob/ad31361d5b1a22993def74736ab769151f04f392/supabase/functions/_shared/sms.ts

## Input contract

The normalized structures below are a proposed interface, not claims that these tables or fields already exist in production. Only a trusted server-side adapter may produce them for an actual operator preview. This draft intentionally contains no such adapter.

Call `previewAgentNurture(input)` from `lib/agent-nurture-preview.js` with:

- `now`: explicit timestamp, fixed for the preview.
- `relationships`: complete canonical relationship-board rows, including `id`, `canonical_key`, `name`/`display_name`, `phone_normalized`/`phone`, `email`, `worked_with_agent`, `relationship_status`, `follow_up_marked`, and derived `open_conversation`. Require `identity_verified: true` with `identity_evidence_ref` from a person-specific identity review; having a phone-based canonical key is not itself proof of the person. Conflicting valid raw and normalized phone numbers are held. `open_conversation` must be an authoritative boolean from current inbound/human handling state; missing is blocked. Optional `timezone` adds recipient quiet-hour checking. SMS numbers must be US/NANP; unsupported formats are held.
- `enrollments`: owner-selected preview records with `id`, `relationship_id`, `campaign: agent-relationship-v1`, `enrolled_at`, `status: preview`. Missing, duplicate, paused, or active/live enrollments cannot activate anything. No enrollment writer is included.
- `consents`: evidence records with `id`, `relationship_id`, normalized `recipient`, `channel: sms|email`, exact `purpose: event_pass_support|rel8tion_updates|business_checkin`, `status: granted|revoked`, `explicit: true` for grants, `occurred_at`, `evidence_ref`, `disclosure_version`, and optional `expires_at`. Preserve grants and revocations. Exact latest purpose/channel/destination evidence wins; a simultaneous revocation blocks. A relationship, prior text reply, Event Pass purchase, event financing opt-in, or a generic `opted_in` flag is not enough.
- `suppressions`: effective current records with `channel: sms|email|all`, `recipient` and/or `relationship_id`, plus `active`. Missing `active` is treated as active; missing/invalid scope or target blocks the preview. Include global SMS STOP, channel unsubscribe, hard bounce/complaint, and relationship-level do-not-contact controls. Revocation events must remain in the consent history even if no current suppression record exists.
- `touches`: complete relevant history across all channels/campaigns with a stable attempt `id`, `relationship_id`, `direction`, `channel`, `occurred_at`, effective `status`, and campaign/enrollment/step IDs when applicable. Resolve provider terminal failures and deduplicate on provider attempt ID before normalizing status. Conflicting outcomes with the same ID block review. `accepted`, `queued`, and `sent` count toward collision avoidance without being presented as handset/inbox delivery. Unknown/submitting attempts across any campaign or enrollment block the next touch. Failed/uncertain attempts of the current step require reconciliation, not a blind retry.
- `sender_controls`: each channel's verified `paused`, `health_ok`, `capacity_available`; SMS also requires the current `operator_mode: away`. Values are never assumed healthy from missing data.
- `snapshot`: for each of `relationships`, `enrollments`, `consents`, `suppressions`, `touches`, `sender_controls`, provide `complete: true` and `checked_at` no older than five minutes. Paginated, filtered, failed, missing, or partial reads must not claim completeness. Inspect all canonical identities for shared-recipient collisions, not just selected enrollments.

The output intentionally omits contact destinations and message bodies. It includes relationship ID, next step/purpose, reasons for holds, earliest review time and a deterministic campaign/enrollment/step idempotency key. It cannot enqueue or dispatch a message.

## Remaining implementation before live use

1. Verify the live relationship, consent, suppression, inbound and delivery schemas through authorized read-only access. The repository alone does not prove production schema, RLS or current sender health.
2. Build a server-only adapter with full pagination and explicit partial-read failures. Do not expose service-role credentials to a browser. Source `open_conversation` from unresolved replies and human follow-up state, not a guess.
3. Add an auditable channel-and-purpose consent store/capture workflow and an email unsubscribe/complaint/bounce source. Do not backfill consent from having dealt with an agent. A message requesting consent is itself a communication and needs the appropriate authorization and permitted channel.
4. Review the target cohort, cadence, sender identity and copy with the owner. For news/stats, use a current dated source and explicit denominator; do not invent performance claims or expose buyer information. Email must have valid sender/contact information and a functioning unsubscribe path before release.
5. Implement a separate guarded dispatcher only after release authorization. It must re-read consent/suppression/control state immediately before a send, atomically claim idempotent work, reserve capacity under concurrency, preserve existing sender safeguards, and record provider acceptance separately from terminal delivery.
6. Wire inbound replies/STOP/unsubscribe to immediate campaign pause and human handoff. Reconcile unknown submissions using provider IDs before any retry. Do not fall back to another recipient or channel to evade a hold.
7. Test staging against isolated data and mocked providers. Repository notes warn that Vercel Preview can be connected to production Supabase; a preview deployment is not safe isolation by itself.

## Verification and scope

Run locally with Node (no dependencies or external requests):

    node --check lib/agent-nurture-preview.js
    node --test test/agent-nurture-preview.test.cjs

This verifies the new pure module only. The full application lint/typecheck/test suites, live data adapter, RLS, email infrastructure, provider dispatch, UI, deployment, and real delivery have not been tested or completed. No source file in the existing app, live database, queue, contact, sender setting, cron, or provider was modified.

AGENTS.md disposition: updated with the non-sending nurture invariant and exact-branch deployment guard. CURRENT_STATE.md and REL8TION_SYSTEM_OVERVIEW.md distinguish review foundations from live behavior.
