# REL8TION System Overview

Last inspected: 2026-05-09.

This document describes the implementation currently present in the repository. It intentionally separates confirmed implementation from inferred or unverified behavior.

Status labels used in this file:

- `[IMPLEMENTED]` means code exists in the repo. It does not guarantee that the feature is deployed, live, passing RLS, or working with current Supabase production data.
- `[PARTIAL]` means some code exists, but the complete product behavior is not built or not fully wired.
- `[INTENDED]` means this is a REL8TION business/product rule or target architecture, not proof of current implementation.
- `[NEEDS VERIFICATION]` means the repo is not enough to prove live behavior, deployment, schema, RLS, or external service state.
- `[RISK]` means this can break demos, production data, security, SMS, or user trust if handled casually.

## [IMPLEMENTED] Current Live Code Anchor

- `[IMPLEMENTED]` Production is configured to deploy from the `main` branch through Vercel Git production branch automation.
- `[IMPLEMENTED]` Vercel API inspection confirms project Git `productionBranch = main` and the current ready production deployment is aliased to `app.rel8tion.me`.
- `[IMPLEMENTED]` The `/event` cloud background and fixed disclosure modal fix was verified live after `main` commit `c8789ae` (`Fix event disclosure modals and cloud styling`).
- `[IMPLEMENTED]` `staging` exists as the preview/staging branch and currently points to the same reconciled commit as `main`.
- `[IMPLEMENTED]` The previous direct/dirty production deploy from `modular-claim-test` commit `51d2d1a` is preserved by tag `production-51d2d1a-2026-05-08`.

## Product Purpose

REL8TION is a low-friction real estate engagement system built around physical NFC tags and smart open house signs.

The current product connects:

- `[IMPLEMENTED]` agent Rel8tionChip/keychain identity
- `[IMPLEMENTED]` smart signs with a printed QR code/public code
- `[IMPLEMENTED]` front NFC buyer check-in chip
- `[IMPLEMENTED]` rear NFC agent dashboard challenge chip
- `[IMPLEMENTED]` live open house event records
- `[IMPLEMENTED]` buyer check-ins and preapproval routing
- `[PARTIAL]` SMS follow-up through Twilio/Supabase functions; `send-lead-sms` source is checked in and user-reported active, but deployed source/version matching and SMS behavior still need live verification
- `[PARTIAL]` local/present NMB loan officer tag scan and live event coverage
- `[PARTIAL]` agent outreach/enrichment data for booking demos and appointments
- `[INTENDED]` Formal remote LO coverage management is not built: no invite/request/accept workflow, no remote availability queue, no scheduled coverage assignment, and no persistent agent-LO relationship management. Current LO support is scan/session based.
- `[NEEDS VERIFICATION]` Browserless/Trulia enrichment was not found in tracked source during the 2026-05-09 audit. The current tracked enrichment implementation is Estately + Cheerio.

The implementation is deliberately lightweight: static Vercel pages, direct Supabase REST/RPC calls from browser code where allowed by policy, and serverless or Edge Functions for privileged actions.

## Deployment And Runtime Layout

### Root Vercel App

The root `vercel.json` has `cleanUrls: true` and rewrites most app routes into `apps/rel8tion-app`.

`[IMPLEMENTED]` Confirmed root rewrites:

- `/claim` to `apps/rel8tion-app/claim.html`
- `/onboarding` to `apps/rel8tion-app/onboarding.html`
- `/sign-demo-activate` to `apps/rel8tion-app/sign-demo-activate.html`
- `/k` to `apps/rel8tion-app/k.html`
- `/key-reset` to `apps/rel8tion-app/key-reset.html`
- `/s` and `/sign` to `apps/rel8tion-app/sign.html`
- `/event` to `apps/rel8tion-app/event.html`
- `/agent-dashboard` to `apps/rel8tion-app/agent-dashboard.html`
- `/admin` to `apps/rel8tion-app/admin.html`
- `/nmb-activate` and `/nmb-verified` to app pages
- `/services/nmb/activate` and `/services/nmb/verified` to app pages

The root also has static `a.html` and `b.html`. They are not explicitly rewritten in root `vercel.json`, but with clean URLs they appear intended to serve `/a` and `/b`.

`[RISK]` Other root files include marketing/static pages and legacy/test pages. Examples:

- `agents.html` redirects to `https://rel8tion.info/claim` and does not match the current app rewrite pattern.
- `claim-test.html`, `claim2.html`, `ClaimFinalNeedsWording0406.html`, `event-shell-test.html`, `sign-view-test.html`, `sign-pair-test.html`, and `open-house-demo-shell.html` appear to be historical or test artifacts.
- `smart-sign/` contains a small API helper for `open_house_events` and `event_checkins`, but current root Vercel rewrites do not route to that folder directly.
- `openai/Rel8tion.info/` appears to contain older/static exported page copies.

Use the configured rewrites and current app files before using these legacy files as implementation references.

### Main Static App

`apps/rel8tion-app` is a static browser app. Its `package.json` runs:

```powershell
npx serve .
```

It uses:

- plain HTML pages
- inline browser JavaScript in several pages
- ES modules under `apps/rel8tion-app/src`
- Tailwind CDN on several pages
- Supabase REST/RPC calls with a public anon key

### Root API Routes

`[IMPLEMENTED]` Confirmed root Vercel serverless routes:

- `api/admin/reset-key.js`
- `api/cron/enrich-agents.js`

### Supabase Edge Functions

`[IMPLEMENTED]` Confirmed checked-in Edge Functions under `supabase/functions`:

- `twilio-inbound-router`
- `twilio-inbound-reply`

`[NEEDS VERIFICATION]` Reference function source exists under `docs/supabase-functions`, but deployment is not confirmed from the repo alone.

### Mockup Renderer App

`apps/mockup-renderer` is a separate Vercel-style app for outreach image generation and cron wrappers.

It has:

- `api/cron-generate.ts`
- `api/cron-render.ts`
- `api/cron-send.ts`
- `api/render-agent-mockup.ts`
- `lib/*`
- Vitest tests for phone utilities
- its own `vercel.json` with cron schedules

## Route And Page Map

### `/k`

File: `apps/rel8tion-app/k.html`.

Role: universal NFC router.

Inputs:

- `uid`
- optional `code` or `sign_code`

Important localStorage keys:

- `rel8tion_host_session`
- `rel8tion_pending_sign_activation`
- `rel8tion_sign_demo_session`
- `rel8tion_agent_dashboard_pending`
- `rel8tion_loan_officer_pending`
- `rel8tion_key_reset_pending`

`[IMPLEMENTED]` Confirmed repo behavior:

1. If reset mode is armed, route the scanned UID to `/key-reset.html?uid=...`.
2. If UID matches an active sign front chip, route to the live sign route `/s?code=<publicCode>`.
3. If UID matches an active sign rear chip, store an agent dashboard challenge and ask the user to tap the agent keychain.
4. If a loan officer dashboard sign-in is pending and no rear-sign agent dashboard challenge is being satisfied, verify the UID against `verified_profiles` and create or update `event_loan_officer_sessions`.
5. If no `keys` row exists, treat the UID as an unclaimed keychain/sign chip depending on sign activation session state.
6. If a claimed keychain exists, resume pending sign activation, satisfy dashboard challenge, or route the agent to `/a?agent=<slug>&uid=<uid>`.

`[IMPLEMENTED]` Router priority rule: rear-sign agent dashboard verification takes precedence over loan-officer sign-in state. When a rear sign chip is tapped, `/k` clears stale `rel8tion_loan_officer_pending` browser state before asking for the agent keychain, so the agent keychain cannot be hijacked into `/nmb-activate` during dashboard verification.

`[IMPLEMENTED]` Router priority rule: sign activation chip scans take precedence over backup-keychain linking. If a sign activation session is waiting for front/rear sign chips, `/k` continues sign activation before considering any pending backup-keychain session, so a fresh sign chip cannot be stored as an agent keychain.

### `/claim`

Files:

- `apps/rel8tion-app/claim.html`
- `apps/rel8tion-app/src/modules/claimStyled/bootstrap.js`
- `apps/rel8tion-app/src/modules/claimStyled/flow.js`
- `apps/rel8tion-app/src/modules/claimStyled/renderer.js`

