i# REL8TION Current State Team Handoff

Generated: 2026-05-27

This handoff summarizes the current REL8TION product state for team members. It is based on the active repo files, live Vercel/Supabase checks performed during the May 2026 work session, and the current source-of-truth docs: `AGENTS.md`, `CURRENT_STATE.md`, and `REL8TION_SYSTEM_OVERVIEW.md`.

Status labels:

- `[IMPLEMENTED]` Code exists in the repo. It does not automatically prove live data, RLS, or deployment state.
- `[PARTIAL]` Some code exists, but the product behavior is incomplete or still needs operational hardening.
- `[INTENDED]` Product/business rule or target architecture.
- `[NEEDS VERIFICATION]` Verify live schema, deployed function, env, RLS, or third-party service state before relying on it.
- `[RISK]` Can affect production data, SMS, demos, compliance, payment, or user trust if handled casually.

## Executive Summary

REL8TION is a real estate open-house engagement platform built around physical NFC tags, printed QR codes, smart signs, Event Passes, agent dashboards, buyer check-in, disclosures, loan officer support, and SMS outreach.

The product is currently a Vercel/static app with Node serverless APIs, Supabase REST/RPC/database, Supabase Edge Functions, Stripe Checkout, and temporary Android SMS Gateway support while Twilio/A2P is pending.

Current production aliases include:

- `https://app.rel8tion.me`
- `https://irel8.me`
- `https://getrel8tion.com`
- `https://www.getrel8tion.com`

Production is configured to deploy from the `main` branch. `staging` exists as the staging/pre-production branch. Do not force-push either branch.

The root `https://app.rel8tion.me/` should show a production-safe Rel8tion entry page, not a Vercel smoke-test page, and should not expose an admin dashboard CTA. `getrel8tion.com/` redirects to the public Open House Kit landing.

## Physical Product Routing

### Agent Rel8tionChip

Status: `[PARTIAL]`

Agent chips now have two intended access paths:

- NFC private owner access: `https://irel8.me/k?uid=<uid>`
- Printed QR public profile access: `https://irel8.me/c/<chip_code>`

The NFC goes through `/k`, resolves the claimed `keys.uid`, and should open `/agent-home?agent=<slug>&uid=<uid>` after higher-priority flows are ruled out.

The printed QR goes through `/c/:code` or `/chip/:code`, resolves `rel8tion_chip_inventory`, and redirects to `/b?agent=<slug>` once linked. If it is unlinked, it shows a branded not-linked page and can carry the QR code into claim/dashboard linking.

Legacy `/a` may still redirect profile-style traffic into `/b`, but it is not the normal claimed NFC destination.

The first 1000 agent QR rows were seeded in live Supabase as batch `agent-keychain-001`, with URLs like `https://irel8.me/c/ra0018b9`.

### Smart Sign

Status: `[IMPLEMENTED]` / `[PARTIAL]`

Smart Signs use:

- Printed QR/public code resolved by `/s` or `/sign`.
- Front NFC buyer chip stored as `smart_signs.uid_primary` with `primary_device_type = front_buyer_chip`.
- Rear NFC agent chip stored as `smart_signs.uid_secondary` with `secondary_device_type = rear_agent_chip`.

The front chip routes buyers to check-in. The rear chip asks the agent to tap their Rel8tionChip keychain before opening the live event dashboard.

New QR inventory should come from `smart_sign_inventory.public_code`, not `smart_signs.public_code`.

### Event Pass

Status: `[IMPLEMENTED]`

Event Pass is a one-included-event open-house access product, sponsored by a loan officer. It is not an agent profile product and not a buyer lead-selling product.

Event Pass physical behavior:

- Printed QR uses `/pass?code=<public_code>`.
- QR starts setup and listing selection.
- NFC becomes `keys.device_role = event_pass_keychain`.
- Live Event Pass NFC taps open the event dashboard for that pass.

Current live schema still requires `smart_signs.uid_primary`, so Event Pass backing signs store the Event Pass NFC UID in `uid_primary` with `primary_device_type = event_pass_keychain`. Router code treats that value as a dashboard/keychain identity, not a buyer front chip.

Event Pass self-service reuse is intentionally blocked after prior event history unless LO/admin renews or resets the pass.

### Loan Officer / Verified Profile Chips

Status: `[PARTIAL]`

