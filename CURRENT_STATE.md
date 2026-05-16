# Current State

Last inspected: 2026-05-16.

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
- `[IMPLEMENTED]` Latest inspected production deployment includes REL8TION COMMAND confirmed open house reporting and Tailwind runtime support across active app pages. Vercel reports the production alias ready at `app.rel8tion.me`; `/admin` is served by a root shell that hydrates `apps/rel8tion-app/admin.html` in place so the browser URL stays `app.rel8tion.me/admin` instead of redirecting to the app file path. The admin route served the confirm-open-house action, confirmed report cards, printable report export with explicit listed-open-house, confirmed-coverage, confirmed-on, and assigned-loan-officer labels, focus guard, quiet auto-refresh, scroll/focus restore, Leads, accepted-open-house, drip scheduling, sign event closeout controls, sign detach-to-fresh controls, widened outreach cards, and stronger glass/home-style background layer.
- `[IMPLEMENTED]` The `/event` cloud background and fixed disclosure modal fix was verified live after `main` commit `c8789ae` (`Fix event disclosure modals and cloud styling`).
- `[IMPLEMENTED]` `staging` exists as the pre-production/staging branch and currently points to the same reconciled commit as `main`.
- `[IMPLEMENTED]` The previous direct/dirty production deploy from `modular-claim-test` commit `51d2d1a` is preserved by tag `production-51d2d1a-2026-05-08`.
- `[RISK]` Do not force-push `main` and do not reset either branch. Preserve production tags and use normal merge/PR history.

## [IMPLEMENTED] Repo Code Present Today