Role: claim a Rel8tionChip/keychain into an agent identity.

`[IMPLEMENTED]` Confirmed repo behavior:

- Loads `uid` from the URL.
- Detects existing `keys` row by UID.
- If key is claimed, routes or displays the claimed agent state.
- Uses geolocation and `find_nearest_open_house` to find possible listings.
- Can search/select an open house and infer agent data from `listing_agents` or `open_houses`.
- Normalizes listing-agent profile data before showing the "Is This You?" confirmation. Placeholder names such as `Agent`, `Listing Agent`, `Unknown Agent`, and `Real Estate Agent` are not treated as real names, and the flow tries to recover the best enriched `listing_agents` profile by open house or phone before asking the user to confirm.
- Can manually save full profile data.
- Upserts into `agents`.
- Updates/inserts `keys` with claimed state and `agent_slug`.
- Sends activation SMS through `send-lead-sms`.
- Saves a short host session after verification.
- Stores the selected open house in the host session when the agent selected one during claim/onboarding.
- Routes to `/onboarding` or back to pending `/sign-demo-activate`.

Beta support:

- Special beta keychain UID `7ce5a51b-8202-4178-afc7-40a2e10e2a4d`.
- Beta menu can reset the test sign lane, continue setup, reset last beta trial, or restore `main-beta`.
- The protected beta sign lane is keychain UID `7ce5a51b-8202-4178-afc7-40a2e10e2a4d`, sign public code `0e4b015f3782`, front chip UID `f005e166-70b3-407c-ba24-b91464a3d22a`, and rear chip UID `b70d2bde-d185-43ee-8962-083b64fa4347`.
- Beta fresh-claim cleanup clears stale browser host/sign activation sessions. Inactive sign QR scans preserve the current host session so the just-claimed keychain profile carries into sign activation instead of falling back to stale `agent-*` context.
- The beta keychain router expires stale local sign-activation state and sends standalone beta keychain scans to the beta claim/reset menu before consulting remote pending activation sessions. Fresh local sign handshakes still continue when the browser is actively in that setup flow.
- Beta sign QR resolution and `/sign-demo-activate` treat the live scanned keychain row (`keys.uid -> keys.agent_slug`) as the source of truth over stale URL `agent` parameters, stale host sessions, or stale local sign-demo browser sessions. The beta sign public code ignores a remembered host session unless it belongs to the protected beta keychain UID.
- Once a real typed beta keychain profile is saved, the claim flow treats that profile as the locked identity for the activation run. Listing selection can still provide property/event context, but stale `listing_agents` or `open_houses.agent` values should not replace the typed profile.

### `/onboarding`

File: `apps/rel8tion-app/onboarding.html`.

Role: simple post-claim agent setup page.

`[IMPLEMENTED]` Confirmed repo behavior:

- Reads `agent` and `uid` from URL.
- If UID is missing, tries to recover a claimed key for the agent from `keys`.
- Saves host session.
- Shows activation entry point for smart signs.
- Activation URL is `/sign-demo-activate.html?agent=<agent>&uid=<uid>`.
- Live profile URL is `/a?agent=<agent>`.
- Shows claimed keychain slots for the agent.
- Prompts agents who have exactly one keychain to choose whether they have a second keychain before moving to smart sign activation.
- Can arm an "Add Backup Keychain" flow; the next scanned Rel8tionChip is linked through `/k` to the same `agent_slug` as `device_role = keychain` with `assigned_slot` 1 or 2.
- Stores backup-keychain pending state locally and as a short-lived `smart_sign_activation_sessions` row with a `backup-keychain-` public-code prefix. This exists because mobile NFC popups can open `/k` in a new tab/browser context where same-tab localStorage is unavailable.
- Blocks smart sign activation while a backup-keychain scan is armed so the agent must finish or cancel the second-keychain intent first.

### `/sign-demo-activate`

File: `apps/rel8tion-app/sign-demo-activate.html`.

Role: smart sign activation and binding flow.

`[IMPLEMENTED]` Confirmed repo stages:

1. Verify agent keychain or resume a pending session.
2. Scan or enter sign QR/public code.
3. Resolve `smart_sign_inventory.public_code`.
4. Create or find `smart_signs`.
5. Tap front chip, stored as buyer chip in `uid_primary`.
6. Tap rear chip, stored as agent chip in `uid_secondary`.
7. Tap the agent keychain again for handshake.
8. Offer the open house selected during keychain claim first when `rel8tion_host_session.selectedOpenHouse` is present.
9. Find/select listing with loose location and date rules, search fallback, or manual listing fallback.
10. Create or update `open_house_events`.
11. Patch `smart_signs` active state and `active_event_id`.
12. Mark activation session completed and clear local session.
13. Optionally arm or manually link an extra front/buyer NFC chip UID to the same sign through `smart_sign_chip_aliases`.

`[IMPLEMENTED]` The visible activation flow loads the agent row and displays agent name/brokerage where available, instead of making the raw slug the primary visible identity.

QR handling:

- Uses `BarcodeDetector` if available.
- Uses `jsQR` CDN fallback for camera/photo QR decoding.
- Accepts manual code entry.
- Extracts public code from raw code or URL.
- Resolves `smart_sign_inventory.public_code` first. If an inventory row already points to `smart_sign_id`, the activation flow uses that canonical sign row.
- After a sign is activated, the success screen can link an extra physical front/buyer NFC chip to the same `smart_sign_id` through `smart_sign_chip_aliases`. This is for another NFC chip only; it is not a second QR-code setup path and does not replace the rear agent dashboard chip.

Listing binding:

- Uses RPC `find_nearest_open_house`.
- Adds a tight local fallback search from approximately now minus 12 hours to now plus 7 days.
- Recomputes listing distance from `lat`/`lng` on the client, compares listing dates in `America/New_York`, and ranks closest active/upcoming listings first. Time looseness is retained for active/open-soon status, but distance/locality stays ahead of time so farther borough listings do not outrank nearby Oceanside-area rows.
- Allows manual listing fallback when no listing can be found.

Current field names:

- Event host field is `host_agent_slug`.
- Older references to `agent_slug` on `open_house_events` are wrong for the current schema.

### `/s` And `/sign`

Files:

- `apps/rel8tion-app/sign.html`
- `apps/rel8tion-app/src/modules/signResolver/bootstrap.js`
- `apps/rel8tion-app/src/modules/signResolver/*`

Role: public smart sign resolver.

`[IMPLEMENTED]` Confirmed repo behavior:

- Reads `code` from URL.
- Resolves smart sign by `smart_signs.public_code`, then falls back to `smart_sign_inventory.public_code -> smart_sign_id` so an inventory/public-code alias can open the same canonical sign.
- If no sign exists, routes to `/sign-demo-activate.html?code=<code>&fresh_qr=1`.
- If sign has an active event, redirects to `/event?event=<eventId>`.
- If sign exists but has no active event, renders "Sign Found" and activation options.
- If no host session exists, it stores pending sign activation and prompts the agent to tap their Rel8tionChip/keychain.
- If host session exists, it can activate the sign to a nearby/listed house.
- For the beta sign lane, stale host/session identity is not trusted. The resolver either uses the beta keychain's current live `keys.agent_slug` or asks for the keychain scan again.

### `/event`

Files:

- `apps/rel8tion-app/event.html`
- `apps/rel8tion-app/src/modules/eventShell/bootstrap.js`

Role: smart sign live buyer check-in page.

Inputs:

- `event`
- optionally sign/code depending on redirect path

`[IMPLEMENTED]` Confirmed repo behavior:

- Loads `open_house_events`.
- Loads linked `open_houses` via `open_house_source_id` when present.
- Loads agent profile by `host_agent_slug`.
- Attempts fallback agent photo lookup from the current agent object, local prefilled profile when it matches the host slug, and `listing_agents`.
- Builds a buyer-first welcome screen with a formatted "Welcome to" property-address header, property image when available, hosted-by agent photo/name/brokerage, compact top check-in path buttons, and immediate name/phone/pre-approval inputs on buyer-facing paths. Email is optional.
- Uses the Rel8tion cloud background layer from the current app styling.
- Applies matched brokerage theme colors/fonts through the `brokerages` lookup when a brokerage match is available; otherwise falls back to Rel8tion defaults.
- Shows host contact/save-contact actions only after successful check-in.
- Shows "CHECK IN HERE" with small buyer path choices at the top of the check-in card so buyers can choose Buyer, With Agent, or Agent before entering details.
- Inserts check-ins into `event_checkins`.
- Requires a single guided disclosure modal before buyer-facing check-in submit: New York State Agency Disclosure, NYS Housing and Anti-Discrimination Disclosure review, Rel8tion Courtesy Notice, lending consent when applicable, then final acknowledgement checkbox. V1 explicitly documents that the listing agent may currently represent the seller; it does not expose dual agency or imply buyer representation. The `buyer_agent` path skips pre-approval and disclosure prompts.
- Blocks disclosure signing until the buyer/check-in name exists, then uses that name as the prefilled electronic signature for the final acknowledgement.
- Opens guided disclosure Review & Sign dialogs as fixed viewport overlays instead of leaving the dialogs at the bottom of the long buyer page.
- Saves agency/courtesy acknowledgement details in `event_checkins.metadata`, including signed timestamps, PDF URL/version/type, root convenience fields, and nested `nys_agency_disclosure` / `rel8tion_courtesy_notice` objects.
- Requires buyer disclosure completion before check-in submit: official NYS Housing and Anti-Discrimination Disclosure form link is shown, the checkbox acknowledgement is accepted, and the buyer check-in name is available as the prefilled electronic signature.
- Uses configurable `NYS_HOUSING_ANTI_DISCRIMINATION_DISCLOSURE_PDF_URL`, defaulting to the REL8TION-hosted Supabase Storage copy of the NYS Housing and Anti-Discrimination Disclosure PDF.
- Keeps the official DOS form page as the source-of-truth reference in config/docs.
- Opens a server-generated prefilled disclosure PDF preview through `/api/compliance/ny-disclosure?event=...`.
- Saves DOS-2156 `11/25` acknowledgement details in `event_checkins.metadata.ny_discrimination_disclosure` for MVP.
- After check-in, attempts to generate a signed REL8TION disclosure packet PDF covering the NYS Agency Disclosure, NYS Housing and Anti-Discrimination acknowledgement, and Rel8tion Courtesy Notice. It attaches `signed_pdf` storage/download metadata under `event_checkins.metadata.ny_discrimination_disclosure`.
- Sends buyer and agent SMS through `send-lead-sms` only after local check-in validation passes.
- Asks for pre-approval status on buyer-facing paths. After disclosures, the guided modal shows the second-opinion lending prompt when the buyer selected `yes`; when the buyer selected `no`, the financing follow-up checkbox is optional. Selecting "not pre-approved" alone does not trigger financing SMS.
- When financing help is requested, the code routes to a live loan officer if assigned or alerts Jared. The current buyer UI hides unfinished loan-officer support cards and uses a temporary post-check-in financing SMS prompt to `347-775-8059`.
- After check-in, shows property snapshot, a short host agent bio/contact card, save-contact actions, SMS message links, and neighborhood/financing prompts. It no longer shows OneKey listing links, internal buyer status cards, loan-officer support cards, a second check-in button, or the one-of-three preferred property examples.
- `[INTENDED]` A richer buyer dashboard with external listing-site/Zillow-style media, neighborhood data, and persistent buyer-agent-loan-officer chat is not built. Current implementation uses available stored listing data plus call/SMS links.

Check-in paths:

- `buyer`
- `buyer_with_agent`
- `buyer_agent`

Required check-in fields vary by path. The code validates visitor name and phone for all paths, keeps visitor email optional, validates pre-approval status plus disclosure signatures on buyer-facing paths, and validates buyer-agent details where needed. The `buyer_agent` path skips pre-approval and NYS/Rel8tion disclosure prompts.

### `/agent-dashboard`

File: `apps/rel8tion-app/agent-dashboard.html`.

Role: live event dashboard for the host agent.

Inputs:

- `agent`
- optional `uid`
- optional `event`
- optional `sign_id`
- optional `code`

`[IMPLEMENTED]` Confirmed repo behavior:

- Loads sign by ID or public code.
- Loads event from explicit `event`, sign active event, or most recent active event for sign.
- Verifies event host matches the `agent` parameter.
- Loads linked open house.
- Loads recent `event_checkins`.
- Loads `agent_outreach_queue` rows for the listing.
- Loads live `event_loan_officer_sessions`.
- Shows stats for check-ins, financing needs, outreach, and relationship stage.
- Shows lead cards with call/text actions, agency/housing/courtesy disclosure signed/missing status, and an `Open Disclosure Packet PDF` action when the signed disclosure packet can be generated or stored.
- Shows loan officer coverage card.
- Can end the current open house without deleting check-ins by marking the event ended, stamping `ended_at`, clearing the sign's `active_event_id`, and setting the sign inactive.
- The dashboard request helper supports PATCH/POST/DELETE options, so End/Move controls perform live Supabase writes instead of read-only requests.
- Can move the same sign to another open house by closing the current event and opening sign activation for the next listing.
- Can arm loan officer sign-in by writing `rel8tion_loan_officer_pending` and prompting a loan officer tag scan.

### `/nmb-activate`

File: `apps/rel8tion-app/nmb-activate.html`.

Role: activate or edit a loan officer/NMB verified profile tied to a chip UID.

`[IMPLEMENTED]` Confirmed repo behavior:

- Requires `uid`.
- Calls RPC `verified_profiles_lookup`.
- If active profile exists, routes to `/nmb-verified?slug=<slug>`.
- Uploads headshot to Supabase Storage bucket `verified-assets`.
- Calls RPC `verified_profiles_activate_or_create`.
- Captures profile fields including name, title, company, phone, email, photo, CTA URL, calendar URL, bio, and areas.

### `/nmb-verified`

File: `apps/rel8tion-app/nmb-verified.html`.

Role: public verified loan officer profile.

`[IMPLEMENTED]` Confirmed repo behavior:

- Loads `verified_profiles` by slug and `is_active = true`.
- Shows photo, company logo, contact info, areas, bio, call/text, VCard, CTA, and calendar actions.

### `/key-reset`

Files:

- `apps/rel8tion-app/key-reset.html`
- `api/admin/reset-key.js`

Role: temporary admin/beta tool for scanning and resetting keys/sign pairings. This is `[PARTIAL]` admin tooling, not a complete admin dashboard.

`[PARTIAL]` Confirmed repo behavior:

- Browser page stores admin token in localStorage.
- Can arm scan mode for `/k`.
- API supports GET lookup by UID.
- API supports POST actions:
  - `delete`
  - `unclaim`
  - `reset_sign_pairing`
- Uses service role on server.
- Refuses protected Elena/Galluzzo signs unless code is changed.
- Refuses active sign reset unless `forceActive = true`.

### `/a` And `/b`

Files:

- `a.html`
- `b.html`

Role: agent buyer/profile lead capture path for claimed keychains.

`[IMPLEMENTED]` Confirmed repo behavior:

- `/a` reads `agent` and optional `uid`, then redirects to `/b?agent=<agent>&uid=<uid>`.
- `/b` loads `agents` by slug.
- `/b` tries geolocation against RPC `find_nearest_open_house`.
- `/b` uses `listing_agents` as a fallback for agent photo.
- `/b` inserts buyer leads into `leads`.
- `/b` sends an agent SMS and buyer confirmation SMS through `send-lead-sms`.
- `/b` includes multi-area selection and price ranges including `1M-2M` and `2M+`.
- `/b` shows a post-submit property preference modal with three static example homes.

This is separate from the smart sign `/event` check-in flow.

`[PARTIAL]` Data-model warning: `/b` saves buyer profile leads into `leads`. `/event` saves event attendance/check-ins into `event_checkins`. These should be unified by treating `leads` as the global CRM/person record and `event_checkins` as the event-specific attendance/action record. This is not fully implemented yet.

## NFC Flow Summary

### Agent Keychain Handshake

1. Keychain chip opens `/k?uid=<uid>`.
2. `/k` looks up `keys`.
3. If unclaimed, route to `/claim?uid=<uid>`.
4. If claimed, save a short host session and route to the appropriate pending flow or `/a`.
5. In sign activation, the keychain is scanned before or after QR depending on entry point and again for the final handshake.

