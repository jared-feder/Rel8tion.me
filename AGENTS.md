# AGENTS.md

Repo operating guide for future Codex sessions working on REL8TION.

Last inspected: 2026-05-30.

Status labels used in this file:

- `[IMPLEMENTED]` means code exists in the repo. It does not guarantee that the feature is deployed, live, passing RLS, or working with current Supabase production data.
- `[PARTIAL]` means some code exists, but the complete product behavior is not built or not fully wired.
- `[INTENDED]` means this is a REL8TION business/product rule or target architecture, not proof of current implementation.
- `[NEEDS VERIFICATION]` means the repo is not enough to prove live behavior, deployment, schema, RLS, or external service state.
- `[RISK]` means this can break demos, production data, security, SMS, or user trust if handled casually.

## Read This First

`[IMPLEMENTED]` This repo is a product workspace with static Vercel pages, Supabase data access, Twilio/SMS integration points, WordPress-side working files, and many historical handoff docs. Treat the current route files and current source code as the source of truth. Older docs are useful context but should not override the current implementation.

`[IMPLEMENTED]` Production is configured to deploy from the `main` branch to `app.rel8tion.me`. Use Vercel inspection plus `git log -1 origin/main` when an exact live SHA is needed. The earlier direct deploy from `modular-claim-test` commit `51d2d1a` is preserved as tag `production-51d2d1a-2026-05-08`.

`[IMPLEMENTED]` Branch cleanup moved production to `main` and created `staging` as the preview/staging branch. Vercel API inspection on 2026-05-09 confirmed project Git `productionBranch = main`; the `/event` cloud/modal fix was verified live after `main` commit `c8789ae`. Do not force-push either branch.

`[INTENDED]` After any production-flow change, update `CURRENT_STATE.md` immediately and update `REL8TION_SYSTEM_OVERVIEW.md` when routes, schema expectations, NFC behavior, SMS behavior, dashboard behavior, compliance behavior, or deployment/source-of-truth status changes.

Before making changes, inspect:

- `vercel.json`
- `apps/rel8tion-app/vercel.json`
- `apps/rel8tion-app/k.html`
- `apps/rel8tion-app/sign-demo-activate.html`
- `apps/rel8tion-app/src/modules/signResolver/*`
- `apps/rel8tion-app/src/modules/eventShell/*`
- `apps/rel8tion-app/agent-dashboard.html`
- `apps/rel8tion-app/field-dashboard.html`
- `apps/rel8tion-app/claim.html`
- `apps/rel8tion-app/src/modules/claimStyled/*`
- `apps/rel8tion-app/onboarding.html`
- `apps/rel8tion-app/agent-home.html`
- `b.html` and `a.html`
- `api/chip-qr.js`
- `api/admin/reset-key.js`
- `api/admin/key-action.js`
- `api/admin/sign-action.js`
- `api/sponsored-pass/action.js`
- `api/lo-sign/action.js`
- `api/cron/enrich-agents.js`
- `api/cron/refresh-open-house-data.js`
- `estately-enrichment-worker.cjs`
- `onekey-freshness-worker.cjs`
- `supabase/functions/*`
- `sql/*.sql` and `sql/migrations/*.sql`
- `wordpress/README.md`

## [IMPLEMENTED] Current App Shape

The repo's current app surface is primarily static HTML plus browser JavaScript. The root `vercel.json` rewrites most currently configured app routes into `apps/rel8tion-app`.

Important route behavior:

- `[IMPLEMENTED]` `/k` is the NFC/key router and routes keychains, sign chips, loan officer tags, and reset scans.
- `[IMPLEMENTED]` `/claim` is the agent keychain claim flow.
- `[IMPLEMENTED]` `/onboarding` is the post-claim agent setup page and contains the smart sign activation entry point.
- `[PARTIAL]` `/agent-home` is the permanent agent owner dashboard. Normal claimed agent NFC scans open `/agent-home?agent=<slug>&uid=<uid>` after higher-priority setup, rear-sign, Event Pass, loan-officer, and backup-keychain flows are ruled out. The public/share QR profile remains `/b?agent=<slug>`.
- `[IMPLEMENTED]` `/sign-demo-activate` is the smart sign setup and listing binding flow.
- `[IMPLEMENTED]` `/s` and `/sign` resolve a smart sign public code and route to activation or live event.
- `[IMPLEMENTED]` `/pass` resolves printed Event Pass QR inventory from `smart_sign_inventory.public_code` and routes fresh single-event passes into QR-first Event Pass setup. Sponsored Event Pass rows with `pass_model = sponsored_agent_pass` route to `/sponsored-pass-activate?code=PUBLIC_CODE` when no live event is linked and reuse is active.
- `[IMPLEMENTED]` `/sponsored-pass-activate` activates reusable Sponsored Event Passes. It requires an active sponsor, open-house selection, host-agent info, and per-event agent consent before creating/reusing the live event, `event_pass_coverage_consents` row, and sponsor LO session. If the pass was issued from `/lo-sign-activate`, it should prefill the seeded open house/agent context from `smart_sign_inventory.metadata` and reuse the matching live LO coverage event when possible.
- `[IMPLEMENTED]` `/lo-sign` resolves reusable Loan Officer Coverage Signs from `loan_officer_coverage_signs.public_code`. Active signs redirect buyer-style QR scans to `/event`; inactive assigned signs route to `/lo-sign-activate`.
- `[IMPLEMENTED]` `/lo-sign-setup` is the loan-officer dashboard hardware setup lane. The LO starts from the dashboard, scans a pooled LO sign QR, then taps both physical sign NFC chips. `/k` registers those chips into `loan_officer_coverage_signs.uid_primary` and `uid_secondary`; legacy `uid` remains the primary-chip compatibility alias.
- `[IMPLEMENTED]` `/lo-sign-activate` lets the assigned LO activate coverage for a selected open house, creates a live event/LO coverage session, updates `loan_officer_coverage_signs`, and can issue a Sponsored Event Pass to an agent without silently activating that pass for buyer-data visibility.
- `[IMPLEMENTED]` LO Coverage Sign activation uses a QR-only backing `smart_signs` row with a deterministic synthetic `uid_primary` (`synthetic:lo-coverage-sign:<code>`) so the current live `smart_signs.uid_primary` not-null schema does not require a buyer NFC chip. Service-side Sponsored Event Pass activation uses `synthetic:event-pass-qr:<code>` until the physical Event Pass NFC flow provides a real UID.
- `[IMPLEMENTED]` LO Coverage Sign activation also writes the matching `field_demo_visits` and `field_demo_visit_participants` rows so the assigned loan officer sees the live event in the Loan Officer Dashboard (`/loan-officer-dashboard`, with `/lo-field-dashboard` kept as a backward-compatible alias) right after activation.
- `[IMPLEMENTED]` `/lo-sign-activate` exposes host-agent search/selection and optional host-agent photo upload so LO sign activations can populate the buyer-facing agent card instead of forcing manual faceless entries.
- `[IMPLEMENTED]` `/loan-officer-dashboard` is the clean LO dashboard alias. It opens the same `field-dashboard?role=loan_officer` surface as `/lo-field-dashboard`, labels the page by the LO first name, defaults to important cards/urgent notifications/quick actions, includes Buyer Affordability, Edit Profile, and Set Up Coverage Sign actions, and keeps availability, worked agents, and full open-house/buyer lists behind the section menu.
- `[IMPLEMENTED]` `/event` is the smart sign buyer check-in page.
- `[IMPLEMENTED]` `/event-chat` is the buyer return page for event chat SMS links. `/api/event-chat/send` creates buyer access tokens and sends SMS links when an LO/field specialist sends a dashboard chat message.
- `[IMPLEMENTED]` `/agent-dashboard` is the live event dashboard for the host agent.
- `[PARTIAL]` `/get-open-house-kit`, `/kit-confirm`, and `/kit-intake` support the getrel8tion.com Open House Kit landing, keychain prefill, manual intake, and Stripe Checkout handoff.
- `[IMPLEMENTED]` `/c/:code` and `/chip/:code` resolve printed Rel8tionChip QR inventory through `api/chip-qr.js`. Linked agent QR rows redirect to `/b?agent=<slug>`; linked loan-officer/NMB/verified-professional QR rows redirect to `/nmb-verified?slug=<lo_slug>`; unlinked rows show a branded not-linked state and can carry the QR code into NFC claim/dashboard linking.
- `[PARTIAL]` `/loan-officer-dashboard` is the clean loan-officer operations dashboard alias. `/lo-field-dashboard` still works for existing NFC/keychain links and routes to the same `field-dashboard?role=loan_officer` surface. The dashboard shows assigned open houses, buyer financing/chat, Affordability actions, availability, and worked agents. Full persistent agent-LO relationship management is still not built.
- `[IMPLEMENTED]` Buyer affordability/property-fit scenarios include annual property taxes and annual homeowners insurance. Keep these as property expense fields, not borrower financial/application data, and keep LO guidance saves returning to the originating dashboard when a `return_to` query value is present.
- `[PARTIAL]` `/nmb-activate` and `/nmb-verified` are loan officer tag/profile pages. Formal remote LO coverage management is not built: no invite/request/accept workflow, no remote availability queue, no scheduled coverage assignment, and no persistent agent-LO relationship management. Current LO support is scan/session based.
- `[IMPLEMENTED]` `/loan-officer-support` is a public loan-officer open-house-support request form. It stores requests server-side in `loan_officer_support_requests` and surfaces them in REL8TION COMMAND under Loan officers.
- `[PARTIAL]` `/key-reset` is an admin/beta reset utility. It is not a full admin dashboard.
- `[IMPLEMENTED]` `/a` is a root static redirect page that sends public/profile traffic to `/b`. Normal claimed NFC owner scans should not rely on `/a`; they now use `/agent-home`.
- `[IMPLEMENTED]` `/b` is a root static buyer profile and lead capture page tied to an agent slug.
- `[IMPLEMENTED]` `/` on `app.rel8tion.me` is a production-safe Rel8tion entry page with public CTAs only. Do not restore the old Vercel smoke-test copy there and do not expose `/admin` from the public root.
- `[IMPLEMENTED]` Current sign activation carries a selected open house from the keychain claim host session and offers it first for sign binding.
- `[IMPLEMENTED]` Current sign activation loads agent profile data and displays agent name/brokerage instead of relying on raw slugs in the visible activation flow.
- `[IMPLEMENTED]` `/onboarding` can arm an "Add Backup Keychain" flow. `/k` links the next scanned keychain to the same agent using `keys.device_role = keychain` and `keys.assigned_slot` 1/2. Keep the localStorage plus short-lived `smart_sign_activation_sessions` remote fallback, because iPhone/new-tab NFC handoff can lose same-tab local state.
- `[IMPLEMENTED]` `/onboarding` prompts for a second keychain before smart sign activation when an agent has exactly one keychain. Do not let smart sign activation start while a backup-keychain scan is armed.
- `[PARTIAL]` Multiple printed sign QR codes can be used for one sign only when their `smart_sign_inventory.public_code` rows point to the same `smart_sign_id`. `/s` and `/agent-dashboard` resolve inventory aliases, and the activation success screen can link a second printed QR to the current sign. There is no polished admin dashboard for QR alias management yet.
- `[IMPLEMENTED]` Printed agent Rel8tionChip QR inventory is separate from NFC UIDs in `rel8tion_chip_inventory`. The first 1000 agent QR rows are seeded as batch `agent-keychain-001` with URLs like `https://irel8.me/c/ra0018b9`. During claim, or later from `/agent-home`, a QR can be linked to the claimed NFC UID and agent slug.
- `[IMPLEMENTED]` Printed loan officer Rel8tionChip QR inventory uses the same `/c/:code` resolver but should stay prospect-facing. Linked `chip_type = nmb|verified|professional` rows use `verified_profile_uid` and open `/nmb-verified?slug=<lo_slug>`. The loan officer NFC UID/keychain side remains private owner access to the Loan Officer Dashboard. Live quick batch `lo-keychain-quick-20260530` has `lq000001` through `lq000005` linked to Jared Feder's active verified profile.