- `[IMPLEMENTED]` Agent keychain claim flow exists at `/claim`.
- `[IMPLEMENTED]` Claimed keychains route through `/k` and then to `/a`, which redirects to `/b`.
- `[IMPLEMENTED]` `/b` loads an agent by slug, shows agent info, captures buyer preferences, saves to `leads`, calls `send-lead-sms`, and shows a three-property preference modal.
- `[IMPLEMENTED]` Agent onboarding exists at `/onboarding` and includes the smart sign activation entry point.
- `[IMPLEMENTED]` `/onboarding` shows Rel8tionChip keychain slots and can arm an "Add Backup Keychain" flow. The next scanned keychain is linked to the same agent through `/k` using `keys.device_role = keychain` and `keys.assigned_slot` slot 1/2. The flow stores both local browser state and a short-lived `smart_sign_activation_sessions` backup-keychain session so iPhone/new-tab NFC handoff can still complete the link.
- `[IMPLEMENTED]` `/onboarding` prompts agents with exactly one keychain to choose whether they have a second keychain before smart sign activation. Choosing yes arms the next scan as the backup keychain; choosing no continues to smart sign activation.
- `[IMPLEMENTED]` Smart sign activation exists at `/sign-demo-activate`.
- `[IMPLEMENTED]` Activation uses sign QR/public code lookup through `smart_sign_inventory`. Printed QR generation now treats `public.smart_sign_inventory.public_code` as the only source of truth; `smart_signs.public_code` must not be used for new QR exports.
- `[PARTIAL]` `smart_sign_inventory.inventory_type` is represented by repo migration `sql/migrations/20260516_smart_sign_inventory_inventory_type.sql` with allowed values `smart_sign` and `event_pass`. Existing/current smart sign inventory rows may keep `qr_url` values using `/s.html?code=...` or `/s?code=...`; new event pass rows must use `/pass?code=...`.
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
- `[IMPLEMENTED]` Public sign route exists at `/s` and `/sign`. `/pass` is now the Event Pass resolver route for printed Event Pass QR URLs and reuses the same resolver module with Event Pass-aware behavior.
- `[IMPLEMENTED]` `/pass?code=PUBLIC_CODE` looks up `smart_sign_inventory.public_code` first. Missing inventory shows a branded invalid Event Pass state; `inventory_type = event_pass` with no `smart_sign_id` routes to `/sign-demo-activate?code=PUBLIC_CODE&source=event_pass&fresh_qr=1`; linked event passes redirect to `/event?event=...` when the linked sign has a live event and otherwise show an Event Pass Ready setup state.
- `[INTENDED]` Event Pass is a B2B open-house technology/pass/verified-profile availability product sponsored by a loan officer, not buyer lead selling or referral purchasing. Rel8tion is not a lender, mortgage broker, or pre-approval provider, and buyer financing help is only routed when a buyer explicitly requests it.
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
- `[IMPLEMENTED]` Buyer check-in calls `send-lead-sms` for buyer and agent SMS. Local source is now checked in at `supabase/functions/send-lead-sms/index.ts`; the function is user-reported as active and working in Supabase, while deployed source/version matching still needs dashboard verification.
- `[IMPLEMENTED]` Buyer preapproval/financing routing asks for pre-approval status on buyer-facing paths, then handles optional second-opinion or discreet financing consent inside the guided disclosure modal after disclosures are reviewed. Financing outreach is opt-in: selecting "not pre-approved" alone does not trigger financing SMS. If financing help is requested, the code checks for a live loan officer session first, then falls back to Jared alert. The `buyer_agent` path skips pre-approval and disclosure prompts.
- `[IMPLEMENTED]` Post-check-in buyer UI no longer shows OneKey listing links, internal check-in status cards, the unfinished loan-officer support card, or a second check-in button. It shows a cleaner confirmation, next-step copy, property snapshot, host bio/contact actions, neighborhood SMS prompt, and a temporary financing SMS prompt to `347-775-8059`.
- `[IMPLEMENTED]` Rear sign chip flow challenges the agent to tap their keychain before opening `/agent-dashboard`.
- `[IMPLEMENTED]` Rear sign dashboard verification takes priority over any stale loan-officer sign-in prompt. Tapping the rear sign clears the pending LO browser session before waiting for the agent keychain.
- `[IMPLEMENTED]` Agent dashboard shows live event stats, leads, each lead card's agency/housing/courtesy disclosure signed/missing status, signed disclosure packet PDF link when available, outreach count, relationship status, and loan officer coverage.
- `[IMPLEMENTED]` Agent dashboard has end/move controls for the current open house. Ending marks `open_house_events.status = ended`, stamps `ended_at`, clears `smart_signs.active_event_id`, and sets the sign back to inactive without deleting captured check-ins. Moving performs the same closeout and opens sign activation for the next listing.
- `[PARTIAL]` Loan officer support exists through dashboard prompt/tag scan, `verified_profiles`, `event_loan_officer_sessions`, and the tested field/LO dashboard bundle now present on `main`: `/field-dashboard`, `/lo-field-dashboard`, `field_demo_visits`, `field_demo_visit_participants`, `field_coverage_availability`, `/api/field-demo/*`, and `/api/event-chat/*`. Admin LO assignment also creates field visit/participant records when the field tables are available. Formal agent-LO relationships, invite/request/accept workflows, hardened auth, realtime chat, and calendar conflict checking are still not complete.
- `[IMPLEMENTED]` NMB loan officer activation/profile pages exist at `/nmb-activate` and `/nmb-verified`.
- `[PARTIAL]` `/admin` is now the admin-keychain/token-protected REL8TION COMMAND dashboard. It has a cloud/glass command-shell layout with sidebar area navigation, a top command/search bar, live overview stats, hot-list-style outreach cards with agent/listing imagery, inline SMS reply composers, thread history, a Leads area, Agent CRM, smart signs/events, loan officer assignment/profile/session views, accepted/confirmed open house field visits, payments-needed setup, and outreach reports. It loads privileged data through `/api/admin/dashboard` and `/api/admin/outreach-inbox`, sends replies through `/api/admin/outreach-reply`, assigns/ends/auto-assigns live loan officer coverage through `/api/admin/loan-officer-assignment`, can end active sign events through `/api/admin/event-action`, can detach a smart sign through `/api/admin/sign-action` after typing `REL8TION` by ending any live linked event/LO coverage and clearing the assigned agent while preserving the sign chips/QR alias, can mark interested outreach, confirm a true open house into `field_demo_visits` with `review_status = confirmed_open_house` through a calendar coverage picker, accept an open house into `field_demo_visits`, assign or quick-reassign an LO participant from the outreach card while showing accepted/coverage/LO summary details, generate an ultra-compact landscape PDF-style confirmed-open-house report modeled after `docs/replied-agents-ultra-compact-current-2026-04-24.pdf` with explicit listed-open-house, confirmed-coverage, confirmed-on, and "Loan Officer Assigned" lines, and schedule follow-up drip SMS through `/api/admin/outreach-action`, and links active LOs into `/lo-field-dashboard?uid=...`. Browser auto-refresh skips while a command form control or coverage picker is active and restores scroll/focus/cursor after manual or background reloads so outreach typing is not interrupted. Billing tables and full calendar conflict editing are not wired.
- `[IMPLEMENTED]` All active `apps/rel8tion-app` HTML pages now load the Tailwind runtime. Custom static pages that already have hand-authored glass/cloud CSS use Tailwind with preflight disabled so utility styling can be layered in without resetting the existing production UI.
- `[IMPLEMENTED]` Temporary key/sign reset admin tooling exists at `/key-reset` with server API `api/admin/reset-key.js`.
- `[IMPLEMENTED]` The temporary reset tooling is restricted to the protected beta lane only: keychain UID `7ce5a51b-8202-4178-afc7-40a2e10e2a4d`, sign public code `0e4b015f3782`, front chip UID `f005e166-70b3-407c-ba24-b91464a3d22a`, and rear chip UID `b70d2bde-d185-43ee-8962-083b64fa4347`. Elena/Galluzzo sign data remains protected by reset guardrails.
- `[IMPLEMENTED]` Beta fresh-claim cleanup clears stale browser host/sign activation sessions and inactive sign QR scans preserve the current host session, so a newly claimed demo keychain profile can carry forward into sign activation instead of falling back to stale `agent-*` context.
- `[IMPLEMENTED]` The dedicated beta keychain route now expires stale local sign-activation browser sessions and opens the beta claim/reset menu before stale remote `smart_sign_activation_sessions` can hijack the scan. Fresh local sign activation handshakes still continue when the same browser is actively in that flow.
- `[IMPLEMENTED]` Beta sign QR resolution and `/sign-demo-activate` now treat the live scanned keychain row (`keys.uid -> keys.agent_slug`) as authoritative over stale URL `agent` parameters, stale `rel8tion_host_session`, or stale local `rel8tion_sign_demo_session` data. The beta sign code `0e4b015f3782` will ignore a remembered host session unless it belongs to the beta keychain UID.
- `[IMPLEMENTED]` In the beta keychain claim flow, once a real typed profile is saved, that profile identity is locked for the activation run. Selecting an open house can still attach the listing/property context, but stale `listing_agents` or `open_houses.agent` data should not overwrite the typed keychain profile name/phone/brokerage.
- `[IMPLEMENTED]` Estately enrichment worker exists and is configured for batch size 20.
- `[IMPLEMENTED]` OneKey listing freshness worker exists at `onekey-freshness-worker.cjs` with API route `api/cron/refresh-open-house-data.js`. It checks current OneKey listing records by tight lat/lng search, matches by `UniqueListingId`, updates listing facts/prices, records price-history rows when the migration is applied, and refreshes active event price snapshots.
- `[PARTIAL]` OneKey freshness schema is represented by migration `sql/migrations/20260509_open_house_freshness.sql`, adding `open_houses` verification/override fields and `open_house_price_history`. The migration was applied live on 2026-05-09 and anon zero-row schema verification passed; privileged RLS/service-role behavior remains `[NEEDS VERIFICATION]`.
- `[IMPLEMENTED]` Root `vercel.json` includes Vercel Cron entries for `/api/cron/refresh-open-house-data`, `/api/cron/generate-agent-outreach`, `/api/cron/render-agent-mockups`, and `/api/cron/send-agent-outreach`. Production includes the outreach cron functions and `CRON_SECRET`. On 2026-05-14, `/api/cron/send-agent-outreach` was invoked successfully against production, sent future-open-house outreach, and confirmed terminal Twilio rejects are marked blocked so the queue can advance. On 2026-05-15, Supabase Edge Function `send-agent-outreach` was deployed with admin-scheduled drip support for rows where `review_status = drip_scheduled`. Render auth uses `CRON_SHARED_SECRET` with `CRON_SECRET` fallback for the root wrapper, and production `CRON_SECRET`/`CRON_SHARED_SECRET` are configured on the `mockup-renderer` Vercel project.
- `[NEEDS VERIFICATION]` No tracked Browserless/Trulia enrichment implementation was found during the 2026-05-09 repo audit. Current tracked enrichment is the Estately + Cheerio worker. If Browserless/Trulia enrichment is intended, it needs implementation or source recovery.
- `[IMPLEMENTED]` Mockup renderer app exists under `apps/mockup-renderer` with cron wrappers and tests.
- `[IMPLEMENTED]` Twilio inbound reply Edge Functions are checked in under `supabase/functions`.
- `[IMPLEMENTED]` `send-agent-manual-reply` is checked in under `supabase/functions` and was deployed on 2026-05-14. The function requires the Supabase service-role bearer token, rejects browser/anon calls, inserts outbound replies into `agent_outreach_replies`, and updates the linked `agent_outreach_queue` row.
- `[IMPLEMENTED]` A read-only live verification system exists under `docs/live-verification/` with `npm run verify:live`.
- `[PARTIAL]` Latest live verification anon run on 2026-05-09 succeeded with summary `PASS 108`, `WARN 6`, `NEEDS_VERIFICATION 10`, `FAIL 0`. Core tables and expected columns, including OneKey freshness fields and `open_house_price_history`, passed anon zero-row schema probes. This confirms live schema exposure through the anon PostgREST access path, not full RLS correctness, write behavior, deployment health, or production data quality.

