# Agent Outreach Pipeline

This repo owns the Vercel mockup renderer. The Supabase edge functions and the hot-list UI currently live outside this repo, but they need to follow the same queue contract so the overall workflow stays coherent.

## Target Flow

1. A new open-house row lands in `agent_outreach_queue`.
2. Enrichment fills in the agent name and phone.
3. `generate-agent-outreach` builds the SMS variants and follow-up copy.
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
- fix the missing `followup` value in `buildVariants()`
- set the queue into a renderer-ready state

Recommended output fields:

- `sms_variant_1`
- `sms_variant_2`
- `sms_variant_3`
- `selected_sms`
- `followup_sms`
- `sms_link`
- `followup_sms_link`
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
- `approved_for_send = true`
- `send_mode = "automatic"`
- `selected_sms` and `followup_sms` are already populated

It should not need to know how the image was generated.

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
