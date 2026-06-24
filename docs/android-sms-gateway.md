# Android SMS Gateway Fallback

Temporary A2P fallback for outreach volume. Twilio remains in place; use route-scoped provider env vars so outreach can run on Android while buyer/event/system messages stay on Twilio.

## Environment

Set these in Vercel/Supabase environments that send SMS:

```text
SMS_PROVIDER=twilio
SMS_OUTREACH_PROVIDER=android_gateway
SMS_EVENTS_PROVIDER=twilio
SMS_TWILIO_OUTREACH_BROKERAGES=Douglas Elliman

ANDROID_EVENTS_GATEWAY_URL=https://api.sms-gate.app
ANDROID_EVENTS_GATEWAY_USERNAME=
ANDROID_EVENTS_GATEWAY_PASSWORD=
ANDROID_EVENTS_GATEWAY_DEVICE_ID=

ANDROID_OUTREACH_GATEWAY_URL=https://api.sms-gate.app
ANDROID_OUTREACH_GATEWAY_USERNAME=
ANDROID_OUTREACH_GATEWAY_PASSWORD=
ANDROID_OUTREACH_GATEWAY_DEVICE_ID=

ANDROID_INBOUND_SIGNING_KEY=
ANDROID_INBOUND_WEBHOOK_SECRET=

ANDROID_INBOX_REPLAY_ENABLED=true
ANDROID_INBOX_REPLAY_ROUTES=outreach
ANDROID_INBOX_REPLAY_HOURS=3

TWILIO_ACCOUNT_SID=
TWILIO_AUTH_TOKEN=
TWILIO_PHONE=
```

Use the outreach device for general outreach traffic. Keep event/buyer/owner operational traffic on Twilio unless there is a provider outage. Brokerages listed in `SMS_TWILIO_OUTREACH_BROKERAGES` bypass the Android outreach route and send through Twilio/MMS. If Android is ever used for events too, use the events device and do not share one device across both routes.

To put all routes back on Twilio:

```text
SMS_PROVIDER=twilio
SMS_OUTREACH_PROVIDER=twilio
SMS_EVENTS_PROVIDER=twilio
```

When Twilio is active for any route, use `docs/twilio-outreach-sms-runbook.md` for the current number, inbound webhook, delivery-status callback, and verification steps. The sender number secret for this repo is `TWILIO_PHONE`; `TWILIO_FROM_NUMBER` is only an optional code fallback.

## Routing

Events device:

- `buyer_confirmation`
- `agent_checkin_alert`
- `loan_officer_alert`
- `buyer_loan_officer_intro`
- `owner_fallback_alert`
- `event_transactional`

Outreach device:

- `outreach`
- `outreach_followup`
- `demo_request`
- `manual_outreach`

Outreach sends are blocked from 9 PM to 8 AM America/New_York and always include `Reply STOP to opt out.`

## Inbound Webhook

Inbound URL:

```text
https://app.rel8tion.me/api/sms/android-inbound
```

Register with Android SMS Gateway:

```powershell
$username = "<ANDROID_USERNAME>"
$password = "<ANDROID_PASSWORD>"
$secret = "<ANDROID_INBOUND_WEBHOOK_SECRET>"
$pair = "${username}:${password}"
$auth = [Convert]::ToBase64String([Text.Encoding]::ASCII.GetBytes($pair))

Invoke-RestMethod `
  -Method Post `
  -Uri "https://api.sms-gate.app/3rdparty/v1/webhooks" `
  -Headers @{ Authorization = "Basic $auth" } `
  -ContentType "application/json" `
  -Body (@{
    url = "https://app.rel8tion.me/api/sms/android-inbound?secret=$secret"
  } | ConvertTo-Json)
```

The webhook logs inbound messages to `sms_inbound_messages`, stores STOP/UNSUBSCRIBE/CANCEL/END/QUIT in `sms_suppression_list`, and links outreach replies back to `agent_outreach_replies` when the phone matches an outreach queue row.

## Inbox Reconciliation

Android realtime webhooks should remain the primary inbound path, but production also has a reconciliation path so visible phone replies are not dependent on a single webhook event.

- Admin button: `POST https://app.rel8tion.me/api/admin/android-inbox-replay`
- Cron endpoint: `GET/POST https://app.rel8tion.me/api/cron/replay-android-inbox`
- Supabase Edge Function: `android-inbox-replay`
- Vercel Cron schedule: every 15 minutes
- Default route/window: outreach device, last 3 hours

The Vercel/admin endpoints call the Supabase Edge Function using the service-role token, so Android Gateway credentials stay in Supabase Function secrets. The Edge Function calls Android SMS Gateway:

```text
POST https://api.sms-gate.app/3rdparty/v1/messages/inbox/export
```

That endpoint exports recent inbox messages back through the registered `sms:received` webhook. It does not send outbound SMS. REL8TION de-dupes already linked replies before inserting raw inbound rows.

Outbound sends use the SMS Gateway cloud send endpoint:

```text
POST https://api.sms-gate.app/3rdparty/v1/messages
```

The adapter also accepts `ANDROID_*_GATEWAY_URL` values that already include `/3rdparty/v1` or `/3rdparty/v1/messages`.

## Test Send

Event/buyer route through the existing Supabase function:

```powershell
$anon = "<SUPABASE_ANON_KEY>"
Invoke-RestMethod `
  -Method Post `
  -Uri "https://nicanqrfqlbnlmnoernb.supabase.co/functions/v1/send-lead-sms" `
  -Headers @{ apikey = $anon; Authorization = "Bearer $anon" } `
  -ContentType "application/json" `
  -Body (@{
    agent_phone = "+13477758059"
    buyer_phone = "+13477758059"
    buyer_name = "Test Buyer"
    category = "buyer_confirmation"
    message = "Rel8tion Android Gateway event test."
  } | ConvertTo-Json)
```

Outreach route through the Edge Function:

```powershell
$service = "<SUPABASE_SERVICE_ROLE_KEY>"
Invoke-RestMethod `
  -Method Post `
  -Uri "https://nicanqrfqlbnlmnoernb.supabase.co/functions/v1/send-agent-manual-reply" `
  -Headers @{ apikey = $service; Authorization = "Bearer $service" } `
  -ContentType "application/json" `
  -Body (@{
    id = "<agent_outreach_queue_id>"
    body = "Rel8tion Android Gateway outreach test. Reply STOP to opt out."
  } | ConvertTo-Json)
```

Inbound webhook test:

```powershell
$secret = "<ANDROID_INBOUND_WEBHOOK_SECRET>"
Invoke-RestMethod `
  -Method Post `
  -Uri "https://app.rel8tion.me/api/sms/android-inbound?secret=$secret" `
  -ContentType "application/json" `
  -Body (@{
    from = "+15551234567"
    message = "STOP"
    deviceId = "<ANDROID_OUTREACH_GATEWAY_DEVICE_ID>"
    receivedAt = (Get-Date).ToUniversalTime().ToString("o")
  } | ConvertTo-Json)
```

## Database

Run migration:

```powershell
supabase db push --linked
```

Migration file:

```text
supabase/migrations/20260524034420_android_sms_gateway_fallback.sql
```
