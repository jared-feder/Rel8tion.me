# Current State

Last inspected: 2026-05-09.

This is an operational snapshot of what the current repo appears to support. It is repo-based, not a guarantee of the current live production deployment.

Status labels:

- `[IMPLEMENTED]` means code exists in the repo. It does not guarantee that the feature is deployed, live, passing RLS, or working with current Supabase production data.
- `[PARTIAL]` means some code exists, but the complete product behavior is not built or not fully wired.
- `[INTENDED]` means this is a REL8TION business/product rule or target architecture, not proof of current implementation.
- `[NEEDS VERIFICATION]` means the repo is not enough to prove live behavior, deployment, schema, RLS, or external service state.
- `[RISK]` means this can break demos, production data, security, SMS, or user trust if handled casually.

## [IMPLEMENTED] Current Live Code Anchor

- `[IMPLEMENTED]` Production is configured to deploy from the `main` branch through Vercel Git production branch automation.
- `[IMPLEMENTED]` Vercel API inspection confirms project Git `productionBranch = main` and the current ready production deployment is aliased to `app.rel8tion.me`.
- `[IMPLEMENTED]` The `/event` cloud background and fixed disclosure modal fix was verified live after `main` commit `c8789ae` (`Fix event disclosure modals and cloud styling`).
- `[IMPLEMENTED]` `staging` exists as the pre-production/staging branch and currently points to the same reconciled commit as `main`.
- `[IMPLEMENTED]` The previous direct/dirty production deploy from `modular-claim-test` commit `51d2d1a` is preserved by tag `production-51d2d1a-2026-05-08`.
- `[RISK]` Do not force-push `main` and do not reset either branch. Preserve production tags and use normal merge/PR history.

## [IMPLEMENTED] Repo Code Present Today