The repo also has root wrapper files such as `claim.html`, `event.html`, `s.html`, and `sign.html` that redirect into `apps/rel8tion-app`. Do not assume root and app copies are identical.

`[RISK]` Legacy/test artifacts are present at root and in folders such as `smart-sign/` and `openai/Rel8tion.info/`. Use `vercel.json` and the active app files to decide what is live before editing an older page.

## [INTENDED] Critical Product Rules

These rules matter more than code style.

- `[INTENDED]` A buyer-facing sign chip must not activate or claim a sign.
- `[IMPLEMENTED]` The front sign chip is the buyer/check-in chip. In current code it is stored as `uid_primary` with `primary_device_type = front_buyer_chip`.
- `[IMPLEMENTED]` The rear sign chip is the agent/dashboard chip. In current code it is stored as `uid_secondary` with `secondary_device_type = rear_agent_chip`.
- `[IMPLEMENTED]` Rear sign scan currently requires a keychain challenge before dashboard access.
- `[IMPLEMENTED]` Agent sign activation requires the keychain handshake. The system verifies agent ownership by scanning the agent Rel8tionChip/keychain in current setup flows.
- `[INTENDED]` The buyer path should stay low-friction and route to the live check-in or profile experience.
- `[INTENDED]` Activation controls belong in agent/onboarding/sign activation flows, not on the buyer page.
- `[IMPLEMENTED]` A live sign is designed in SQL/code to attach to one active `open_house_events` row at a time.
- `[IMPLEMENTED]` Each smart sign still has two NFC chip roles in the current data model: front buyer chip and rear agent chip. Extra printed QR codes are not extra NFC chips; they must be inventory aliases for the same sign.
- `[IMPLEMENTED]` Agent Rel8tionChip behavior is intentionally split: NFC is private owner access, while printed QR is the public profile/share side. Do not route printed agent QR codes directly to `/agent-home`.
- `[IMPLEMENTED]` Loan officer Rel8tionChip behavior follows the same split: NFC is private owner/dashboard access, while printed QR opens the public verified profile. Do not route printed LO QR codes directly to `/loan-officer-dashboard` or `/lo-field-dashboard`.
- `[IMPLEMENTED]` Event Pass behavior is intentionally split from agent profile products: printed Event Pass QR starts setup through `/pass`, the Event Pass NFC becomes `keys.device_role = event_pass_keychain`, and future Event Pass NFC taps open the one-event dashboard when live.
- `[IMPLEMENTED]` Sponsored Event Pass behavior is split from single-event Event Pass behavior: it remains an `inventory_type = event_pass` QR row, but uses `pass_model = sponsored_agent_pass`, `reuse_allowed = true`, and `reuse_status = active` for reusable LO-issued passes.
- `[IMPLEMENTED]` Sponsored Event Pass activation must record per-event host-agent consent in `event_pass_coverage_consents` before the sponsoring loan officer receives event check-in visibility or is assigned as live event support.
- `[IMPLEMENTED]` Sponsored Event Pass seed context is not consent. LO Coverage Sign issuance may store prepared open-house/host-agent context on the pass inventory so the agent does not start from a blank claim, but the seed is marked consumed after the agent activates and consents.
- `[IMPLEMENTED]` Loan Officer Coverage Sign behavior is separate from Sponsored Event Pass behavior. The LO sign stays with the loan officer and routes by `/lo-sign`; the Sponsored Event Pass stays with the agent and routes by `/pass` then `/sponsored-pass-activate`.
- `[IMPLEMENTED]` LO Coverage Sign QR pool batch `lo-sign-001` uses `loan_officer_coverage_signs.public_code` values `lo000001` through `lo000100` and QR URLs under `/lo-sign?code=...`. These QR codes are assigned to LOs later through `/lo-sign-setup`; do not merge them into Event Pass QR setup or change existing printed Event Pass URLs.
- `[INTENDED]` Sponsored Event Pass and Loan Officer Coverage Sign are not buyer lead-sale/referral-purchase products. The LO sponsors open-house technology and event support; the host agent remains the real estate/open-house host.
- `[INTENDED]` Buyer financing help must only be routed when the buyer explicitly requests financing or pre-approval help. Rel8tion must not collect SSN, credit, income, assets, borrower documents, or mortgage application data.
- `[IMPLEMENTED]` A Smart Sign and an Event Pass may both be active for the same listing/open-house context because routing is device/sign-aware rather than listing-blocked. Sponsored Event Passes issued from an LO Coverage Sign may share the existing live coverage event after agent consent; other Event Pass flows may create their own event row.
- `[IMPLEMENTED]` Event Pass is gated as one included event unless renewed/reset by LO/admin. Once a pass has prior event history and is not live for that same event, self-service reuse is blocked.
- `[RISK]` Do not detach or reset real field signs unless explicitly requested. Elena/Galluzzo sign data has been treated as protected in reset code.
- `[IMPLEMENTED]` The demo/beta lane currently uses:
  - keychain UID `7ce5a51b-8202-4178-afc7-40a2e10e2a4d`
  - agent slug `main-beta`
  - sign public code `0e4b015f3782`
  - front chip UID `f005e166-70b3-407c-ba24-b91464a3d22a`
  - rear chip UID `b70d2bde-d185-43ee-8962-083b64fa4347`