Verified loan officer tags resolve through `verified_profiles.uid`. Active LO scans can open `/lo-field-dashboard?uid=<uid>` directly unless an agent dashboard has armed a live-event sign-in, in which case the scan attaches the LO to the event first through `event_loan_officer_sessions`.

Formal remote LO coverage management is not fully built. Current support is scan/session based, with dashboard assignment helpers.

## Core Routes

- `/k`: universal NFC router. High-risk ordering logic.
- `/claim`: agent Rel8tionChip claim/profile flow.
- `/onboarding`: post-claim setup and backup keychain flow.
- `/agent-home`: permanent agent owner dashboard.
- `/b`: public agent profile/contact/lead page.
- `/sign-demo-activate`: Smart Sign and Event Pass setup/binding flow.
- `/s`, `/sign`: Smart Sign resolver.
- `/pass`: Event Pass resolver.
- `/event`: buyer check-in and disclosures.
- `/agent-dashboard`: live event dashboard.
- `/admin`: protected REL8TION COMMAND dashboard.
- `/manual-sms-outreach`: temporary manual SMS backup.
- `/sms-consent`: public first-party SMS consent page.
- `/get-open-house-kit`: Open House Kit landing.
- `/kit-confirm`, `/kit-intake`: Open House Kit keychain/manual intake flow.
- `/open-house-kit`: post-event kit checkout page.
- `/field-dashboard`, `/lo-field-dashboard`: field/loan officer operational dashboards.
- `/lo-affordability-guidance`: LO-only affordability guidance form.
- `/loan-officer-support`: public LO open-house-support request form.
- `/c/:code`, `/chip/:code`: public Rel8tionChip QR resolver.
- `/l/:id`: buyer listing link/property landing resolver.
- `/o/:id`: outreach preview page with Open Graph tags.

## Major Feature Areas

### Claim, Profile, And Photos

Status: `[IMPLEMENTED]`

Claim can activate a Rel8tionChip into an agent profile, use geolocation/open-house lookup, allow manual setup, detect existing phone/email profiles, and avoid silently overwriting an existing profile when the incoming name conflicts.

Profile edit uses `/claim?uid=<uid>&edit=profile` and updates the profile/photo without relinking the key, resending activation SMS, or restarting second-keychain prompts.

Photo upload tries `/api/agent-profile-photo` first, storing images in Supabase Storage bucket `agent-images`, then falls back to direct browser storage upload.

Profile display falls back from saved `agents.image_url` to `listing_agents.primary_photo_url` / `directory_photo_url` by phone or forgiving name match.

### Agent Home

Status: `[PARTIAL]`

`/agent-home` is the first permanent agent dashboard shell. It loads the agent profile, hosted open-house events, check-ins, disclosure packet links, buyer sync status, and buyer affordability/scenario counts.

It currently links to:

- Public QR profile
- Edit profile
- Activate Smart Sign
- Manage setup/onboarding
- Link My Keychain QR

Target future features include persistent event leads, compliance records, SMS drip campaigns, buyer follow-up, LO follow-up requests, social/review links, and gamified profile metrics.

### Buyer Event Check-In And Compliance

Status: `[IMPLEMENTED]` / `[PARTIAL]`

`/event` provides a buyer-first open-house check-in experience with property address/image, host agent photo/name/brokerage, name/phone inputs, optional email, and disclosure flow.

Required disclosure flow includes:

- New York State Agency Disclosure
- NYS Housing and Anti-Discrimination Disclosure
- Rel8tion Courtesy Notice

Evidence is stored in `event_checkins.metadata`. Signed disclosure packet PDF generation exists through `/api/compliance/ny-disclosure`, but storage bucket/env and legal/form review still need verification.

Buyer financing help is opt-in. Rel8tion does not preapprove buyers and does not make credit/approval decisions.

### Buyer Affordability Guidance / Property Fit Checker

Status: `[IMPLEMENTED]` / `[PARTIAL]`

Rel8tion stores limited loan-officer-entered affordability guidance so an agent can test property scenarios. The LO must have completed any actual preapproval outside Rel8tion.

Rel8tion must not collect or store SSN, income, paystubs, bank statements, assets, employment, liabilities, credit score/report data, AUS findings, preapproval letters, or borrower financial documents.

Allowed data includes buyer name/contact, LO-entered max monthly housing payment, optional purchase/loan guidance, assumptions, and agent-entered property scenarios.

Result labels must use:

- Looks Within LO Guidance
- Close - LO Review Recommended
- Outside Current LO Guidance
- LO Review Required