- `[IMPLEMENTED]` Agent keychain claim flow exists at `/claim`.
- `[IMPLEMENTED]` Claimed keychains route through `/k` and then to `/a`, which redirects to `/b`.
- `[IMPLEMENTED]` `/b` loads an agent by slug, shows agent info, captures buyer preferences, saves to `leads`, calls `send-lead-sms`, and shows a three-property preference modal.
- `[IMPLEMENTED]` Agent onboarding exists at `/onboarding` and includes the smart sign activation entry point.
- `[IMPLEMENTED]` `/onboarding` shows Rel8tionChip keychain slots and can arm an "Add Backup Keychain" flow. The next scanned keychain is linked to the same agent through `/k` using `keys.device_role = keychain` and `keys.assigned_slot` slot 1/2.
- `[IMPLEMENTED]` Smart sign activation exists at `/sign-demo-activate`.
- `[IMPLEMENTED]` Activation uses sign QR/public code lookup through `smart_sign_inventory`.
- `[PARTIAL]` Multiple printed QR/public-code inventory rows can still resolve to the same canonical sign when `smart_sign_inventory.smart_sign_id` points at the same `smart_signs.id`, but the activation success screen no longer treats the old second printed QR as the add-on path. The supported add-on path is an extra physical front/buyer NFC chip linked through `smart_sign_chip_aliases`; the migration is present in the repo and live Supabase application remains `[NEEDS VERIFICATION]`.
- `[IMPLEMENTED]` Activation supports camera QR scan, camera photo fallback, and manual code entry.
- `[IMPLEMENTED]` Activation supports front chip and rear chip pairing.
- `[IMPLEMENTED]` Front chip is stored as buyer chip in `smart_signs.uid_primary`.
- `[IMPLEMENTED]` Rear chip is stored as agent chip in `smart_signs.uid_secondary`.
- `[PARTIAL]` After a sign is activated, the success screen can arm or manually link an extra front/buyer NFC chip UID to the same sign through `smart_sign_chip_aliases`. The alias chip opens the same buyer check-in route as the main front chip and cannot be used for rear agent dashboard access. Live DB migration/RLS needs verification before demo use.
- `[IMPLEMENTED]` Agent keychain handshake is part of sign setup.
- `[IMPLEMENTED]` Sign activation can bind a sign to an open house event.
- `[IMPLEMENTED]` Binding has loose nearby/listing search behavior and a manual listing fallback.
- `[IMPLEMENTED]` When a keychain claim flow stores a selected open house in the host session, smart sign activation offers that selected listing first before other nearby/search/manual options.
- `[IMPLEMENTED]` Smart sign activation now loads the agent profile and displays the agent name/brokerage instead of relying on raw slugs in the visible activation flow.
- `[IMPLEMENTED]` Public sign route exists at `/s` and `/sign`.
- `[IMPLEMENTED]` Active front chip flow sends buyer to `/s?code=...` and then `/event`.
- `[IMPLEMENTED]` `/event` is the smart sign buyer check-in page.
- `[IMPLEMENTED]` `/event` first visible screen is buyer-first: a formatted "Welcome to" property-address header, property image when available, hosted-by agent photo/name/brokerage, then small top check-in path buttons and immediate name/phone/pre-approval inputs. Email is optional. Host contact/save-contact actions are intentionally shown after successful check-in.
- `[IMPLEMENTED]` `/event` uses the Rel8tion cloud background layer and opens agency/courtesy disclosure dialogs as fixed viewport overlays, so tapping Review & Sign does not require scrolling to the bottom of the page.
- `[IMPLEMENTED]` `/event` applies matched brokerage theme colors/fonts from the `brokerages` lookup when a brokerage match is available; otherwise it falls back to Rel8tion defaults.
- `[IMPLEMENTED]` Smart sign buyer check-in saves to `event_checkins`.
- `[IMPLEMENTED]` `/event` requires the New York State Agency Disclosure, NYS Housing and Anti-Discrimination Disclosure review, and Rel8tion Courtesy Notice to be completed through one guided modal before check-in submit. Seller representation is the only agency disclosure mode in v1.
- `[IMPLEMENTED]` `/event` stores agency/courtesy disclosure evidence in `event_checkins.metadata`, including `agency_disclosure_reviewed`, `seller_representation_acknowledged`, `agency_disclosure_signed_at`, `agency_disclosure_pdf_url`, `agency_disclosure_version`, `agency_disclosure_type`, `rel8tion_courtesy_acknowledged`, `rel8tion_courtesy_signed_at`, plus nested `nys_agency_disclosure` and `rel8tion_courtesy_notice` objects.
- `[IMPLEMENTED]` `/event` blocks disclosure signing until a buyer/check-in name exists, then requires the final NYS Housing and Anti-Discrimination Disclosure checkbox acknowledgement before check-in submit. The buyer check-in name auto-fills as the electronic signature, and the acknowledgement is stored in `event_checkins.metadata.ny_discrimination_disclosure`.
- `[IMPLEMENTED]` `/event` uses configurable `NYS_HOUSING_ANTI_DISCRIMINATION_DISCLOSURE_PDF_URL`, defaulting to the REL8TION-hosted Supabase Storage copy of the NYS Housing and Anti-Discrimination Disclosure PDF. The official DOS form page remains the source-of-truth reference.
- `[IMPLEMENTED]` `/event` opens a server-generated prefilled NYS disclosure PDF preview through `/api/compliance/ny-disclosure?event=...`.
- `[PARTIAL]` After buyer check-in, `/event` attempts to generate a signed REL8TION disclosure packet PDF through `/api/compliance/ny-disclosure`, store it in Supabase Storage, and attach the storage/download details to `event_checkins.metadata.ny_discrimination_disclosure.signed_pdf`. Storage bucket/env availability needs live verification.
- `[IMPLEMENTED]` New signed disclosure packet PDFs include the NYS Agency Disclosure evidence, NYS Housing and Anti-Discrimination acknowledgement evidence, Rel8tion Courtesy Notice evidence, and source form pages when available. They are stored with broker-readable event paths and filenames, and metadata includes document hash, event/check-in IDs, property address, buyer name, generated timestamp, packet version, and source form references for audit evidence.
- `[IMPLEMENTED]` Buyer check-in calls `send-lead-sms` for buyer and agent SMS. The SMS function implementation itself is not in this repo.
- `[IMPLEMENTED]` Buyer preapproval/financing routing asks for pre-approval status on buyer-facing paths, then handles optional second-opinion or discreet financing consent inside the guided disclosure modal after disclosures are reviewed. Financing outreach is opt-in: selecting "not pre-approved" alone does not trigger financing SMS. If financing help is requested, the code checks for a live loan officer session first, then falls back to Jared alert. The `buyer_agent` path skips pre-approval and disclosure prompts.
- `[IMPLEMENTED]` Post-check-in buyer UI no longer shows OneKey listing links, internal check-in status cards, the unfinished loan-officer support card, or a second check-in button. It shows a cleaner confirmation, next-step copy, property snapshot, host bio/contact actions, neighborhood SMS prompt, and a temporary financing SMS prompt to `347-775-8059`.
- `[IMPLEMENTED]` Rear sign chip flow challenges the agent to tap their keychain before opening `/agent-dashboard`.
- `[IMPLEMENTED]` Rear sign dashboard verification takes priority over any stale loan-officer sign-in prompt. Tapping the rear sign clears the pending LO browser session before waiting for the agent keychain.
- `[IMPLEMENTED]` Agent dashboard shows live event stats, leads, each lead card's agency/housing/courtesy disclosure signed/missing status, signed disclosure packet PDF link when available, outreach count, relationship status, and loan officer coverage.
- `[IMPLEMENTED]` Agent dashboard has end/move controls for the current open house. Ending marks `open_house_events.status = ended`, stamps `ended_at`, clears `smart_signs.active_event_id`, and sets the sign back to inactive without deleting captured check-ins. Moving performs the same closeout and opens sign activation for the next listing.
- `[PARTIAL]` Present/local loan officer sign-in exists through dashboard prompt, loan officer tag scan, `verified_profiles`, and `event_loan_officer_sessions`. Formal remote LO coverage management is not built: no invite/request/accept workflow, no remote availability queue, no scheduled coverage assignment, and no persistent agent-LO relationship management. Current LO support is scan/session based.
- `[IMPLEMENTED]` NMB loan officer activation/profile pages exist at `/nmb-activate` and `/nmb-verified`.
- `[IMPLEMENTED]` Temporary key/sign reset admin tooling exists at `/key-reset` with server API `api/admin/reset-key.js`.
- `[IMPLEMENTED]` The temporary reset tooling is restricted to the protected beta lane only: keychain UID `7ce5a51b-8202-4178-afc7-40a2e10e2a4d`, sign public code `0e4b015f3782`, front chip UID `f005e166-70b3-407c-ba24-b91464a3d22a`, and rear chip UID `b70d2bde-d185-43ee-8962-083b64fa4347`. Elena/Galluzzo sign data remains protected by reset guardrails.
- `[IMPLEMENTED]` Beta fresh-claim cleanup clears stale browser host/sign activation sessions and inactive sign QR scans preserve the current host session, so a newly claimed demo keychain profile can carry forward into sign activation instead of falling back to stale `agent-*` context.
- `[IMPLEMENTED]` The dedicated beta keychain route now expires stale local sign-activation browser sessions and opens the beta claim/reset menu before stale remote `smart_sign_activation_sessions` can hijack the scan. Fresh local sign activation handshakes still continue when the same browser is actively in that flow.
- `[IMPLEMENTED]` In the beta keychain claim flow, once a real typed profile is saved, that profile identity is locked for the activation run. Selecting an open house can still attach the listing/property context, but stale `listing_agents` or `open_houses.agent` data should not overwrite the typed keychain profile name/phone/brokerage.
- `[IMPLEMENTED]` Estately enrichment worker exists and is configured for batch size 20.
- `[NEEDS VERIFICATION]` No tracked Browserless/Trulia enrichment implementation was found during the 2026-05-09 repo audit. Current tracked enrichment is the Estately + Cheerio worker. If Browserless/Trulia enrichment is intended, it needs implementation or source recovery.
- `[IMPLEMENTED]` Mockup renderer app exists under `apps/mockup-renderer` with cron wrappers and tests.
- `[IMPLEMENTED]` Twilio inbound reply Edge Functions are checked in under `supabase/functions`.
- `[IMPLEMENTED]` A read-only live verification system exists under `docs/live-verification/` with `npm run verify:live`.
- `[PARTIAL]` Latest live verification anon run on 2026-05-09 succeeded with summary `PASS 79`, `WARN 6`, `NEEDS_VERIFICATION 11`, `FAIL 0`. Core tables and expected columns passed anon zero-row schema probes. This confirms live schema exposure through the anon PostgREST access path, not full RLS correctness, write behavior, deployment health, or production data quality.