### Front NFC Buyer Check-In

1. Front sign chip opens `/k?uid=<frontChipUid>`.
2. `/k` detects matching active `smart_signs.uid_primary`.
3. `/k` routes to `/s?code=<publicCode>`.
4. `/s` resolves the active event.
5. Buyer lands on `/event?event=<eventId>`.
6. Buyer sees the property-address welcome, agent/property imagery, host context, compact relationship path buttons, and immediate name/phone/pre-approval inputs before contact actions. Email is optional.
7. Buyer-facing paths review/sign the NYS Agency Disclosure and Rel8tion Courtesy Notice, accept the NYS Housing and Anti-Discrimination Disclosure, then answer optional lending follow-up consent inside the guided modal. The `buyer_agent` path skips pre-approval and disclosure prompts.
8. Buyer completes check-in; SMS notifications are sent only after validation and save.

### Rear NFC Agent Dashboard Challenge

1. Rear sign chip opens `/k?uid=<rearChipUid>`.
2. `/k` detects matching active `smart_signs.uid_secondary`.
3. `/k` stores `rel8tion_agent_dashboard_pending`.
4. The page prompts for the agent keychain.
5. Agent taps keychain.
6. `/k` verifies keychain owner against event/sign ownership.
7. Agent is sent to `/agent-dashboard`.

### Loan Officer Tag Verification

1. Agent dashboard button arms `rel8tion_loan_officer_pending`.
2. Loan officer taps their tag/keychain.
3. `/k` checks `verified_profiles` for `uid` and `is_active = true`.
4. If missing, route to `/nmb-activate?uid=<uid>`.
5. If active, insert or update `event_loan_officer_sessions` as `status = live`.
6. Dashboard shows the live loan officer.

`[PARTIAL]` Current limitation: this is a present/local scan flow. Formal remote LO coverage management is `[INTENDED]` but not implemented in current app code: no invite/request/accept workflow, no remote availability queue, no scheduled coverage assignment, and no persistent agent-LO relationship management. Current LO support is scan/session based.

## Buyer Preapproval Routing

The smart sign event page validates buyer preapproval/financing status during check-in.

`[IMPLEMENTED]` Confirmed behavior in `eventShell/bootstrap.js`:

- Buyer check-in is saved first to `event_checkins`.
- NYS disclosure acknowledgement validation happens before the check-in insert and before any SMS notification calls.
- Signed NYS disclosure PDF generation is attempted after the check-in is saved. Failures are logged and do not block SMS notifications.
- Agent SMS is sent with buyer details.
- Buyer confirmation SMS is sent.
- If financing help is requested, the code checks `event_loan_officer_sessions` for a live loan officer. Selecting "not pre-approved" without opting into follow-up does not trigger financing outreach.
- If a live loan officer exists and has a phone number:
  - send financing alert to the loan officer
  - send loan officer intro SMS to the buyer
- If no live loan officer is available:
  - send Jared financing alert using the hardcoded owner phone in `notifications.js`

## Database Tables And Expected Relationships

This section combines confirmed SQL files and confirmed table usage in code. When a base table definition was not present, the relationship is marked inferred.

### `agents`

`[PARTIAL]` Confirmed from code usage, full schema needs verification.

Used for:

- claimed agent profiles
- slug lookup
- name, phone, email, brokerage, social links, photo/image URL
- `/b` buyer profile display
- `/event` host display
- `/claim` profile upsert

Relationships:

- `keys.agent_slug` stores the agent slug.
- `open_house_events.host_agent_slug` stores the event host slug.

### `keys`

`[IMPLEMENTED]` Confirmed from code usage and migration.

Used for:

- agent keychain identity
- claimed/unclaimed state
- `uid`
- `agent_slug`
- `device_role`
- `assigned_slot`

Relationships:

- `keys.agent_slug` references `agents.slug` by convention. Formal FK needs verification.

### `open_houses`

`[PARTIAL]` Confirmed from code usage, full schema needs verification.

Used for:

- MLS/open house listing source data
- location and time matching
- listing details for sign activation and buyer event pages
- enrichment state

Important fields used in code:

- `id`
- `source`
- `address`
- `price`
- `beds`
- `baths`
- `sqft` or `square_feet`
- `taxes`
- `brokerage`
- `agent`
- `agent_phone`
- `agent_scraped`
- `agent_enriched`
- `open_start`
- `open_end`
- photo/link fields such as `image`, `image_url`, `listing_photo_url`, `primary_photo_url`, `onekey_url`
- `[PARTIAL]` listing freshness fields from `sql/migrations/20260509_open_house_freshness.sql`: `last_verified_at`, `last_verified_source`, `source_price`, `source_price_verified_at`, `price_last_changed_at`, `manual_price_override`, `manual_price_override_at`, `manual_price_override_by`, `freshness_status`, and `freshness_notes`. Code support exists and anon zero-row schema verification passed live on 2026-05-09; privileged RLS/service-role behavior remains `[NEEDS VERIFICATION]`.

### `open_house_price_history`

`[PARTIAL]` Migration and worker support exist. Live anon zero-row schema verification passed on 2026-05-09; privileged RLS/service-role behavior remains `[NEEDS VERIFICATION]`.

Used for:

- append-only audit of detected listing price changes
- proving old price, source price, displayed price, source, and detection timestamp
- preserving a source snapshot when OneKey changes are detected

Important fields:

- `open_house_id`
- `old_price`
- `new_price`
- `source_price`
- `displayed_price`
- `source`
- `change_reason`
- `source_snapshot`
- `detected_at`

### `listing_agents`

`[IMPLEMENTED]` Confirmed from Estately worker and app usage.

Used for:

- enriched listing agent data
- photo fallback
- outreach candidates

Important fields inferred from code:

- `open_house_id`
- `name`
- `brokerage`
- `phone`
- `phone_normalized`
- `email`
- `source`
- `primary_photo_url`
- `directory_photo_url`

Expected dedupe:

- `(open_house_id, phone_normalized)`

### `smart_sign_inventory`

`[IMPLEMENTED]` Confirmed from sign activation code and SQL references.

Used for:

- printed sign QR/public code inventory
- public code resolution before sign row exists
- optional link to `smart_signs.id`
- legacy public-code aliasing when more than one printed inventory row points to the same `smart_sign_id`
- claimed state

Important fields:

- `id`
- `public_code`
- `smart_sign_id`
- `claimed_at`

### `smart_signs`

`[IMPLEMENTED]` Confirmed from app code and migrations.

Used for:

- physical smart sign identity
- public code
- front/rear NFC chip UIDs
- owner agent
- active event link
- activation metadata

Important fields:

- `id`
- `public_code`
- `uid_primary`
- `uid_secondary`
- `activation_uid_primary`
- `activation_uid_secondary`
- `primary_device_type`
- `secondary_device_type`
- `owner_agent_slug`
- `assigned_agent_slug`
- `assigned_slot`
- `active_event_id`
- `status`
- `setup_confirmed_at`
- `deactivated_at`

Expected relationships:

- `smart_signs.active_event_id` references `open_house_events.id` by convention. Formal FK needs verification.
- `open_house_events.smart_sign_id` references `smart_signs.id`.
- `smart_sign_inventory.smart_sign_id` references `smart_signs.id`.

### `smart_sign_chip_aliases`

`[PARTIAL]` Implemented in repo migration `sql/migrations/20260509_smart_sign_chip_aliases.sql`; live Supabase application remains `[NEEDS VERIFICATION]`.

Used for:

- optional extra physical front/buyer NFC chip UIDs for the same sign
- routing extra buyer NFC scans through `/k` to the same public sign route
- keeping rear/agent dashboard access restricted to `smart_signs.uid_secondary`

Important fields:

- `id`
- `smart_sign_id`
- `uid`
- `device_type`
- `label`
- `active`
- `created_by_agent_slug`

Expected relationships:

- `smart_sign_chip_aliases.smart_sign_id` references `smart_signs.id` with cascade delete in the repo migration.
- `device_type` is currently restricted to `front_buyer_chip`; alias chips must not open the rear dashboard challenge.

### `smart_sign_activation_sessions`

Confirmed in `sql/smart-sign-activation-sessions-2026-05-03.sql`.