Never use approved, denied, preapproved by Rel8tion, or loan approved.

### Loan Officer Coverage

Status: `[PARTIAL]`

Live LO support uses `verified_profiles`, `event_loan_officer_sessions`, dashboard assignment, and field dashboard views.

LO dashboard can store availability windows and unavailable exceptions. Admin can assign, remove, or auto-assign live LO coverage. There is a default/fallback live-support display for agent dashboard when no LO is assigned.

`/loan-officer-support` is a public request form for loan officers who are available to assist agents with open-house support. It stores company/name/email/phone/coverage/availability/experience in `loan_officer_support_requests` through a server-side API, and REL8TION COMMAND shows those rows in the Loan officers area. The live submit path was smoke-tested on 2026-05-27 and the throwaway test row was deleted.

Formal remote request/accept workflows, hardened user auth, and full calendar conflict management are not complete.

### Outreach And SMS

Status: `[PARTIAL]` / `[RISK]`

Outreach uses `agent_outreach_queue`, enrichment, rendered outreach mockups, reply tracking, and admin inbox views.

Automatic outreach supports Twilio or Android SMS Gateway selected by route-scoped env. As of 2026-06-24, the intended active route is split by brokerage and operator mode:

- `SMS_PROVIDER=twilio`
- `SMS_OUTREACH_PROVIDER=android_gateway`
- `SMS_EVENTS_PROVIDER=twilio`
- `SMS_TWILIO_OUTREACH_BROKERAGES=Douglas Elliman`

Douglas Elliman outreach auto-sends through Twilio/MMS. Non-Douglas Elliman outreach waits for manual send when `rel8tion_runtime_settings.outreach_operator_mode` is `live`, and sends through Android Gateway when that mode is `away`. Keep buyer/event/owner operational messages on Twilio with `SMS_EVENTS_PROVIDER=twilio` unless there is a provider outage.

Important safety:

- Do not delete Twilio code.
- Do not send outreach during quiet hours.
- Do not silently mark SMS sent when provider fails.
- Outreach should include opt-out language.
- Manual admin replies are server-side and should show inbound/outbound conversation history in admin.

Manual SMS backup exists at `/manual-sms-outreach`. It opens the phone SMS app only; it does not call Twilio or auto-send.

### Open House Kit And Payments

Status: `[PARTIAL]`

`getrel8tion.com` hosts a no-navigation Open House Kit landing. It supports:

- I Have an Event Pass Keychain
- I Need My Open House Kit
- Monthly and annual service checkout CTAs

`/open-house-kit` is the closeout/upgrade page for agents after an Event Pass event. Stripe Checkout uses the one-time kit price plus required monthly or annual service option.

Checkout page copy explains 14-day delivery expectation, possible earlier delivery by Moe personally when scheduling allows, and Version 1 pricing/rate lock.

Live Stripe env/product configuration should be verified before relying on payment automation.

### REL8TION COMMAND Admin

Status: `[PARTIAL]`

`/admin` is the protected operator dashboard. It loads privileged data through server-side APIs and includes:

- Outreach replies and conversation threads
- Leads
- Agent CRM
- Smart Signs and Event Pass inventory views
- Active sign/event closeout
- Smart Sign detach-to-fresh controls
- Event Pass reset controls
- Loan officer assignment/removal
- Confirmed/accepted open house field visits
- Reports and printable PDF-style report export
- Drip scheduling
- Payments-needed setup view

Admin endpoints include:

- `/api/admin/dashboard`
- `/api/admin/outreach-inbox`
- `/api/admin/outreach-reply`
- `/api/admin/outreach-action`
- `/api/admin/event-action`
- `/api/admin/sign-action`
- `/api/admin/key-action`
- `/api/admin/loan-officer-assignment`

`/api/admin/key-action` includes a guarded `fresh_uid_everywhere` cleanup for bad NFC/Event Pass tests.

## Important Tables And Data Areas