- `[IMPLEMENTED]` `/key-reset` is token-protected and restricted to the beta lane above. Do not broaden reset scope without explicit approval.
- `[RISK]` Smart sign QR activation currently resolves `smart_sign_inventory.public_code` first. The older `smart-sign-qr-export.sql` exports from `smart_signs.public_code`; reconcile this before batch printing.
- `[RISK]` Outreach and auto-reply behavior can spend money and affect real agent conversations. Do not deploy or enable new outbound behavior without checking filters, quiet hours, opt-out handling, and owner approval. REL8TION COMMAND's outreach inbox must load inbound rows separately from recent all-thread rows so automatic outbound send bursts cannot hide incoming replies; Android Gateway opt-outs use `review_status = android_opted_out`. The Outreach search UI should expose queue matches even when no inbound webhook arrived. `/api/admin/android-inbox-replay` and `/api/cron/replay-android-inbox` replay recent Android inbox messages through the webhook as recovery/reconciliation paths; these endpoints must never send SMS.
- `[RISK]` Android SMS Gateway is a temporary Twilio/A2P fallback. Keep Twilio code intact and switch providers by env vars, not by deleting Twilio paths. Outreach STOP suppression should remain provider-scoped while Android fallback is in use.
- `[NEEDS VERIFICATION]` No tracked Browserless/Trulia enrichment source was found in the 2026-05-09 audit. The tracked enrichment worker is Estately + Cheerio.
- `[PARTIAL]` OneKey listing freshness is implemented in repo code and root cron config, but live schema migration and deployed cron execution need verification before relying on the audit trail.