## [PARTIAL] And [NEEDS VERIFICATION]

- `[PARTIAL]` Root `vercel.json` now has a cron for OneKey freshness. `api/cron/enrich-agents.js` still exists but is not scheduled by the root config.
- `[PARTIAL]` The Estately worker can enrich `listing_agents`, but quality depends on Estately parsing and phone validation.
- `[PARTIAL]` `/admin` has the REL8TION COMMAND operator dashboard with outreach replies, leads, interested-reply triage, true-open-house confirmation, accepted-open-house field visit creation, confirmed-open-house report cards/printable PDF-style report export, drip scheduling, active sign event closeout, smart-sign detach-to-fresh controls, live LO assignment controls, and read/reporting sections for signs, events, CRM, payments-needed setup, and analytics. Broader sign inventory editing, CRM record mutation, billing, and calendar availability are still future work.
- `[NEEDS VERIFICATION]` Some outreach source still exists under `docs/supabase-functions`; deployment state for each function should be verified before relying on docs-only source.
- `[PARTIAL]` WordPress hot-list files exist locally, but they are not automatically synced to WordPress.
- `[PARTIAL]` `/b` buyer profile and `/event` smart sign check-in are both active concepts but save into different tables.
- `[RISK]` Several root/static pages are legacy or test artifacts. Use `vercel.json` before assuming a page is live.
- `[NEEDS VERIFICATION]` Live RLS state is not fully knowable from checked-in files or the latest anon zero-row schema probes.
- `[RISK]` `event_loan_officer_sessions` SQL grants anon/auth select, insert, and update; live RLS state needs verification.
- `[NEEDS VERIFICATION]` `find_nearest_open_house`, `queue_recent_outreach_candidates`, `verified_profiles_lookup`, and `verified_profiles_activate_or_create` are still unverified after the latest anon run.
- `[PARTIAL]` `send-lead-sms` local source is checked in at `supabase/functions/send-lead-sms/index.ts`. The function is user-reported as active and working in Supabase; the verification script intentionally does not call SMS functions, so deployed source/version and Twilio behavior remain `[NEEDS VERIFICATION]`.
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
- `[PARTIAL]` Buyer-agent-loan-officer event chat logging exists through `event_conversations`, `event_conversation_messages`, `/api/event-chat/list`, `/api/event-chat/send`, and `/field-dashboard`. It is not realtime, not SMS-relayed, not video, and not a hardened multi-user auth model yet.
- `[INTENDED]` Rich buyer dashboard with external listing-site/Zillow-style media, neighborhood data, and persistent chat is not built. Current `/event` post-check-in experience shows available property/agent/LO context and uses SMS/call links for messaging.
- `[INTENDED]` Call/video workflow beyond simple call/text links is not built.
- `[PARTIAL]` REL8TION COMMAND exists as the protected admin dashboard and can assign live LO coverage to active open house events, end active sign events, detach a smart sign to make it fresh again, view leads, confirm true outreach open houses into field visits/reports, accept interested outreach into field visits, assign a loan officer participant, generate confirmed open house PDF-style reports, and schedule a follow-up drip. The deeper action layer for broader sign inventory edits, CRM updates, LO calendar/availability modification, billing automation, and full project controls is not complete.
- `[INTENDED]` Full automated E2E tests for NFC, sign activation, buyer check-in, dashboard, and SMS are not present.
- `[IMPLEMENTED]` `smart-sign-qr-export.sql` now exports only from `public.smart_sign_inventory`, includes separate unprinted Event Pass, unprinted Smart Sign, and all-unprinted inventory exports, and includes optional Smart Sign 1000-row insert plus Event Pass insert/qr_url-fix/mark-printed blocks.
- `[PARTIAL]` Manual listing fallback creates event context but no linked `open_house_source_id`, which limits listing-data and outreach behavior.

