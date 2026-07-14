# Twilio Outreach SMS Runbook

Last verified: 2026-07-14.

This is the durable recovery note for REL8TION outreach SMS. Keep this file in source control. Do not paste private Twilio auth tokens, Supabase service-role keys, or callback token values into this file.

## Current Verified Setup

- Live Twilio sender: `+15168885461`.
- Supabase sender secret: `TWILIO_PHONE`.
- Default provider secret: `SMS_PROVIDER=twilio`.
- Outreach provider secret: `SMS_OUTREACH_PROVIDER=android_gateway` so non-Douglas Elliman automated outreach does not use Twilio.
- Event/system provider override: set `SMS_EVENTS_PROVIDER=twilio`.
- Brokerage-specific Twilio/MMS override: set `SMS_TWILIO_OUTREACH_BROKERAGES=Douglas Elliman` so Douglas Elliman outreach auto-sends through Twilio/MMS.
- Runtime operator mode: REL8TION COMMAND stores `outreach_operator_mode` in `rel8tion_runtime_settings`; `live` makes non-Douglas Elliman rows wait for manual send, and `away` lets them send through Android Gateway.
- The code also accepts `TWILIO_FROM_NUMBER`, but this project currently uses `TWILIO_PHONE`.
- Existing `TWILIO_ACCOUNT_SID` and `TWILIO_AUTH_TOKEN` remain the account credentials unless the Twilio account/subaccount changes.
- `TWILIO_STATUS_CALLBACK_TOKEN` exists only as a Supabase secret. Rotate it with `supabase secrets set`; do not commit the token value.
- Automatic outreach is currently paused in `rel8tion_runtime_settings` for `opt_out_rate_recovery`. Keep it paused until the dedicated toll-free sender is verified and a dry run passes.

## Dedicated Toll-Free Outreach Target

Use a separate, verified, MMS-capable toll-free number for outreach and preserve `+15168885461` for buyer, event, check-in, owner, and other operational messages.

```text
SMS_PROVIDER=twilio
SMS_EVENTS_PROVIDER=twilio
SMS_OUTREACH_PROVIDER=twilio
TWILIO_EVENTS_FROM_NUMBER=+15168885461
TWILIO_OUTREACH_MESSAGING_SERVICE_SID=<verified toll-free Messaging Service SID>
```

`TWILIO_OUTREACH_FROM_NUMBER` can be used instead of a Messaging Service SID, but the Messaging Service is preferred. When `SMS_OUTREACH_PROVIDER=twilio`, the shared SMS layer requires a route-specific outreach sender and will not silently fall back to the regular event number. The toll-free sender must be verified for the actual outreach use case, present in the Messaging Service sender pool, support MMS if media will be enabled, and use the inbound router webhook below.

Do not enable `OUTREACH_INITIAL_MMS_ENABLED` for cold initial outreach. The default is plain SMS; send images only after a positive reply or for contacts with a documented permission basis. Android Gateway can automate text SMS and a preview link, but it cannot automate outbound MMS with the current provider.

## Twilio Console Settings

For the Twilio number or its Messaging Service, inbound messages must be configured as:

```text
Inbound messages: Send a webhook
Webhook URL: https://nicanqrfqlbnlmnoernb.supabase.co/functions/v1/twilio-inbound-router
Method: POST
Primary handler fails URL: https://nicanqrfqlbnlmnoernb.supabase.co/functions/v1/twilio-inbound-router
Primary handler fails method: POST
```

Do not leave the Messaging Service on `Receive the message`; that stores replies in Twilio logs/API but does not call REL8TION.

If the number is attached to a Messaging Service, check the service-level inbound settings. The Messaging Service can override the phone-number webhook.

For delivery status callbacks, use:

```text
https://nicanqrfqlbnlmnoernb.supabase.co/functions/v1/twilio-message-status?token=<TWILIO_STATUS_CALLBACK_TOKEN>
Method: POST
```

Use the real Supabase secret value for `TWILIO_STATUS_CALLBACK_TOKEN`; do not paste the placeholder text. Do not use the inbound router as the delivery-status URL.

## Supabase Edge Functions

- `twilio-inbound-router` is the public Twilio incoming-message webhook and must be deployed with JWT verification disabled.
- `twilio-inbound-router` forwards inbound payloads into `twilio-inbound-reply` using service-role auth.
- `twilio-inbound-reply` is protected and should not be used directly as the Twilio public webhook.
- `twilio-message-status` is protected by `TWILIO_STATUS_CALLBACK_TOKEN`.
- `send-agent-outreach` and `send-agent-manual-reply` build per-message status callback URLs for Twilio delivery events when the outreach route or brokerage override is using Twilio.
- `send-agent-manual-reply` may accept a service-role/admin `provider_override` of `twilio` for owner-approved manual outreach campaigns that must be sent through Twilio while preserving `manual_outreach` logging, STOP text, suppression checks, and reply threading.
- The shared SMS layer supports route-scoped provider selection with `SMS_OUTREACH_PROVIDER` and `SMS_EVENTS_PROVIDER`, falling back to `SMS_PROVIDER`.
- The outreach functions can pass a per-message provider override for brokerages listed in `SMS_TWILIO_OUTREACH_BROKERAGES`.
- Suppression checks are global across Twilio and Android. A STOP captured on either provider blocks both routes, and a suppression-query failure blocks the send instead of failing open.
- Twilio `OptOutType=STOP` and exact STOP keywords suppress the phone globally. Exact `START`/`UNSTOP` removes the application suppression; old queue rows are not automatically requeued.
- Initial outreach has a 30-day same-phone cooldown by default (`OUTREACH_DUPLICATE_PHONE_COOLDOWN_DAYS`).
- The sender has a rolling health gate: 7-day window, at least 20 outreach sends, and a default 1% maximum opt-out rate. Configure with `OUTREACH_HEALTH_WINDOW_DAYS`, `OUTREACH_HEALTH_MIN_SENDS`, and `OUTREACH_MAX_OPT_OUT_RATE` only after review.