## [PARTIAL] Data Model Warning

`[PARTIAL]` `/b` saves buyer profile leads into `leads`. `/event` saves event attendance/check-ins into `event_checkins`. The newer buyer-affordability sync path can populate `buyers`, `leads.buyer_id`, and `event_checkins.buyer_id`, but `leads` should still be treated as the global CRM/person lead path and `event_checkins` as event-specific attendance/action records.

## [INTENDED] Top Priority Next Task

Create a live Supabase verification script or checklist to confirm tables, columns, RLS policies, deployed Edge Functions, RPC definitions, and Vercel routes.

## Coding Style

- Prefer small, targeted edits that follow the surrounding file style.
- This repo uses plain static HTML pages, inline scripts, and ES modules in `apps/rel8tion-app/src`.
- Keep static pages browser-compatible. Avoid adding build-only assumptions unless a build pipeline already exists for that area.
- Use existing helper modules under `apps/rel8tion-app/src/api` and `apps/rel8tion-app/src/core` when editing app modules.
- Root API routes under `api/` are Node/Vercel serverless code.
- Supabase Edge Functions under `supabase/functions/` are Deno TypeScript.
- Files under `docs/supabase-functions/` are reference/source-tracking copies unless deployment is verified separately.
- Default to ASCII in new files unless the target file already uses non-ASCII heavily.
- Add comments only where they explain non-obvious state transitions or safety constraints.

## Safety Rules