Used for:

- cross-scan remote state when QR/keychain/chips are scanned in different browser contexts
- iPhone handoff resilience
- session recovery from `/k`

Important fields:

- `public_code`
- `sign_id`
- `inventory_id`
- `agent_key_uid`
- `agent_slug`
- `owner_agent_slug`
- `stage`
- `primary_chip_uid`
- `secondary_chip_uid`
- `status`
- `expires_at`

Stages:

- `waiting_for_agent_keychain`
- `waiting_for_sign_code`
- `waiting_for_sign_chip_1`
- `waiting_for_second_sign_chip`
- `waiting_for_handshake`
- `handshake_complete`
- `completed`
- `cancelled`

RLS:

- SQL enables RLS and allows public anon/auth select, insert, and update only for pending, unexpired sessions.

### `open_house_events`

Confirmed in migration and app usage.

Used for:

- live binding between a smart sign and a specific open house/listing/manual event
- source of truth for smart sign event check-ins

Important fields:

- `id`
- `open_house_source_id`
- `smart_sign_id`
- `host_agent_slug`
- `status`
- `start_time`
- `end_time`
- `ended_at`
- `last_activity_at`
- `activation_uid_primary`
- `activation_uid_secondary`
- `activation_method`
- `setup_confirmed_at`
- `setup_context`
- `resumed_from_event_id`

Important constraint:

- SQL creates a unique index so each sign has only one active event where `ended_at is null`.

### `event_checkins`

Confirmed in migration and event code.

Used for:

- buyer check-ins tied to live smart sign events
- buyer agent disclosure
- NYS agency disclosure acknowledgement
- Rel8tion courtesy notice acknowledgement
- preapproval state
- preference metadata

Important fields:

- `open_house_event_id`
- `visitor_type`
- `visitor_name`
- `visitor_phone`
- `visitor_email`
- `buyer_agent_name`
- `buyer_agent_phone`
- `buyer_agent_email`
- `pre_approved`
- `represented_buyer_confirmed`
- `metadata`
- `metadata.nys_agency_disclosure` stores the New York State Agency Disclosure accept/sign event, including seller representation acknowledgement, signed timestamp, PDF URL, disclosure version, disclosure type, typed signer name, e-signature type, and user agent.
- `metadata.rel8tion_courtesy_notice` stores the Rel8tion Courtesy Notice accept/sign event, including acknowledgement flag, signed timestamp, typed signer name, e-signature type, and user agent.
- Root metadata also includes convenience fields for `agency_disclosure_reviewed`, `seller_representation_acknowledged`, `agency_disclosure_signed_at`, `agency_disclosure_pdf_url`, `agency_disclosure_version`, `agency_disclosure_type`, `rel8tion_courtesy_acknowledged`, and `rel8tion_courtesy_signed_at`.
- `metadata.ny_discrimination_disclosure` stores MVP NYS Housing and Anti-Discrimination Disclosure acknowledgement details, including DOS-2156 `11/25` form metadata, provided-by agent/brokerage, consumer role, acknowledgement/review/e-sign flags, checkbox-plus-prefilled-name signature, timestamp/date, and user agent.
- `metadata.ny_discrimination_disclosure.signed_pdf` stores signed PDF status/path metadata when the server-side generation/upload succeeds.

Expected relationship:

- `event_checkins.open_house_event_id` references `open_house_events.id`.

### `event_loan_officer_sessions`

Confirmed in `sql/event-loan-officer-sessions-2026-05-03.sql`.

Used for:

- live loan officer coverage attached to an event

Important fields:

- `open_house_event_id`
- `verified_profile_uid`
- `loan_officer_uid`
- `loan_officer_slug`
- `loan_officer_name`
- `loan_officer_phone`
- `loan_officer_email`
- `loan_officer_photo_url`
- `company_name`
- `status`
- `signed_in_at`
- `ended_at`

Important constraint:

- Unique index allows one live loan officer per event.

Security note:

- SQL grants select, insert, and update to anon/authenticated. RLS enablement for this table was not present in the inspected SQL and needs live verification.

### `verified_profiles`

`[PARTIAL]` Confirmed from NMB pages and SQL references. This covers local verified profiles, not remote loan officer invitation management.

Used for:

- loan officer verified tag/profile lookup
- public verified loan officer profile

Important fields inferred from code:

- `uid`
- `slug`
- `is_active`
- `full_name`
- `title`
- `company_name`
- `phone`
- `email`
- `headshot_url`
- `company_logo_url`
- `cta_url`
- `calendar_url`
- `bio`
- `areas`

### `leads`

`[IMPLEMENTED]` Confirmed from root `b.html`.

Used for:

- agent profile buyer lead form outside the smart sign event flow

Important fields inferred from insert:

- `name`
- `phone`
- `email`
- `areas`
- `price`
- `notes`
- `preapproved`
- `consent`
- `agent_slug`
- `chip_uid`
- `property_address`
- `property_price`

### Outreach Tables

`[IMPLEMENTED]` Confirmed tables/functions:

- `agent_outreach_queue`
- `agent_outreach_replies`
- `agent_outreach_inbox` view

Used for:

- enriched agent outreach
- outbound status and follow-up
- inbound Twilio replies
- WordPress hot-list visibility
- dashboard outreach count
- mockup renderer status/image URL

The exact live queue schema is broader than the SQL files inspected and needs verification before migrations.

## Supabase Functions And RPCs

### Latest Live Verification Result

`[PARTIAL]` Latest anon verification run on 2026-05-09 completed successfully with summary `PASS 79`, `WARN 6`, `NEEDS_VERIFICATION 11`, `FAIL 0`.

Confirmed by that run:

- Core tables and expected columns passed anon zero-row schema probes.
- This confirms live schema exposure through the anon PostgREST access path.

Still not confirmed:

- Full RLS correctness or write behavior.
- Privileged schema checks; service role was not used.
- RPC definitions for `find_nearest_open_house`, `queue_recent_outreach_candidates`, `verified_profiles_lookup`, and `verified_profiles_activate_or_create`.
- `send-lead-sms`; local source is present, but the verifier intentionally does not call SMS functions.
- Edge Function deployment for source under `docs/supabase-functions`.
- Vercel Cron state; root `vercel.json` has no `crons` block, so dashboard verification is still required.
- Full production data quality and write-path health.
- Vercel dashboard Git production-branch setting.

### Checked-In Edge Functions

`supabase/functions/twilio-inbound-router/index.ts`

- Receives Twilio inbound webhook.
- Forwards to configured `OUTREACH_INBOUND_REPLY_URL` or default `twilio-inbound-reply`.
- Does not write DB itself.

`supabase/functions/twilio-inbound-reply/index.ts`

- Uses service role.
- Normalizes inbound phone.
- Upserts into `agent_outreach_replies` by `message_sid`.
- Finds latest matching `agent_outreach_queue` row.
- Marks opted-out or replied rows.
- Blocks follow-up after reply/opt-out.
- Sends owner alert through Twilio for new non-negative replies.

### `send-lead-sms`

- Called by browser code for activation SMS, buyer/agent check-in SMS, loan officer alerts, and `/b` profile SMS.
- `[IMPLEMENTED]` Local source is checked in at `supabase/functions/send-lead-sms/index.ts`.
- `[PARTIAL]` User reports the deployed function has been active and working for months.
- `[NEEDS VERIFICATION]` Supabase dashboard/source matching and Twilio payload behavior should be verified before changing the SMS contract.

### `/api/compliance/ny-disclosure`

File: `api/compliance/ny-disclosure.js`.

`[IMPLEMENTED]` Confirmed repo behavior:

- `GET ?event=<eventId>` returns a prefilled REL8TION disclosure packet with a REL8TION cover page, Rel8tion Courtesy Notice page, and source form pages when available.
- `POST { checkin_id }` generates a signed disclosure packet from the saved check-in acknowledgement metadata.
- Signed PDF upload uses Supabase Storage through server-side `SUPABASE_SERVICE_ROLE_KEY`.
- Signed PDF metadata is patched back into `event_checkins.metadata.ny_discrimination_disclosure.signed_pdf`.
- New signed packet PDF objects use broker-readable event paths/filenames and store audit fields including document hash, event/check-in IDs, property address, buyer name, generated timestamp, packet version, storage path, and source form references.
- `GET ?checkin=<checkinId>&download=1` returns the stored signed packet when available or regenerates one from metadata. Legacy one-form signed PDFs are regenerated as full packets when opened.