## Changed Recently

Recent repo state includes:

- `[IMPLEMENTED]` `/pass` now runs as a real Event Pass resolver: it reads `smart_sign_inventory.public_code`, preserves smart-sign behavior for smart-sign rows, routes fresh Event Pass inventory into setup, redirects linked/live passes to `/event`, and shows branded invalid/inactive Event Pass states.
- `[IMPLEMENTED]` Production now deploys from `main`; the `/event` cloud/modal fix was verified live after commit `c8789ae`.
- `[IMPLEMENTED]` `staging` was created and pushed as the staging/pre-production branch.
- `[IMPLEMENTED]` The older production deploy from `modular-claim-test` commit `51d2d1a` remains tagged as `production-51d2d1a-2026-05-08`.
- `[IMPLEMENTED]` Sign activation now carries forward the open house selected during keychain claim and offers it first for sign binding.
- `[IMPLEMENTED]` Sign activation now displays agent profile name/brokerage from the agent row instead of showing only a raw slug such as `agent-gwh`.
- `[IMPLEMENTED]` Root env files were removed from git tracking, `.env*` is ignored, and `.vercelignore` helps keep local/docs artifacts out of deploy uploads.
- `[IMPLEMENTED]` Beta keychain/sign lane for `main-beta`.
- `[IMPLEMENTED]` Beta reset/restore helpers in the claim flow.
- `[IMPLEMENTED]` Beta fresh-claim flow now clears stale host session state and blocks auto-activation from generating a generic `Agent` slug when no real agent name is available.
- `[IMPLEMENTED]` Beta sign activation identity now follows the current live beta keychain mapping and cannot be overridden by an old Jared or other stale browser/URL agent value.
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
- `[IMPLEMENTED]` Agent onboarding can arm and link a backup keychain slot for the same agent. Both keychain slots use the normal `/k?uid=...` route, and backup linking no longer depends only on same-tab localStorage because `/onboarding` creates a short-lived remote backup-keychain session consumed by `/k`.
- `[IMPLEMENTED]` Agent onboarding now asks whether the agent has a second keychain as soon as setup opens with one keychain. Smart sign activation is blocked while a backup-keychain scan is armed, so the agent must finish or cancel the backup scan before activating a sign.
- `[IMPLEMENTED]` `/k` compares pending sign-activation and backup-keychain sessions by freshness when both exist. The newest armed intent wins, so stale sign activation cannot hijack backup keychain setup and stale backup setup should not hijack a newly armed sign activation.
- `[PARTIAL]` Old physical signs that need more than one buyer entry point should use one printed QR/public code plus additional front/buyer NFC chip aliases. The old activation-screen second-QR linking option was removed because the requested add-on is another NFC chip, not another QR.
- `[IMPLEMENTED]` Open house listing ranking for keychain claim and sign activation is location-first again. The client now recomputes miles from listing lat/lng, compares open-house days in `America/New_York`, uses a tight local fallback window, and only uses active/upcoming time as a tie-breaker so farther Brooklyn/Queens rows do not outrank closer Oceanside-area rows.
- `[IMPLEMENTED]` The claim "Is This You?" screen now treats `Agent`, `Listing Agent`, `Unknown Agent`, and `Real Estate Agent` as placeholder names. It normalizes `listing_agents` rows before display and looks up the best enriched listing-agent profile by open house or phone so stale/generic source names do not hide real agent names, photos, phone numbers, or brokerages.
- `[IMPLEMENTED]` Agent dashboard End/Move event controls now send PATCH requests through the shared dashboard request helper. This prevents an ended open house from leaving `smart_signs.active_event_id` live and blocking the agent from binding the same sign to the next open house.
- `[PARTIAL]` REL8TION COMMAND admin dashboard was restyled into the cloud/glass dashboard shell with sidebar navigation, top search/area controls, command score, polished stat tiles, and operator controls for leads, outreach replies, interested/accepted open houses, drip scheduling, active sign event closeout, CRM/sign/LO/payment/report panels.
- `[IMPLEMENTED]` REL8TION COMMAND admin auto-refresh now backs off while the operator is typing in command controls and preserves scroll position, focused field, field value, and cursor selection when a reload does occur.
- `[PARTIAL]` REL8TION COMMAND outreach can now mark a reply/listing as a confirmed true open house. Confirming opens a coverage calendar with stored open-house day buttons, an all-days option when available, and custom date/time fields before writing the field visit/report window. The Reports section builds searchable and sortable upcoming/previous confirmed open house cards and a printable PDF-style report with confirmation date, selected open house times, property details, listing/mockup/agent photo URLs, conversation snapshot, and LO coverage when recorded. Confirmed reports can sort by smart date, open date, confirmed date, loan officer, agent, property, or status.
- `[PARTIAL]` REL8TION COMMAND Reports now generate a browser print-to-PDF ultra-compact table report instead of a plain CSV export. The generated report uses the prior replied-agents PDF layout: landscape page, small Arial type, listing photo column, Property + Agent metadata, Me/outbound copy, and Agent/inbound reply columns.
- `[PARTIAL]` REL8TION COMMAND outreach cards show an accepted/confirmed field-visit summary after acceptance, including selected coverage date/time, accepted/confirmed timestamp, and primary loan officer details when assigned. The card's accept control becomes a quick LO reassignment control, and accepting an already-confirmed open house preserves the previously selected coverage window.
- `[PARTIAL]` Loan officer local sign-in support added through verified profiles and `event_loan_officer_sessions`. Formal remote LO coverage management is not built: no invite/request/accept workflow, no remote availability queue, no scheduled coverage assignment, and no persistent agent-LO relationship management. Current LO support is scan/session based.
- `[IMPLEMENTED]` Estately enrichment worker changed to batch size 20 and upcoming-first/backlog-later prioritization.
- `[IMPLEMENTED]` OneKey listing freshness worker, API route, cron config, migration, npm scripts, and live-verification contract entries were added so stale prices can be checked against current OneKey source data.
- `[IMPLEMENTED]` `M00000489-971018` / `703 Neptune Blvd` now accepts OneKey as source of truth: `price = source_price = 1399998`, `manual_price_override = null`, and `freshness_status = verified`. A privileged SQL check confirmed price-history audit rows for the correction from stale `$1,450,000` through the temporary manual display and then back to the OneKey source price.
- `[NEEDS VERIFICATION]` Outreach cleanup and bad-phone handling were worked on, but live deployment and current queue health need verification.