Inbound behavior:

- Matched replies link to `agent_outreach_queue` by tolerant 10/11-digit phone matching.
- Unmatched replies are still stored in `agent_outreach_replies` with `queue_row_id=null`.
- The owner alert text beginning `Rel8tion outreach reply` is expected; it means the inbound reply was captured and an operational alert was sent.

## Verified 2026-06-23

Outbound smoke test:

- Sent through `send-lead-sms`.
- Provider returned `twilio`.
- From: `+15168885461`.
- To: owner phone.
- Twilio SID: `SMc744e5b260bf022c6ba429342ea0e98c`.
- Status: `queued`.

Inbound reply test:

- Reply body: `how about now`.
- From: owner phone.
- To: `+15168885461`.
- Saved in `agent_outreach_replies` at `2026-06-23 13:49:58 UTC`.
- Matched queue row: `b674dd8f-99f1-40f7-9ec2-403634b3571c`.
- Matched address: `14 Sequoia Cir, Manhasset, NY 11030`.
- Queue review status updated to `replied`.
- Owner alert queued with SID `SM1e0b3ee4b579a2d1b161885dcf6fcc7c`.

## Common Failure Modes

- Outbound works but inbound does not: Twilio Messaging Service is probably set to `Receive the message` instead of `Send a webhook`, or the Messaging Service is overriding the phone-number webhook.
- Inbound webhook returns `401`: Twilio is pointed directly at `twilio-inbound-reply` instead of `twilio-inbound-router`, or the router was deployed with JWT verification enabled.
- Inbound saves but does not match a queue row: check `agent_phone_normalized` values. The router/reply handler now searches both 10-digit and 11-digit forms.
- Delivery status callback fails: use `twilio-message-status?token=<TWILIO_STATUS_CALLBACK_TOKEN>` with `POST`; do not use the inbound router.
- Outreach volume risk: the historical owner-approved ceilings were 7 per run, 20 per hour, and 150 per day. Recovery code now enforces stricter hard caps of `OUTREACH_SEND_MAX_PER_RUN=5`, `OUTREACH_SEND_MAX_PER_HOUR=5`, and `OUTREACH_SEND_MAX_PER_DAY=5`, regardless of older higher secret values. Review every reply before expanding and do not raise the recovery caps without explicit owner approval and provider health review.
- Missed-open-house outreach older than 7 days is skipped by default (`OUTREACH_MISSED_OPEN_HOUSE_MAX_AGE_DAYS`) so unpausing cannot drain an old backlog.
- Emergency pause: set `rel8tion_runtime_settings.key='outreach_send_paused'` to a truthy JSON value such as `{ "paused": true }`, or set `OUTREACH_SEND_PAUSED=true`. The send cron can still fire, but `send-agent-outreach` will return `paused=true` and send nothing.
- Recovery/manual generation: while that pause is truthy, `generate-agent-outreach` stages newly generated rows as `send_mode=manual`, `review_status=manual_ready`, so new outreach is available for cell sending instead of automatic sender pickup.
- Manual cell-send backup: `/manual-sms-outreach` is a protected static page backed by `/api/manual-sms-outreach`. It opens the local SMS composer and then lets the operator mark sent/skipped; it does not call Twilio or Android Gateway directly, and it does not exclude Douglas Elliman rows that are otherwise manual-ready.

## 2026-07-14 Recovery Audit

- Live runtime remains paused with reason `opt_out_rate_recovery`.
- Last 30 days contained 222 logged outreach/manual-outreach sends and 8 recorded opt-outs, about 3.6%. This is above the healthy target and is why the backlog must not be released at once.
- The live queue contained 523 pending initial rows during the audit. A restart must select a small fresh pilot; never unpause the entire backlog without rechecking freshness, suppression, cooldown, and consent/relationship basis.
- Existing suppression rows were provider-scoped (7 Android, 8 Twilio). The shared send check is now provider-agnostic so all 15 block both delivery paths.

## Quick Verification Queries

Recent inbound replies:

```sql
select r.id, r.queue_row_id, r.from_phone, r.to_phone, r.body, r.received_at,
       q.agent_name, q.address, q.review_status
from public.agent_outreach_replies r
left join public.agent_outreach_queue q on q.id = r.queue_row_id
where r.received_at >= now() - interval '30 minutes'
order by r.received_at desc
limit 20;
```

Recent SMS log:

```sql
select provider, route, category, to_phone, status, external_id, error, created_at
from public.sms_message_log
where created_at >= now() - interval '30 minutes'
order by created_at desc
limit 20;
```