`[NEEDS VERIFICATION]` Live behavior depends on Vercel env vars `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, and an existing `SIGNED_DISCLOSURE_BUCKET` bucket or the default `signed-disclosures` bucket.

### Reference Function Source Under `docs/supabase-functions`

These files exist as repo reference material, but deployment is not confirmed:

- `sync-openhouses.ts`
- `generate-agent-outreach.ts`
- `send-agent-outreach.ts`
- `send-agent-manual-reply.ts`
- `twilio-inbound-router.ts`
- `twilio-inbound-reply.ts`

Observed behavior in reference source:

- `sync-openhouses` pulls OneKey data and restores enriched agent contact data from `listing_agents`.
- `generate-agent-outreach` queues and generates outreach rows.
- `send-agent-outreach` sends outbound SMS with quiet hours, invalid phone handling, opt-out handling, follow-up status, and expiration rules.
- `send-agent-manual-reply` sends manual replies from outreach UI.

### RPCs Used By Current Code

Definitions were not found in checked-in SQL:

- `find_nearest_open_house`
- `queue_recent_outreach_candidates`
- `verified_profiles_lookup`
- `verified_profiles_activate_or_create`

These need live Supabase verification before schema changes or refactors.

## Estately Enrichment Pipeline

Files:

- `estately-enrichment-worker.cjs`
- `api/cron/enrich-agents.js`

`[IMPLEMENTED]` Confirmed worker behavior:

- Uses `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`.
- Processes `open_houses` where `agent_scraped = false` and `source = onekey`.
- Current batch size is 20.
- Prioritizes upcoming/next-weekend listings before backlog.
- Normalizes addresses into Estately URL slugs.
- Attempts direct Estately URL.
- Falls back to Estately search.
- Parses the listing page with Cheerio.
- Looks for a `div.panel` containing "Listing provided by".
- Extracts name, brokerage, and tel phone.
- Normalizes phone.
- Skips insert if phone is missing.
- Avoids known bad phones based on `agent_outreach_queue`.
- Inserts/updates `listing_agents` by open house and normalized phone.
- Does not overwrite existing valid data when merging.
- Updates `open_houses.agent_scraped` and `agent_enriched`.
- Fills `open_houses.agent` and `agent_phone` only if blank.
- Calls RPC `queue_recent_outreach_candidates`.
- Attempts to trigger `generate-agent-outreach`.

Endpoint:

- `api/cron/enrich-agents.js` imports the worker and returns JSON.

Important current config note:

- `[PARTIAL]` Root `vercel.json` schedules the OneKey freshness endpoint, but does not schedule the Estately enrichment endpoint. Vercel dashboard/deployed cron state remains `[NEEDS VERIFICATION]`.

## OneKey Listing Freshness Pipeline

Files:

- `onekey-freshness-worker.cjs`
- `api/cron/refresh-open-house-data.js`
- `sql/migrations/20260509_open_house_freshness.sql`

`[IMPLEMENTED]` Confirmed worker behavior:

- Uses `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` for writes.
- Dry runs may use `SUPABASE_ANON_KEY` and do not write to Supabase.
- Prioritizes active sign event listings, then upcoming OneKey open houses.
- Looks up current OneKey listing data by a tight lat/lng search box.
- Matches the source row by exact `UniqueListingId`; address match is a fallback.
- Updates listing facts including price, beds, baths, square feet, brokerage, image, and coordinates.
- Does not overwrite `open_start` / `open_end` from the source freshness pass, because active demo/event windows may be manually corrected.
- Supports `manual_price_override`; when present, source price is recorded but the display price is preserved.
- Inserts `open_house_price_history` rows for detected price changes when the migration exists.
- Refreshes active `open_house_events.setup_context.price` so live sign pages and dashboards do not disagree with the linked `open_houses` row.

Endpoint and cron:

- `api/cron/refresh-open-house-data.js` imports the worker and returns JSON.
- Root `vercel.json` schedules `/api/cron/refresh-open-house-data` every 30 minutes.
- Vercel production deployment for `main` commit `9fa417d` includes the route as serverless function `api/cron/refresh-open-house-data`. A safe `HEAD` smoke check returned `405`, confirming the route exists without running the write path.

`[NEEDS VERIFICATION]` Cron execution, service-role env state, and RLS behavior still need live verification before treating the pipeline as fully operational. The additive Supabase schema migration was applied and anon zero-row schema probes passed on 2026-05-09.

`[IMPLEMENTED]` `M00000489-971018` / `703 Neptune Blvd` now accepts OneKey as source of truth: `price = source_price = 1399998`, `manual_price_override = null`, and `freshness_status = verified`. A privileged SQL check confirmed price-history audit rows for the correction from stale `$1,450,000` through the temporary manual display and then back to the OneKey source price.

## Twilio And SMS Logic

`[IMPLEMENTED]` Confirmed outbound callers:

- `apps/rel8tion-app/src/api/notifications.js`
- root `b.html`
- reference outreach functions under `docs/supabase-functions`

`[IMPLEMENTED]` Confirmed inbound functions:

- `twilio-inbound-router`
- `twilio-inbound-reply`

SMS categories:

- agent activation SMS
- buyer check-in confirmation
- agent check-in notification
- live loan officer financing alert
- buyer loan officer introduction
- Jared financing alert when no live loan officer exists
- outreach initial/follow-up/manual messages
- inbound reply owner alert

Security/safety notes:

- Outbound SMS can trigger real contacts and spend money.
- Queue filters and mobile validation are critical.
- Opt-out and reply suppression should not be loosened casually.

## WordPress Marketing/Site Role

`[PARTIAL]` Confirmed from `wordpress/README.md`:

- `wordpress/` is a local tracking home for WordPress-side files.
- Current focus is `/hot-list`, outreach reply visibility, and reducing manual controls.
- Files are not automatically synced to live WordPress.
- `hot-list.current-redacted.html` is a redacted baseline.
- `[PARTIAL]` `hot-list.v2.html` is a local working version, not a proven live WordPress deployment.

Other WordPress involvement:

- App pages load marketing/brand assets from `https://rel8tion.me/wp-content/uploads/...`.
- Root marketing pages such as `home.html`, `features.html`, `pricing.html`, and others are present.

## Security Model

The current implementation is a practical beta/demo security model, not a full account/password auth system.

`[IMPLEMENTED]` Confirmed layers:

- Physical NFC chip possession is the main identity signal.
- Claimed keychains are stored in `keys`.
- Agent host sessions are short-lived localStorage records with 15-minute freshness.
- Pending sign activation sessions are stored locally and in Supabase with expiration.
- Rear sign dashboard access requires rear chip scan plus agent keychain verification.
- Loan officer live support requires a verified profile UID/tag scan.
- Destructive key/sign reset requires a server-side admin token and service role.
- Smart sign activation sessions have public RLS limited to pending, unexpired rows.
- Supabase anon key is public and expected in browser code.
- Service role keys are used only in API/Edge/server contexts.

Important gaps/risks:

- `[RISK]` Browser localStorage can be stale and must be cleared/expired carefully.
- `[NEEDS VERIFICATION]` Live RLS policies for all tables were not fully verified from repo files.
- `[RISK]` Some client pages have direct anon insert/update behavior that depends on live policies.
- `[INTENDED]` Sensitive writes and security-critical state transitions should move toward Edge Functions or serverless APIs. Current implementation still includes direct browser REST writes.
- `[RISK]` `event_loan_officer_sessions` SQL grants broad anon/auth access; RLS state needs verification.
- `[PARTIAL]` `send-lead-sms` source is checked into the repo. Its live deployed source/version, validation behavior, and auth model still need verification before SMS contract changes.

## Admin Dashboard Structure

`[PARTIAL]` Confirmed:

- `[PARTIAL]` `apps/rel8tion-app/admin.html` is a placeholder shell.
- `[INTENDED]` It states that protected admin tools for signs, live events, outreach, replies, and analytics are reserved for future work.
- `[PARTIAL]` Practical admin tooling currently exists through `/key-reset` and `api/admin/reset-key.js`.
- `[PARTIAL]` WordPress hot-list files provide outreach visibility/admin-style UI outside the app, but are not auto-synced to production.