## [INTENDED] Build Next

Highest-value next work:

1. Run privileged/dashboard verification for RLS policies, service-role schema checks, deployed Edge Functions, RPC definitions, and Vercel Cron state.
2. Verify the deployed `/api/cron/refresh-open-house-data` route and Vercel Cron dashboard state after deploy; the live schema exists, but scheduled execution has not been proven.
3. Confirm the currently configured Vercel routes and whether the Estately enrichment cron is intentionally disabled or missing.
4. Re-run `npm run verify:live` after schema, route, or function changes and review the generated report without committing it.
5. Reconcile smart sign QR source so printed QR codes, inventory rows, and sign rows use one consistent process.
6. Build formal remote LO coverage management:
   - loan officer profiles
   - agent/loan officer relationships
   - event invites
   - accept/decline flow
   - remote availability queue
   - scheduled coverage assignment
   - event start prompt
   - live coverage session
   - buyer financing alert and contact modal
7. Continue the protected REL8TION COMMAND dashboard from outreach, leads, sign event closeout, accepted open house scheduling, drip follow-up, and live LO assignment into action controls for CRM edits, sign inventory record management, LO calendar/availability workflows, billing/payment state, and analytics drilldowns.
8. Add a small E2E/runbook suite for:
   - claim keychain
   - activate sign QR
   - pair front/rear chips
   - bind listing
   - buyer check-in
   - rear dashboard challenge
   - loan officer sign-in
   - reset beta sign/key