## [PARTIAL] And [NEEDS VERIFICATION]

- `[NEEDS VERIFICATION]` Root `api/cron/enrich-agents.js` exists, but root `vercel.json` currently has no `crons` block. Cron scheduling is not proven by the repo.
- `[PARTIAL]` The Estately worker can enrich `listing_agents`, but quality depends on Estately parsing and phone validation.
- `[NEEDS VERIFICATION]` Outreach generation/sending source exists mostly under `docs/supabase-functions`; deployment state is not confirmed from repo files.
- `[PARTIAL]` `/admin` is only a placeholder page, not a full admin dashboard.
- `[PARTIAL]` WordPress hot-list files exist locally, but they are not automatically synced to WordPress.
- `[PARTIAL]` `/b` buyer profile and `/event` smart sign check-in are both active concepts but save into different tables.
- `[RISK]` Several root/static pages are legacy or test artifacts. Use `vercel.json` before assuming a page is live.
- `[NEEDS VERIFICATION]` Live RLS state is not fully knowable from checked-in files or the latest anon zero-row schema probes.
- `[RISK]` `event_loan_officer_sessions` SQL grants anon/auth select, insert, and update; live RLS state needs verification.
- `[NEEDS VERIFICATION]` `find_nearest_open_house`, `queue_recent_outreach_candidates`, `verified_profiles_lookup`, and `verified_profiles_activate_or_create` are still unverified after the latest anon run.
- `[NEEDS VERIFICATION]` `send-lead-sms` is called by the app but its local Edge Function source was not found, and the verification script intentionally does not call SMS functions.
- `[NEEDS VERIFICATION]` Edge functions under `docs/supabase-functions` still need deployment verification.
- `[NEEDS VERIFICATION]` Service role was not used in the latest run, so privileged schema checks and RLS policy checks remain unverified.
- `[IMPLEMENTED]` Vercel CLI/API inspection confirmed the current ready production deployment is aliased to `app.rel8tion.me` and includes serverless functions for `api/compliance/ny-disclosure`, `api/admin/reset-key`, and `api/cron/enrich-agents`.
- `[PARTIAL]` Live route smoke checks on the current `main` production deployment returned 200 for `/claim`, `/onboarding`, `/sign-demo-activate`, `/k`, `/key-reset`, `/event`, and `/agent-dashboard`; `/api/admin/reset-key` returned 401 without token as expected; `/api/compliance/ny-disclosure` returned 400 without an event as expected. `/api/cron/enrich-agents` was intentionally not invoked because it writes/enriches production data.
- `[NEEDS VERIFICATION]` Vercel API reports `crons.definitions = 0`; the enrichment endpoint exists, but no root Vercel cron schedule is configured from the project response.
- `[NEEDS VERIFICATION]` Final NYS disclosure legal/form-version review remains unverified. The app points to a REL8TION-hosted Supabase Storage copy, while the official DOS form page remains the source-of-truth reference.
- `[NEEDS VERIFICATION]` Signed NYS disclosure PDF storage depends on Vercel env vars `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, and an existing `SIGNED_DISCLOSURE_BUCKET` bucket or the default `signed-disclosures` bucket.

## [INTENDED] Not Built Yet

- `[INTENDED]` Formal remote LO coverage management is not built: no invite/request/accept workflow, no remote availability queue, no scheduled coverage assignment, and no persistent agent-LO relationship management. Current LO support is scan/session based.
- `[PARTIAL]` Loan officer support is currently scan/session based through a local tag verification flow.
- `[INTENDED]` Buyer-agent-loan-officer chat modal is not built.
- `[INTENDED]` Rich buyer dashboard with external listing-site/Zillow-style media, neighborhood data, and persistent chat is not built. Current `/event` post-check-in experience shows available property/agent/LO context and uses SMS/call links for messaging.
- `[INTENDED]` Call/video workflow beyond simple call/text links is not built.
- `[INTENDED]` Full admin dashboard for signs, events, outreach, replies, and analytics is not built.
- `[INTENDED]` Full automated E2E tests for NFC, sign activation, buyer check-in, dashboard, and SMS are not present.
- `[RISK]` QR export needs cleanup: current activation expects `smart_sign_inventory.public_code`, while `smart-sign-qr-export.sql` exports from `smart_signs`.
- `[PARTIAL]` Manual listing fallback creates event context but no linked `open_house_source_id`, which limits listing-data and outreach behavior.

## Changed Recently

Recent repo state includes:

- `[IMPLEMENTED]` Production now deploys from `main`; the `/event` cloud/modal fix was verified live after commit `c8789ae`.
- `[IMPLEMENTED]` `staging` was created and pushed as the staging/pre-production branch.
- `[IMPLEMENTED]` The older production deploy from `modular-claim-test` commit `51d2d1a` remains tagged as `production-51d2d1a-2026-05-08`.
- `[IMPLEMENTED]` Sign activation now carries forward the open house selected during keychain claim and offers it first for sign binding.
- `[IMPLEMENTED]` Sign activation now displays agent profile name/brokerage from the agent row instead of showing only a raw slug such as `agent-gwh`.
- `[IMPLEMENTED]` Root env files were removed from git tracking, `.env*` is ignored, and `.vercelignore` helps keep local/docs artifacts out of deploy uploads.
- `[IMPLEMENTED]` Beta keychain/sign lane for `main-beta`.
- `[IMPLEMENTED]` Beta reset/restore helpers in the claim flow.
- `[IMPLEMENTED]` Beta fresh-claim flow now clears stale host session state and blocks auto-activation from generating a generic `Agent` slug when no real agent name is available.
- `[IMPLEMENTED]` Beta claim now protects the typed keychain profile from being replaced by stale listing-agent enrichment when a listing is selected for sign/event context.
- `[IMPLEMENTED]` Sign setup labels changed toward front buyer chip and rear agent chip.
- `[IMPLEMENTED]` Remote `smart_sign_activation_sessions` added for scan handoff/session recovery.
- `[IMPLEMENTED]` Key reset scanner/admin API added.
- `[IMPLEMENTED]` Buyer event page changed to a low-scroll first screen with property-address welcome, property image, hosted-by agent photo/avatar, top relationship-path buttons, and immediate buyer name/phone/pre-approval inputs. Email is optional.
- `[IMPLEMENTED]` Buyer event page moved host Save Contact/Call/Text/Email actions to the post-check-in success/contact section.
- `[IMPLEMENTED]` Buyer event page restored the Rel8tion cloud background and moved agency/courtesy disclosure modals into fixed viewport overlays so the Review & Sign actions open immediately on screen.
- `[IMPLEMENTED]` Buyer event page now welcomes buyers by property address, displays property and agent imagery when available, requires name/phone/pre-approval on buyer-facing paths, keeps email optional, enables mobile autofill attributes, applies matched brokerage theme colors/fonts, and guides disclosure plus lending consent steps through one modal.
- `[IMPLEMENTED]` Buyer event page now keeps the lending second-opinion prompt off the main page; it appears inside the guided modal only after disclosures when the buyer selected `yes` to pre-approved. Not-pre-approved buyers see the discreet LO consent step in that same modal. The `buyer_agent` path skips these prompts.
- `[IMPLEMENTED]` Buyer event page now blocks final check-in until the New York State Agency Disclosure and Rel8tion Courtesy Notice are accepted/signed, then stores the timestamps and disclosure metadata in `event_checkins.metadata`.
- `[IMPLEMENTED]` Buyer event page now blocks final check-in until the NYS Housing and Anti-Discrimination Disclosure checkbox acknowledgement is complete and the buyer name is available as the prefilled e-signature, then saves DOS-2156 metadata before SMS notifications are called.
- `[PARTIAL]` Buyer event page now requests signed REL8TION disclosure packet PDF generation after check-in and before SMS notification calls continue; failure is logged and does not block buyer/agent SMS.
- `[IMPLEMENTED]` Buyer event post-check-in no longer asks visitors to choose one of three property examples; it keeps the working success/contact flow and shows a short host agent bio instead.
- `[IMPLEMENTED]` `/b` profile lead submit still has the buyer preference selection flow.
- `[IMPLEMENTED]` Agent dashboard tightened to show event leads and live loan officer coverage.
- `[IMPLEMENTED]` `/k` routing now prevents stale LO sign-in state from hijacking rear-sign agent keychain verification, and dashboard cancel clears the pending LO sign-in browser state.
- `[IMPLEMENTED]` Agent onboarding can arm and link a backup keychain slot for the same agent. Both keychain slots use the normal `/k?uid=...` route, so iPhone users can tap either keychain and choose the NFC popup.
- `[PARTIAL]` Old physical signs that need more than one buyer entry point should use one printed QR/public code plus additional front/buyer NFC chip aliases. The old activation-screen second-QR linking option was removed because the requested add-on is another NFC chip, not another QR.
- `[IMPLEMENTED]` Open house listing ranking/status was loosened for activation. Listings within the current open-house window, within a two-hour early window, or near the current time are prioritized/labeled as live/open today instead of being pushed behind future listings due to imperfect feed timestamps.
- `[PARTIAL]` Loan officer local sign-in support added through verified profiles and `event_loan_officer_sessions`. Formal remote LO coverage management is not built: no invite/request/accept workflow, no remote availability queue, no scheduled coverage assignment, and no persistent agent-LO relationship management. Current LO support is scan/session based.
- `[IMPLEMENTED]` Estately enrichment worker changed to batch size 20 and upcoming-first/backlog-later prioritization.
- `[NEEDS VERIFICATION]` Outreach cleanup and bad-phone handling were worked on, but live deployment and current queue health need verification.

## [INTENDED] Build Next

Highest-value next work:

1. Run privileged/dashboard verification for RLS policies, service-role schema checks, deployed Edge Functions, RPC definitions, and Vercel Cron state.
2. Confirm the currently configured Vercel routes and whether the enrichment cron is intentionally disabled or missing.
3. Re-run `npm run verify:live` after schema, route, or function changes and review the generated report without committing it.
4. Reconcile smart sign QR source so printed QR codes, inventory rows, and sign rows use one consistent process.
5. Build formal remote LO coverage management:
   - loan officer profiles
   - agent/loan officer relationships
   - event invites
   - accept/decline flow
   - remote availability queue
   - scheduled coverage assignment
   - event start prompt
   - live coverage session
   - buyer financing alert and contact modal
6. Replace placeholder `/admin` with a protected operational dashboard.
7. Add a small E2E/runbook suite for:
   - claim keychain
   - activate sign QR
   - pair front/rear chips
   - bind listing
   - buyer check-in
   - rear dashboard challenge
   - loan officer sign-in
   - reset beta sign/key
8. Unify `/b` profile leads and `/event` check-ins by treating `leads` as the global CRM/person record and `event_checkins` as the event-specific attendance/action record.
9. Harden outreach phone validation and queue rules before re-enabling broad automation.

## [PARTIAL] Data Model Warning

`[PARTIAL]` `/b` saves buyer profile leads into `leads`. `/event` saves event attendance/check-ins into `event_checkins`. These should be unified by treating `leads` as the global CRM/person record and `event_checkins` as the event-specific attendance/action record. This is not fully implemented yet.

## [RISK] Important Warnings

- `[INTENDED]` Do not put smart sign activation on the buyer-facing page.
- `[INTENDED]` Do not route the front/buyer chip to the agent dashboard.
- `[IMPLEMENTED]` Current rear/agent chip routing requires keychain verification before dashboard access.
- `[INTENDED]` Do not reset live field signs without explicit confirmation.
- `[RISK]` Treat Elena/Galluzzo sign data as protected unless the user says otherwise.
- `[IMPLEMENTED]` `main` is now the production source of truth and Vercel production branch is verified as `main`.
- `[RISK]` The worktree contains many untracked docs, backup exports, WordPress files, and generated artifacts. Clean them by classifying into commit/ignore/archive groups; do not blindly delete them.
- `[RISK]` Stale `smart_sign_activation_sessions` rows can break activation flows.
- `[RISK]` `open_house_events` uses `host_agent_slug`; do not reintroduce `agent_slug` writes for that table.
- `[RISK]` Browser-side Supabase calls depend on live RLS policies. A code change that works locally can still fail with `42501`.
- `[INTENDED]` Sensitive Supabase writes should move through Edge Functions or serverless APIs as the product hardens; current browser code still performs direct anon-key writes.
- `[RISK]` Outreach and SMS changes can affect real people. Confirm filters before enabling send logic.
- `[RISK]` NYS disclosure handling links to a configurable REL8TION-hosted Supabase Storage copy and stores acknowledgement metadata, but the official DOS form page remains the source-of-truth reference and final legal/form-version review remains `[NEEDS VERIFICATION]`.
- `[PARTIAL]` WordPress files in this repo are local tracking files, not automatic live WordPress deployment.

## Verification Notes

Status labels: `[IMPLEMENTED]`, `[PARTIAL]`, `[INTENDED]`, `[NEEDS VERIFICATION]`, `[RISK]`. `[IMPLEMENTED]` means code exists in the repo. It does not guarantee that the feature is deployed, live, passing RLS, or working with current Supabase production data.

### [IMPLEMENTED] Repo Claims

| Major claim | Status | Evidence |
| --- | --- | --- |
| Claim flow exists at `/claim`. | `[IMPLEMENTED]` | Root/app Vercel rewrites and `apps/rel8tion-app/claim.html` with `claimStyled` modules. |
| Claimed keychains route through `/k` to `/a` and `/b`. | `[IMPLEMENTED]` | `k.html` calls `goToLiveProfile`; `a.html` redirects to `/b`. |
| `/b` buyer profile captures leads and preferences. | `[IMPLEMENTED]` | `b.html` posts to `leads`, calls `send-lead-sms`, and renders preference modal choices. |
| Smart sign activation exists and uses inventory lookup. | `[IMPLEMENTED]` | `sign-demo-activate.html` resolves `smart_sign_inventory.public_code`. |
| Front chip is buyer/check-in side. | `[IMPLEMENTED]` | `sign-demo-activate.html` stores first chip as `front_buyer_chip`; `k.html` routes `front_buyer` to `/s`. |
| Rear chip is agent/dashboard challenge side only. | `[IMPLEMENTED]` | `sign-demo-activate.html` stores second chip as `rear_agent_chip`; `k.html` stops on rear scan and asks for keychain. |
| Rear sign scan must be followed by agent keychain scan. | `[IMPLEMENTED]` | `k.html` writes `rel8tion_agent_dashboard_pending` and waits. |
| Sign activation can bind a sign to an event. | `[IMPLEMENTED]` | `createOrLockEvent` writes `open_house_events` and patches `smart_signs`. |
| Buyer event check-in exists at `/event`. | `[IMPLEMENTED]` | Route rewrites plus `eventShell/bootstrap.js`. |
| `/event` first screen is buyer-first. | `[IMPLEMENTED]` | `eventShell/bootstrap.js` renders a formatted property-address welcome, property image, hosted-by agent photo/name/brokerage, then compact top check-in path buttons and immediate name/phone/pre-approval inputs. Email is optional; contact/save-contact actions render after successful check-in. |
| Buyer check-in saves to `event_checkins`. | `[IMPLEMENTED]` | `createCheckin` posts to `event_checkins`. |
| `/event` requires guided disclosure completion. | `[IMPLEMENTED]` | `eventShell/bootstrap.js` renders a single guided disclosure modal, blocks signing until buyer name exists, validates agency/courtesy timestamps and final NYS acknowledgement before building the check-in payload. |
| Agency/courtesy disclosure evidence is saved with event check-ins. | `[IMPLEMENTED]` | `eventShell/bootstrap.js` writes `metadata.nys_agency_disclosure`, `metadata.rel8tion_courtesy_notice`, and root metadata convenience fields for signed timestamps/version/type. |
| `/event` requires NYS disclosure acknowledgement before check-in submit. | `[IMPLEMENTED]` | `eventShell/bootstrap.js` validates buyer name, checkbox acknowledgement, and prefilled signature before building the check-in payload and before SMS calls. |
| NYS disclosure acknowledgement is saved with event check-ins. | `[IMPLEMENTED]` | `eventShell/bootstrap.js` writes `metadata.ny_discrimination_disclosure` with DOS-2156 `11/25` form metadata, provided-by agent/brokerage, consumer role, checkbox/prefilled-name signature, timestamp, date, and user agent. |
| `/event` uses a configurable REL8TION-hosted disclosure PDF. | `[IMPLEMENTED]` | `src/core/config.js` defaults `NYS_HOUSING_ANTI_DISCRIMINATION_DISCLOSURE_PDF_URL` to the Supabase Storage PDF and keeps an official DOS source URL constant for reference. |
| `/event` can open a prefilled NYS disclosure preview PDF. | `[IMPLEMENTED]` | `api/compliance/ny-disclosure.js` generates a PDF packet from event context and the official form copy. |
| Signed NYS disclosure PDF generation exists. | `[PARTIAL]` | `api/compliance/ny-disclosure.js` can generate and upload signed PDFs, then patch check-in metadata; live storage bucket/env state needs verification. |
| Agent dashboard lead cards show NYS disclosure status. | `[IMPLEMENTED]` | `agent-dashboard.html` reads `metadata.ny_discrimination_disclosure` and renders Signed/Missing with signed date/time and signed PDF link when present. |
| Buyer financing help is opt-in. | `[IMPLEMENTED]` | `eventShell/bootstrap.js` only marks `metadata.financing_requested` when the buyer chooses second-opinion help or checks the optional financing follow-up box. Not-preapproved alone does not trigger financing SMS. |
| Buyer financing opt-in routes to live paired LO first. | `[IMPLEMENTED]` | `eventShell/bootstrap.js` checks `getLiveLoanOfficerSession` and sends LO alert/intro only when financing help was requested. |
| Buyer financing opt-in falls back to Jared if no live LO exists. | `[IMPLEMENTED]` | `eventShell/bootstrap.js` calls `sendJaredFinancingAlert`; the post-check-in temporary financing chat button opens SMS to `347-775-8059`. |
| Loan officer tag scan verifies event support. | `[IMPLEMENTED]` | Agent dashboard arms pending LO session; `/k` verifies `verified_profiles` and writes `event_loan_officer_sessions`. |
| NMB activation/profile pages exist. | `[IMPLEMENTED]` | `nmb-activate.html` and `nmb-verified.html`. |
| Admin key/sign reset exists. | `[PARTIAL]` | `key-reset.html` plus `api/admin/reset-key.js`; full admin dashboard is not built. |
| Estately enrichment worker exists at batch size 20. | `[IMPLEMENTED]` | `estately-enrichment-worker.cjs`. |
| Browserless/Trulia enrichment exists. | `[NEEDS VERIFICATION]` | No tracked Browserless/Trulia enrichment source was found in the repo audit; current tracked enrichment is Estately/Cheerio. |
| Twilio inbound reply Edge Functions are present. | `[IMPLEMENTED]` | `supabase/functions/twilio-inbound-router` and `twilio-inbound-reply`. |
| WordPress files are local presentation/marketing/support files. | `[PARTIAL]` | `wordpress/README.md` says they are local tracking and not automatically synced. |

### [INTENDED] Business Rules And Target Architecture

| Major claim | Status | Evidence |
| --- | --- | --- |
| Buyer-facing sign side should stay buyer-only. | `[INTENDED]` | Current active front chip routes to `/s`/`/event`; keep this as a business rule for future edits. |
| Rear sign side should be dashboard challenge only. | `[IMPLEMENTED]` | Current rear route requires keychain scan before dashboard. |
| WordPress is marketing/presentation, not product brain. | `[INTENDED]` | App state and flows live in Vercel/Supabase; WordPress folder is local tracking. |
| Supabase sensitive writes should move through Edge Functions. | `[INTENDED]` | Current browser pages still write directly with anon key, so this is not implemented. |
| Formal remote LO coverage management should let agents and LOs request/link/accept coverage. | `[INTENDED]` | No invite/request/accept workflow, no remote availability queue, no scheduled coverage assignment, and no persistent agent-LO relationship management. Current LO support is scan/session based. |

### [PARTIAL], [NEEDS VERIFICATION], And [RISK]

| Major claim | Status | Evidence |
| --- | --- | --- |
| Formal remote LO coverage management is desired but not built. | `[INTENDED]` | No invite/request/accept workflow, no remote availability queue, no scheduled coverage assignment, and no persistent agent-LO relationship management. Current LO support is scan/session based. |
| Buyer-agent-LO chat/video is desired but not built. | `[INTENDED]` | Current code only has SMS/call/text links. |
| Full admin dashboard is built. | `[INTENDED]` | `/admin` is placeholder. |
| Root enrichment cron is live from this repo config. | `[NEEDS VERIFICATION]` | Endpoint exists; root `vercel.json` has no cron schedule. |
| `send-lead-sms` source is present. | `[NEEDS VERIFICATION]` | The app calls it, but function source was not found. |
| Outreach source under `docs/supabase-functions` is deployed. | `[NEEDS VERIFICATION]` | Files are under docs, not deployable `supabase/functions`. |
| Live RLS/schema matches direct browser writes. | `[NEEDS VERIFICATION]` | Latest anon run confirms core table/column exposure through anon PostgREST; live RLS/write behavior and service-role checks were not verified. |
| QR inventory/export process is unified. | `[RISK]` | Activation uses `smart_sign_inventory`, but export SQL uses `smart_signs`. |