## Scaling And Stability Concerns

Current concerns visible in code:

- `[RISK]` Current production is anchored to `modular-claim-test` commit `51d2d1a`; `main` has diverged and should not be treated as deploy-ready until reconciled.
- `[RISK]` Duplicate root and app route files can create confusion.
- `[RISK]` `/a` and `/b` live at root while most app routes are rewritten into `apps/rel8tion-app`.
- `[RISK]` iPhone NFC popup behavior can differ from Android direct navigation.
- `[RISK]` Geolocation-based listing selection can miss real listings; loose search and manual fallback are needed.
- `[RISK]` `smart_sign_activation_sessions` stale rows can resume the wrong setup if cleanup fails.
- `[RISK]` Estately scraping is brittle and can return bad office numbers.
- `[NEEDS VERIFICATION]` Root enrichment cron is not present in root `vercel.json`.
- `[NEEDS VERIFICATION]` Several referenced Supabase RPCs/functions still need live deployment/definition verification.
- `[IMPLEMENTED]` A read-only verification kit exists under `docs/live-verification/` and can generate local JSON/Markdown reports with `npm run verify:live`.
- `[PARTIAL]` Latest anon run returned `PASS 79`, `WARN 6`, `NEEDS_VERIFICATION 11`, `FAIL 0`; this confirms anon PostgREST schema exposure for core tables/columns, not RLS safety or full production health.
- `[INTENDED]` No full automated E2E suite is present for the NFC/sign flows.
- `[IMPLEMENTED]` One active event per sign and one live loan officer per event are current constraints.
- `[PARTIAL]` Manual listings create events with `open_house_source_id = null`, which limits enrichment/outreach/listing-data behavior.
- `[RISK]` Static pages call Supabase directly, so schema/RLS drift causes visible production failures.

## Current Known Gaps

Confirmed or needs-verification gaps:

- `[INTENDED]` Formal remote LO coverage management is not built: no invite/request/accept workflow, no remote availability queue, no scheduled coverage assignment, and no persistent agent-LO relationship management. Current LO support is scan/session based.
- `[INTENDED]` Agent-to-loan-officer relationship tables are not present in current app code.
- `[INTENDED]` Chat/modal/video support between buyer, agent, and loan officer is not implemented.
- `[PARTIAL]` Admin dashboard is placeholder only.
- `[PARTIAL]` `send-lead-sms` implementation is now checked in under `supabase/functions`; deployed source/version matching and Twilio behavior remain `[NEEDS VERIFICATION]`.
- `[NEEDS VERIFICATION]` RPC definitions remain unverified after the latest anon run.
- `[NEEDS VERIFICATION]` Root Vercel cron for `api/cron/enrich-agents.js` is absent in inspected `vercel.json`.
- `[IMPLEMENTED]` Vercel CLI/API inspection confirmed the current ready production deployment is aliased to `app.rel8tion.me` and deploys serverless functions for `api/compliance/ny-disclosure`, `api/admin/reset-key`, and `api/cron/enrich-agents`.
- `[NEEDS VERIFICATION]` Vercel API reports `crons.definitions = 0`; the enrichment endpoint exists, but no root Vercel cron schedule is configured from the project response.
- `[NEEDS VERIFICATION]` Live RLS policy state was not fully confirmed; the anon verification run checked zero-row schema exposure only.
- `[NEEDS VERIFICATION]` Signed NYS disclosure PDF upload requires a live Supabase Storage bucket and service-role access from Vercel.
- `[PARTIAL]` `/b` saves buyer profile leads into `leads`. `/event` saves event attendance/check-ins into `event_checkins`. These should be unified by treating `leads` as the global CRM/person record and `event_checkins` as the event-specific attendance/action record. This is not fully implemented yet.
- `[RISK]` NYS disclosure handling is implemented as a configurable REL8TION-hosted Supabase Storage PDF link plus stored acknowledgement metadata. The official DOS form page remains the source-of-truth reference, and final legal/form-version review remains `[NEEDS VERIFICATION]`.
- `[RISK]` `smart-sign-qr-export.sql` and the current activation flow disagree on whether QR source should be `smart_signs` or `smart_sign_inventory`.

## [INTENDED] Top Priority Next Task

Run privileged/dashboard verification for RLS policies, service-role schema checks, deployed Edge Functions, RPC definitions, and Vercel Cron state before treating live Supabase, deployed functions, SMS behavior, or production routing as fully confirmed.

## Verification Notes

Status labels: `[IMPLEMENTED]`, `[PARTIAL]`, `[INTENDED]`, `[NEEDS VERIFICATION]`, `[RISK]`. `[IMPLEMENTED]` means code exists in the repo. It does not guarantee that the feature is deployed, live, passing RLS, or working with current Supabase production data.

### [IMPLEMENTED] Repo Claims

