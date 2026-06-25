# Twilio Outreach SMS Runbook

Last verified: 2026-06-24.

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
- The shared SMS layer supports route-scoped provider selection with `SMS_OUTREACH_PROVIDER` and `SMS_EVENTS_PROVIDER`, falling back to `SMS_PROVIDER`.
- The outreach functions can pass a per-message provider override for brokerages listed in `SMS_TWILIO_OUTREACH_BROKERAGES`.

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
- Outreach volume risk: owner-approved automatic caps are `OUTREACH_SEND_MAX_PER_RUN=20`, `OUTREACH_SEND_MAX_PER_HOUR=20`, and `OUTREACH_SEND_MAX_PER_DAY=150`. The daily cap is enforced as a hard rolling-24-hour ceiling in `send-agent-outreach`. Do not raise these caps or route non-Douglas Elliman automated outreach through Twilio until the toll-free lane is intentionally added.

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