9. Unify `/b` profile leads and `/event` check-ins by treating `leads` as the global CRM/person record and `event_checkins` as the event-specific attendance/action record.
10. Harden outreach phone validation and queue rules before re-enabling broad automation.

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
| Admin command dashboard exists. | `[PARTIAL]` | `apps/rel8tion-app/admin.html` plus protected `/api/admin/dashboard`, `/api/admin/outreach-inbox`, `/api/admin/outreach-reply`, `/api/admin/loan-officer-assignment`, `/api/admin/event-action`, `/api/admin/sign-action`, and `/api/admin/outreach-action`; leads, outreach replies, interested/confirmed/accepted open house workflow, confirmed open house reports/PDF-style export, drip scheduling, sign event closeout, smart-sign detach-to-fresh, live LO assignment, and LO dashboard launch links are implemented, while CRM edits, broader sign inventory record edits, payment controls, and calendar availability editing remain unfinished. |
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
| Buyer-agent-LO chat/video is desired but not built. | `[PARTIAL]` | In-app event conversation logging exists through `event_conversations`, `event_conversation_messages`, `/api/event-chat/*`, and `/field-dashboard`; realtime delivery, SMS relay, push alerts, video, and hardened auth are not built. |
| Full admin action dashboard is built. | `[PARTIAL]` | REL8TION COMMAND exists at `/admin` with leads, outreach replies, interested/confirmed/accepted open house workflow, confirmed open house reports/PDF-style export, drip scheduling, sign event closeout, smart-sign detach-to-fresh, live LO assignment, and live read/reporting cards, but broader sign inventory record edits, CRM edits, LO calendar/availability changes, and billing automation remain unfinished. |
| Root enrichment cron is live from this repo config. | `[NEEDS VERIFICATION]` | Endpoint exists; root `vercel.json` has no cron schedule. |
| `send-lead-sms` source is present. | `[IMPLEMENTED]` | Source now exists at `supabase/functions/send-lead-sms/index.ts`; live deployment/source matching and Twilio behavior still need verification because the verifier does not send SMS. |
| Outreach source under `docs/supabase-functions` is deployed. | `[NEEDS VERIFICATION]` | Files are under docs, not deployable `supabase/functions`. |
| Live RLS/schema matches direct browser writes. | `[NEEDS VERIFICATION]` | Latest anon run confirms core table/column exposure through anon PostgREST; live RLS/write behavior and service-role checks were not verified. |
| QR inventory/export process is unified. | `[IMPLEMENTED]` | `smart-sign-qr-export.sql` exports from `public.smart_sign_inventory` only. `inventory_type` is constrained to `smart_sign` or `event_pass`; smart sign rows may keep `/s.html` or `/s` URLs, and event pass rows print and resolve through `/pass` URLs. |