- Do not revert user changes. The worktree is often dirty.
- Use `git status --short` before major edits and before final handoff.
- Do not run destructive database actions unless the user explicitly asks for that exact action.
- Do not use `git reset --hard` or checkout old versions unless explicitly requested.
- Do not clean untracked files by deleting them blindly. Classify them as source to commit, generated artifact to ignore, or local archive to move after approval.
- Do not hardcode service role keys, Twilio secrets, Vercel tokens, or admin reset tokens.
- The Supabase anon key is intentionally public in browser code. Service role access belongs only in serverless or Edge Function code.
- Be careful with RLS. Browser code must only depend on policies intentionally available to anon/authenticated users.
- Admin reset flows are destructive. `api/admin/reset-key.js` requires `KEY_RESET_ADMIN_TOKEN` and `SUPABASE_SERVICE_ROLE_KEY`.
- REL8TION COMMAND has a browser-local admin Dashboard Lock concept for PIN/passkey testing. Treat it as UX validation only until privileged admin APIs require a server-issued unlock session in addition to the existing admin UID/token.
- When changing sign activation, test both Android-style direct NFC navigation and iPhone popup behavior.
- When changing buyer check-in, verify SMS side effects and preapproval routing.
- When changing outreach, inspect both `agent_outreach_queue` and `agent_outreach_replies`.

## Supabase Boundaries

`[IMPLEMENTED]` Client-side app code talks directly to Supabase REST/RPC using the anon key in:

- `apps/rel8tion-app/src/core/config.js`
- several standalone HTML pages
- root `b.html`

`[IMPLEMENTED]` Sponsored Event Pass and Loan Officer Coverage Sign privileged writes go through service-role serverless routes:

- `/api/sponsored-pass/action`
- `/api/lo-sign/action`

`[IMPLEMENTED]` Server-side/admin code uses env vars:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `KEY_RESET_ADMIN_TOKEN`

`[NEEDS VERIFICATION]` Known RPCs used by the app but not defined in the checked-in SQL files:

- `find_nearest_open_house`
- `queue_recent_outreach_candidates`
- `verified_profiles_lookup`
- `verified_profiles_activate_or_create`

`[PARTIAL]` `send-lead-sms` source is checked in under `supabase/functions/send-lead-sms` and uses the shared SMS provider layer for Twilio or Android Gateway. Deployed source/version matching should still be verified before refactors.

`[INTENDED]` Current browser code still performs several direct Supabase writes with the anon key, including sign activation/session writes and event check-ins. The intended production architecture is to move sensitive writes and security-critical state transitions through Edge Functions or serverless APIs with explicit validation.

## Vercel Boundaries

`[IMPLEMENTED]` Root `vercel.json` is the route map for this repo deployment. It has app rewrites, short QR/link routes, and Vercel Cron entries for refresh, outreach generation, mockup rendering, and outreach sending.

`[IMPLEMENTED]` Route-map guardrails exist. Run `npm run verify:routes` before production route/API changes; it fails when `vercel.json` points at an untracked/missing file, when a clean app URL lacks its root wrapper, or when a critical production API/page source is not tracked. After deploy, run `npm run verify:production-routes` to catch Vercel-level `NOT_FOUND` responses on the live aliases.

`[NEEDS VERIFICATION]` `api/cron/enrich-agents.js` exists and imports `estately-enrichment-worker.cjs`, but current active root cron behavior should be verified in Vercel before assuming enrichment is scheduled.

`[NEEDS VERIFICATION]` `api/cron/refresh-open-house-data.js` exists and imports `onekey-freshness-worker.cjs`. Root `vercel.json` schedules it every 30 minutes, but deployed Vercel Cron state still needs dashboard/API verification after deploy.

`[IMPLEMENTED]` `apps/mockup-renderer` is a separate Vercel-style app with its own `vercel.json`, API routes, cron endpoints, and tests.

## WordPress Boundary

`[PARTIAL]` The `wordpress/` folder is a local tracking area for WordPress-side files. Per `wordpress/README.md`, these files are not automatically synced to the live WordPress page.

Current WordPress-side focus:

- `/hot-list` page
- outreach reply visibility
- reducing manual controls in outreach UI

`[RISK]` Do not assume edits in `wordpress/` are live. The folder can contain redacted placeholders such as `YOUR_ANON_KEY_HERE`.

## Testing And Checks

Use the checks that match the touched area.

General inspection:

```powershell
git status --short
rg "pattern"
rg --files
```

Route/deploy checks:

```powershell
npm run verify:routes
npm run verify:production-routes
```

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

Root dependency install when needed:

```powershell
npm install
```

OneKey freshness dry-run:

```powershell
npm run refresh:onekey:dry-run -- --id=M00000489-971018
```

There is no confirmed full automated test suite for the main static REL8TION app. For NFC/sign work, verification is usually a manual route/state test plus targeted Supabase row inspection.