| Major claim | Status | Evidence |
| --- | --- | --- |
| REL8TION is implemented as static Vercel pages plus Supabase and SMS integration points. | `[IMPLEMENTED]` | Root/app `vercel.json`, `apps/rel8tion-app` static pages, Supabase REST/RPC calls, `supabase/functions`, and root `api` routes. |
| Vercel/app routes are product routes. | `[IMPLEMENTED]` | Root `vercel.json` rewrites product paths into `apps/rel8tion-app`; app `vercel.json` mirrors the route surface. |
| `/k` routes keychains, front sign chips, rear sign chips, reset scans, pending sign activation, and loan officer scans. | `[IMPLEMENTED]` | `apps/rel8tion-app/k.html`. |
| Front smart sign NFC equals buyer check-in route. | `[IMPLEMENTED]` | `sign-demo-activate.html` stores the first sign chip as `uid_primary` and `front_buyer_chip`; `k.html` routes role `front_buyer` to `/s?code=...`. |
| Extra front/buyer NFC chip aliases are supported in repo code. | `[PARTIAL]` | `sign-demo-activate.html` can arm/manual-link an extra buyer NFC UID; `k.html` checks `smart_sign_chip_aliases` and routes active aliases as `front_buyer`. Live migration/RLS needs verification before relying on it in a demo. |
| Rear smart sign NFC equals dashboard challenge route only. | `[IMPLEMENTED]` | `k.html` classifies `uid_secondary` as `rear_agent`, saves dashboard pending state, and does not directly open dashboard. |
| Rear sign scan must be followed by agent keychain scan. | `[IMPLEMENTED]` | `k.html` renders "Tap your Rel8tionChip keychain to verify and open the live event dashboard" for rear sign scans. |
| Agent keychain scan opens dashboard only after matching the pending challenge. | `[IMPLEMENTED]` | `k.html` uses `rel8tion_agent_dashboard_pending` and then calls `goToAgentDashboard` after claimed key handling. |
| Sign activation uses sign inventory/public code lookup. | `[IMPLEMENTED]` | `sign-demo-activate.html` queries `smart_sign_inventory?public_code=eq...` before sign fallback. |
| Smart sign activation stores front and rear chip roles. | `[IMPLEMENTED]` | `registerFirstChip` writes `primary_device_type: front_buyer_chip`; `registerSecondChip` writes `secondary_device_type: rear_agent_chip`. |
| Smart sign activation binds a sign to `open_house_events`. | `[IMPLEMENTED]` | `createOrLockEvent` inserts/updates `open_house_events` and patches `smart_signs.active_event_id`. |
| Agent dashboard can end or move a live sign event. | `[IMPLEMENTED]` | `agent-dashboard.html` patches `open_house_events.status/ended_at`, clears `smart_signs.active_event_id`, sets the sign inactive, and can route into `/sign-demo-activate.html` for the next listing. |
| `/s` resolves active signs to `/event`. | `[IMPLEMENTED]` | `signResolver` loads a sign/event and redirects to `/event?event=...` when an event exists. |
| `/event` saves buyer check-ins to `event_checkins`. | `[IMPLEMENTED]` | `eventShell/bootstrap.js` builds payloads and calls `createCheckin`; `src/api/events.js` posts to `event_checkins`. |
| `/event` first screen is buyer-first. | `[IMPLEMENTED]` | `eventShell/bootstrap.js` renders a formatted property-address welcome, property image, hosted-by agent photo/name/brokerage, compact top path buttons, and immediate name/phone/pre-approval inputs before contact/save-contact actions. Email is optional. |
| `/event` cloud background and disclosure overlay behavior are present. | `[IMPLEMENTED]` | `event.html` defines the cloud background layer; `eventShell/bootstrap.js` portals the guided disclosure modal to `document.body` and opens it as a fixed viewport overlay. |
| `/event` requires guided NYS/Rel8tion disclosure completion. | `[IMPLEMENTED]` | `eventShell/bootstrap.js` runs agency disclosure, housing disclosure review, courtesy notice, and final acknowledgement in one guided modal, blocks signing until buyer name exists, and validates timestamps/acknowledgement before creating the check-in. |
| `/event` stores agency/courtesy disclosure evidence. | `[IMPLEMENTED]` | `eventShell/bootstrap.js` writes agency/courtesy disclosure metadata into `event_checkins.metadata`. |
| `/event` requires NYS disclosure acknowledgement before SMS/check-in completion. | `[IMPLEMENTED]` | `eventShell/bootstrap.js` validates buyer name, checkbox acknowledgement, and prefilled signature before creating the check-in and before notification calls. |
| `/event` stores DOS-2156 acknowledgement metadata. | `[IMPLEMENTED]` | `eventShell/bootstrap.js` writes `event_checkins.metadata.ny_discrimination_disclosure` with form code/version, provided-by agent/brokerage, consumer role, checkbox-plus-prefilled-name signature, timestamps, and user agent. |
| `/event` uses a configurable REL8TION-hosted disclosure PDF. | `[IMPLEMENTED]` | `src/core/config.js` defaults `NYS_HOUSING_ANTI_DISCRIMINATION_DISCLOSURE_PDF_URL` to the Supabase Storage PDF and keeps `OFFICIAL_NYS_HOUSING_ANTI_DISCRIMINATION_DISCLOSURE_SOURCE_URL` for the official DOS source-of-truth reference. |
| Prefilled/signed REL8TION disclosure packet PDF API exists. | `[IMPLEMENTED]` | `api/compliance/ny-disclosure.js` generates preview and signed PDF packets with `pdf-lib`, including agency, housing, and courtesy evidence. |
| Signed disclosure PDF storage is fully live. | `[NEEDS VERIFICATION]` | Requires live Vercel env vars and Supabase Storage bucket verification. |
| Agent dashboard lead cards show disclosure status. | `[IMPLEMENTED]` | `agent-dashboard.html` reads `metadata.nys_agency_disclosure`, `metadata.ny_discrimination_disclosure`, and `metadata.rel8tion_courtesy_notice`, then renders signed/missing status plus disclosure packet PDF link when present. |
| Buyer financing help is opt-in. | `[IMPLEMENTED]` | `eventShell/bootstrap.js` only marks financing requested when the buyer chooses second-opinion help or checks optional financing follow-up. `pre_approved=false` alone does not send financing outreach. |
| Buyer financing opt-in routes to active paired loan officer if present. | `[IMPLEMENTED]` | `eventShell/bootstrap.js` calls `getLiveLoanOfficerSession`, then sends LO alert/intro only when financing help was requested. |
| Buyer financing opt-in routes to Jared when no active LO exists. | `[IMPLEMENTED]` | `eventShell/bootstrap.js` calls `sendJaredFinancingAlert` in the no-live-LO branch; the buyer UI also has a temporary SMS financing button to `347-775-8059`. |
| Loan officer tag scan verifies event support. | `[IMPLEMENTED]` | Dashboard arms `rel8tion_loan_officer_pending`; `/k` verifies active `verified_profiles` and writes `event_loan_officer_sessions`. |
| `/nmb-activate` and `/nmb-verified` are loan officer profile routes. | `[PARTIAL]` | `apps/rel8tion-app/nmb-activate.html` and `nmb-verified.html`; Formal remote LO coverage management is not built: no invite/request/accept workflow, no remote availability queue, no scheduled coverage assignment, and no persistent agent-LO relationship management. Current LO support is scan/session based. |
| `/a` and `/b` are a separate agent profile/buyer lead path. | `[IMPLEMENTED]` | `a.html` redirects to `/b`; `b.html` loads `agents`, posts to `leads`, and calls `send-lead-sms`. |
| Admin key reset exists as a beta/admin utility. | `[PARTIAL]` | `apps/rel8tion-app/key-reset.html` and `api/admin/reset-key.js`; full admin dashboard is not built. |
| Twilio inbound reply handling is checked into deployed function structure. | `[IMPLEMENTED]` | `supabase/functions/twilio-inbound-router` and `twilio-inbound-reply`. |
| WordPress is not the product brain. | `[PARTIAL]` | `wordpress/README.md` says files are local tracking and not auto-synced. Product state/routes live in Vercel app files and Supabase calls. |
| Estately enrichment worker exists and updates listing agent data. | `[PARTIAL]` | `estately-enrichment-worker.cjs` and `api/cron/enrich-agents.js`; scheduling and live data quality need verification. |

### [INTENDED] Business Rules And Target Architecture

| Major claim | Status | Evidence |
| --- | --- | --- |
| Buyer-facing chips should never expose sign activation controls. | `[INTENDED]` | Active front chip routes to buyer event. This remains a rule because setup mode still handles unpaired chips. |
| Rear NFC should be dashboard challenge only, not direct dashboard access. | `[IMPLEMENTED]` | Current `/k` implementation matches this rule. |
| A sign should bind to one active event at a time. | `[IMPLEMENTED]` | App closes/updates active events; migration creates one-active-event-per-sign index. |
| WordPress should remain marketing/presentation. | `[INTENDED]` | WordPress README frames files as local tracking. No product state is stored there in checked code. |
| Supabase sensitive writes should move through Edge Functions/serverless APIs. | `[INTENDED]` | Current browser code directly writes several public tables. This is not current implementation. |
| Formal remote LO coverage management should support agents remotely by invite/request/accept. | `[INTENDED]` | No invite/request/accept workflow, no remote availability queue, no scheduled coverage assignment, and no persistent agent-LO relationship management. Current LO support is scan/session based. |
| Buyer, agent, and loan officer should be able to communicate in a richer live modal. | `[INTENDED]` | Current implementation has SMS/call/text links only. |

### [PARTIAL], [NEEDS VERIFICATION], And [RISK]

| Major claim | Status | Evidence |
| --- | --- | --- |
| Formal remote LO coverage management is desired but not built. | `[INTENDED]` | No invite/request/accept workflow, no remote availability queue, no scheduled coverage assignment, and no persistent agent-LO relationship management. Current LO support is scan/session based. |
| Chat/video support is desired but not built. | `[INTENDED]` | No chat/video modules/routes found. |
| Full admin dashboard is desired but not built. | `[INTENDED]` | `apps/rel8tion-app/admin.html` is a placeholder. |
| Root Estately endpoint is scheduled by Vercel Cron. | `[NEEDS VERIFICATION]` | `api/cron/enrich-agents.js` exists; root `vercel.json` has no `crons` block. |
| `send-lead-sms` implementation is checked in. | `[IMPLEMENTED]` | Source exists at `supabase/functions/send-lead-sms/index.ts`; deployed source/version matching and Twilio behavior still need verification. |
| Outreach generation/send functions under `docs/supabase-functions` are deployed. | `[NEEDS VERIFICATION]` | Source exists under docs, not under deployable `supabase/functions`. |
| Supabase RPC definitions are present in repo SQL. | `[NEEDS VERIFICATION]` | RPCs are called but definitions were not found in checked-in SQL. |
| Live production schema/RLS exactly matches repo assumptions. | `[NEEDS VERIFICATION]` | Latest anon run confirms core table/column exposure through anon PostgREST; live RLS/write behavior and service-role checks were not verified. |
| `event_loan_officer_sessions` RLS is production-safe. | `[RISK]` | SQL grants anon/auth access; RLS enablement was not found in that SQL file. |
| QR source is unified between printed inventory and sign rows. | `[RISK]` | Activation uses `smart_sign_inventory`; `smart-sign-qr-export.sql` exports from `smart_signs`. |