- `keys`: physical NFC UID claim state and device role.
- `agents`: agent profile records.
- `rel8tion_chip_inventory`: printed agent QR inventory and QR-to-agent linking.
- `smart_sign_inventory`: printed Smart Sign/Event Pass QR inventory.
- `smart_signs`: backing device/sign records.
- `smart_sign_chip_aliases`: extra front/buyer NFC aliases.
- `smart_sign_activation_sessions`: scan/session handoff recovery.
- `open_house_events`: live/historical event records.
- `event_checkins`: event-specific buyer attendance and disclosure evidence.
- `leads`: global buyer/profile lead path.
- `buyers`: global buyer/person sync target.
- `buyer_affordability_guidance`: LO-entered guidance.
- `buyer_property_fit_scenarios`: agent-created property scenarios.
- `verified_profiles`: LO/professional profile/tag records.
- `event_loan_officer_sessions`: live LO coverage records.
- `field_demo_visits`, `field_demo_visit_participants`, `field_coverage_availability`: field/coverage workflow.
- `agent_outreach_queue`, `agent_outreach_replies`, `agent_outreach_inbox`: outreach and conversation state.
- `sms_message_log`, `sms_inbound_messages`, `sms_suppression_list`: SMS logging/inbound/suppression.
- `sms_consent_records`: public consent page records.

## Environment And Service Boundaries

Client-side app code uses the public Supabase anon key. Service role keys belong only in Vercel serverless APIs or Supabase Edge Functions.

Core Vercel env areas:

- Supabase: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`
- Admin auth: `KEY_RESET_ADMIN_TOKEN`, `ADMIN_KEYCHAIN_UIDS`
- Stripe: Stripe secret and price IDs for Open House Kit checkout
- Twilio: `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_PHONE`; current Twilio outreach recovery settings live in `docs/twilio-outreach-sms-runbook.md`
- SMS routing: `SMS_PROVIDER`, `SMS_OUTREACH_PROVIDER`, `SMS_EVENTS_PROVIDER`, `SMS_TWILIO_OUTREACH_BROKERAGES`
- Android Gateway: event and outreach gateway URLs, usernames, passwords, device IDs, inbound webhook secret/signing key
- Cron: `CRON_SECRET`, `CRON_SHARED_SECRET`

Do not put secrets in browser files.

## High-Risk Areas

- `/k` routing order. It decides all NFC behavior.
- Event Pass stale QR-to-NFC sessions. Stale browser/localStorage state can hijack fresh chips if guardrails are removed.
- `smart_signs.uid_primary` compatibility constraint. Event Pass currently stores its NFC UID there due live schema.
- Smart Sign front vs rear chip roles. Buyer-facing chips must not activate signs.
- Admin reset/cleanup endpoints. These can end events and clear sign/inventory state.
- Outreach sends. Bad filters can text real agents and damage trust.
- STOP suppression. Keep provider scoping clear while Android Gateway fallback is in use.
- Compliance disclosures. Legal/form review and signed PDF storage should be verified before making claims.
- RLS/schema cache errors. Browser direct writes rely on intended live policies.
- WordPress files. They are local tracking copies and are not automatically live.

## Known Gaps And Next Priorities

1. Run privileged live verification for RLS, schema, RPCs, Edge Functions, and Vercel Cron.
2. Harden auth for agent dashboard, LO dashboard, admin, and scenario review.
3. Confirm signed disclosure PDF storage and legal/form versions.
4. Finish paid-agent dashboard features: lead persistence, compliance search/export, drip campaigns, buyer follow-up, LO follow-up requests.
5. Build formal remote LO invite/request/accept workflow.
6. Improve billing/subscription records and post-payment provisioning.
7. Add broader admin inventory editing for agent QR, Smart Sign, Event Pass, and verified-profile QR batches.
8. Add automated E2E coverage for NFC/QR claim, sign activation, Event Pass, buyer check-in, SMS, and payments.

## Quick Testing Pointers

Static app local server:

```powershell
Set-Location apps/rel8tion-app
npm run dev
```

Mockup renderer tests:

```powershell
Set-Location apps/mockup-renderer
npm test
```

OneKey freshness dry run:

```powershell
npm run refresh:onekey:dry-run -- --id=M00000489-971018
```

QR inventory export:

```sql
select chip_code, qr_url
from public.rel8tion_chip_inventory
where chip_type = 'agent'
  and status = 'unassigned'
  and is_printed = false
order by created_at asc, chip_code asc
limit 1000;
```

## Team Rule Of Thumb

When touching production flows, update `CURRENT_STATE.md` immediately. If route behavior, schema expectations, NFC/QR behavior, SMS, dashboard behavior, compliance, payments, or architecture changes, update `REL8TION_SYSTEM_OVERVIEW.md` too. If future Codex sessions need the rule to avoid repeating mistakes, update `AGENTS.md`.