## [RISK] High-Risk Areas

- `/k` routing order. It decides whether a scan is a buyer chip, rear agent chip, loan officer tag, reset scan, pending sign chip, claimed keychain, or unclaimed keychain.
- `/k` must check `loan_officer_coverage_signs.uid`, `uid_primary`, and `uid_secondary` before normal keychain fallback so an LO Coverage Sign NFC scan opens `/lo-sign-activate` or `/lo-field-dashboard`, not buyer check-in or agent keychain claim. During `/lo-sign-setup`, the pending setup session takes priority and registers the next scanned sign chip.
- `/k` must let sign activation win before backup-keychain linking. A fresh front/rear sign chip scanned during activation must never be claimed as an agent backup keychain, even if a backup-keychain session is still pending.
- `smart_sign_activation_sessions`. Stale rows can make a scan resume the wrong setup.
- `open_house_events`. Historical code sometimes expected `agent_slug`; current event host field is `host_agent_slug`.
- `smart_sign_inventory` to `smart_signs` linking. QR code binding depends on this relationship.
- `rel8tion_chip_inventory` to `keys`/`agents` linking. Printed agent QR codes must stay public-profile oriented while NFC remains owner/dashboard access.
- Root `/b` buyer profile and `/event` smart sign check-in are different experiences.
- Estately enrichment. It can populate bad office numbers if parsing/validation is loose.
- OneKey freshness. It can update live listing prices and active event snapshots; run dry-runs and verify `manual_price_override` behavior before broad deployment.
- Outreach functions. Bad queue filters can send or suppress real messages.
- RLS/schema cache errors. If a browser insert fails with `PGRST204` or `42501`, inspect live schema/policies before changing frontend assumptions.

## Documentation Rule

When changing a production flow, update `CURRENT_STATE.md` and, if the architecture changed, `REL8TION_SYSTEM_OVERVIEW.md`. Future sessions should not have to reconstruct the same sign/claim/dashboard flow from screenshots and chat history.

## Verification Notes

Status labels: `[IMPLEMENTED]`, `[PARTIAL]`, `[INTENDED]`, `[NEEDS VERIFICATION]`, `[RISK]`. `[IMPLEMENTED]` means code exists in the repo. It does not guarantee that the feature is deployed, live, passing RLS, or working with current Supabase production data.

### [IMPLEMENTED] Repo Claims

| Major claim | Status | Evidence |
| --- | --- | --- |
| Most product routes are Vercel/app routes rewritten into `apps/rel8tion-app`. | `[IMPLEMENTED]` | Root `vercel.json` rewrites `/claim`, `/onboarding`, `/sign-demo-activate`, `/k`, `/s`, `/event`, `/agent-dashboard`, `/admin`, `/nmb-activate`, and `/nmb-verified`. |
| `/k` is the active NFC/key router. | `[IMPLEMENTED]` | `apps/rel8tion-app/k.html` handles active sign chips, claimed/unclaimed keys, pending activation sessions, key reset scans, dashboard challenges, and loan officer pending scans. |
| Front smart sign NFC is the buyer/check-in side. | `[IMPLEMENTED]` | `sign-demo-activate.html` writes `uid_primary` and `primary_device_type: front_buyer_chip`; `k.html` classifies `uid_primary` as `front_buyer` and routes to `/s?code=...`. |
| Rear smart sign NFC is the agent/dashboard side. | `[IMPLEMENTED]` | `sign-demo-activate.html` writes `uid_secondary` and `secondary_device_type: rear_agent_chip`; `k.html` classifies this as `rear_agent`. |
| Rear sign scan must be followed by agent keychain scan. | `[IMPLEMENTED]` | `k.html` saves `rel8tion_agent_dashboard_pending` and shows "Tap your Rel8tionChip keychain" instead of opening dashboard directly. |
| Agent keychain handshake exists for sign setup. | `[IMPLEMENTED]` | `sign-demo-activate.html` uses `waiting_for_agent_keychain`, `waiting_for_handshake`, local session state, and `smart_sign_activation_sessions`. |
| Loan officer tag scan verifies event support. | `[IMPLEMENTED]` | Agent dashboard arms `rel8tion_loan_officer_pending`; `k.html` verifies `verified_profiles.uid` with `is_active=true` and inserts/updates `event_loan_officer_sessions`. |
| Buyer not preapproved routes to active paired loan officer first. | `[IMPLEMENTED]` | `eventShell/bootstrap.js` sets financing requested when `pre_approved` is false, calls `getLiveLoanOfficerSession`, then sends live LO alert/intro when a loan officer phone exists. |
| Buyer not preapproved falls back to Jared when no live loan officer is present. | `[IMPLEMENTED]` | `eventShell/bootstrap.js` calls `sendJaredFinancingAlert` when no live LO phone is found. |
| `/a` redirects to `/b`; `/b` is the agent buyer profile/lead path. | `[IMPLEMENTED]` | Root `a.html` redirects to `/b?agent=...`; root `b.html` loads `agents`, inserts into `leads`, and calls `send-lead-sms`. |
| Admin key reset uses a server-side token and service role. | `[PARTIAL]` | `api/admin/reset-key.js` reads `KEY_RESET_ADMIN_TOKEN` and `SUPABASE_SERVICE_ROLE_KEY`; full admin is not built. |
| Supabase inbound Twilio reply functions exist in the deployable functions folder. | `[IMPLEMENTED]` | `supabase/functions/twilio-inbound-router/index.ts` and `supabase/functions/twilio-inbound-reply/index.ts`. |
| WordPress files are not automatically synced to the live WordPress page. | `[PARTIAL]` | `wordpress/README.md` states this directly. |
| `apps/mockup-renderer` is separate and has its own crons/tests. | `[IMPLEMENTED]` | `apps/mockup-renderer/vercel.json`, `api/*`, and `tests/phone.test.ts`. |

