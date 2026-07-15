# Agent Outreach Pipeline

This repo owns the Vercel mockup renderer. The Supabase edge functions and the hot-list UI currently live outside this repo, but they need to follow the same queue contract so the overall workflow stays coherent.

## Target Flow

1. A new open-house row lands in `agent_outreach_queue`.
2. Enrichment fills in the agent name and phone.
3. `generate-agent-outreach` builds the initial SMS variants.
4. The Vercel Sharp renderer generates the personalized mockup image.
5. `rel8tion.me/hot-list` shows the real stored `mockup_image_url`, lets Jared edit/approve the texts, and then marks rows ready for send.
6. The send function delivers the approved messages on schedule.

## Vercel Renderer Contract

The Vercel renderer now assumes:

- `generation_status = "generated"`
- `send_status = "not_sent"`
- `mockup_image_url IS NULL` unless the request passes `force: true`

The render endpoint reads:

- `id`
- `agent_name`
- `brokerage`
- `address`
- `city`
- `state`
- `zip`
- `open_start`
- `open_end`
- `listing_photo_url`
- `agent_photo_url`

It writes back:

- `mockup_image_url`
- `mockup_status = "rendered"` or `"failed"`
- `mockup_rendered_at`
- `mockup_render_attempted_at`
- `mockup_render_error`
- `mockup_error`

## Required Supabase Changes

### `generate-agent-outreach`

This function should:

- stop treating image generation as a prompt-only step
- leave follow-up fields unscheduled while follow-ups are disabled for opt-out recovery
- set the queue into a renderer-ready state

Recommended output fields:

- `sms_variant_1`
- `sms_variant_2`
- `sms_variant_3`
- `selected_sms`
- `sms_link`
- `followup_sms = null`
- `followup_sms_link = null`
- `followup_send_status = "not_scheduled"`
- `followup_block_reason = "followups_disabled"`
- `generation_status = "generated"`
- `review_status = "pending"`
- `mockup_status = "pending"`
- `last_error = null`

This function should not be the place that stores a fake `image_prompt` as the source of truth for the renderer.

### Supabase Mockup Function

Retire the ImageScript mockup generator once the Vercel Sharp renderer is the chosen path.

Instead of generating images itself, the Supabase-side orchestration should call the Vercel endpoint:

- `POST /api/render-agent-mockup`
- include the shared secret header
- optionally pass `{ "limit": N }`
- optionally pass `{ "ids": ["..."], "force": true }` for manual rerenders

### Send Function

The send function should assume:

- mockup generation is already complete
- `send_mode = "automatic"`
- `selected_sms` is already populated

It should not require a hidden `approved_for_send` gate. Normal cron sends are eligible when the row is automatic, generated, rendered, due, has a listing photo, and has pending initial SMS copy. As of 2026-06-28, follow-up/drip sends are disabled while opt-out health is recovered; generator and sender code should keep follow-up rows unscheduled with `followup_block_reason = "followups_disabled"`.

Provider-specific recovery details live in `docs/twilio-outreach-sms-runbook.md` and `docs/android-sms-gateway.md`. The shared SMS layer supports `SMS_OUTREACH_PROVIDER` for outreach/manual outreach and `SMS_EVENTS_PROVIDER` for buyer/event/owner operational traffic, both falling back to `SMS_PROVIDER`. Production is configured with `SMS_OUTREACH_PROVIDER=twilio` through registered toll-free Messaging Service `MG8d7ec49cf1d6d231080b7f870a10eb0b`/`+18448211802`, while event/operational traffic remains on `+15168885461`. Outbound and inbound routing are verified and the global pause is off; only fresh eligible rows can enter the hard-capped recovery lane, while old manual backlog rows remain held.

When `rel8tion_runtime_settings.outreach_operator_mode` is `away`, ready outreach uses the configured automatic provider, currently the toll-free Twilio Messaging Service. `live` holds non-override rows for manual send. Android is now a deliberate fallback rather than the default Away provider.

During opt-out recovery, automatic outreach is hard-capped at 5 sends per run, 5 per rolling hour, and 5 per rolling 24 hours. A 30-day same-phone cooldown and rolling 7-day opt-out health gate apply before delivery; missed-open-house outreach older than 7 days is skipped, and the initial MMS flag is off by default.

Automatic outreach can be globally paused with `rel8tion_runtime_settings.key = "outreach_send_paused"` and a truthy JSON value such as `{ "paused": true }`, or with `OUTREACH_SEND_PAUSED=true`. When paused, live runs send nothing; authenticated dry runs can still inspect candidate routing, cooldowns, and message previews.

For Twilio-routed replies, the current sender secret is `TWILIO_PHONE`, inbound replies must enter through `twilio-inbound-router`, and Twilio Messaging Service inbound handling must be `Send a webhook`. For Android-routed outreach, inbound replies must arrive through the Android inbound webhook/replay path.

## Hot-List UI Changes

The hot-list page should show persisted state, not fabricate a different preview in the browser.

Recommended changes:

- remove the client-side fallback composition that overlays `JARED_SIGN_PNG` in the browser
- if `mockup_image_url` exists, show it
- if `mockup_image_url` is missing, show a neutral placeholder and a `mockup_status`
- remove or demote the old `image_prompt` display if the Vercel renderer is the source of truth
- rename the `Generate Pending` action so it reflects the actual workflow, or make it trigger both text generation and mockup rendering

Preferred button behavior:

- `Generate Pending`
  - calls `generate-agent-outreach`
  - then calls the Vercel renderer or the Supabase wrapper that invokes it

## Security Notes

These functions should not stay open to the public internet.

Recommended protections:

- require a shared secret or signed admin request for each edge function
- avoid direct anonymous browser updates unless RLS is explicitly designed for that admin workflow
- prefer authenticated server-side actions for approve, unapprove, skip, and mark-sent operations

## Manual Trigger Shapes

For manual rerenders, the Vercel renderer now supports request bodies shaped like:

```json
{ "limit": 10 }
```

```json
{ "ids": ["queue-row-uuid"], "force": true }
```