### [INTENDED] Business Rules And Target Architecture

| Major claim | Status | Evidence |
| --- | --- | --- |
| A buyer-facing sign chip must not activate or claim a sign. | `[INTENDED]` | Current active front chip path routes to `/s`/buyer event. This rule should remain explicit because activation code can still handle unclaimed sign chips during setup. |
| Activation controls belong on agent/onboarding/sign setup, not buyer pages. | `[INTENDED]` | `/onboarding` and `/sign-demo-activate` contain activation entry points. `/event` and `/b` are buyer-facing. |
| WordPress is marketing/presentation, not the product brain. | `[INTENDED]` | `wordpress/README.md` describes source-tracking for WordPress-side files. Product state is in app routes and Supabase, not WordPress files. |
| Supabase sensitive writes should move through Edge Functions. | `[INTENDED]` | Current app still performs direct browser REST writes with anon key. This is not fully implemented. |
| Vercel/app routes are product routes. | `[IMPLEMENTED]` | Root `vercel.json` and `apps/rel8tion-app/vercel.json` define the app route surface. |
| Do not reset live field signs unless explicitly requested. | `[RISK]` | `api/admin/reset-key.js` has active-sign and Elena/Galluzzo protections, but operational confirmation still matters. |

### [PARTIAL], [NEEDS VERIFICATION], And [RISK]

| Major claim | Status | Evidence |
| --- | --- | --- |
| Formal remote LO coverage management is desired but not built. | `[INTENDED]` | No invite/request/accept workflow, no remote availability queue, no scheduled coverage assignment, and no persistent agent-LO relationship management. Current LO support is scan/session based. |
| Buyer-agent-loan-officer chat/video is desired but not built. | `[INTENDED]` | Current code provides SMS/call/text actions, not chat/video workflow. |
| Root Estately cron is scheduled by this repo. | `[NEEDS VERIFICATION]` | `api/cron/enrich-agents.js` exists, but root `vercel.json` has no `crons` block. |
| `send-lead-sms` implementation is in this repo. | `[NEEDS VERIFICATION]` | Browser code calls the function, but no matching `supabase/functions/send-lead-sms` file was found. |
| Supabase RPC definitions are checked in. | `[NEEDS VERIFICATION]` | `find_nearest_open_house`, `queue_recent_outreach_candidates`, `verified_profiles_lookup`, and `verified_profiles_activate_or_create` are used but not defined in checked-in SQL. |
| Live RLS policy state matches browser write behavior. | `[NEEDS VERIFICATION]` | SQL files show some policies, but full live schema/policy state is not present in the repo. |
