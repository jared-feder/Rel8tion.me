# AGENTS.md

Repo operating guide for future Codex sessions working on REL8TION.

Last inspected: 2026-05-09.

Status labels used in this file:

- `[IMPLEMENTED]` means code exists in the repo. It does not guarantee that the feature is deployed, live, passing RLS, or working with current Supabase production data.
- `[PARTIAL]` means some code exists, but the complete product behavior is not built or not fully wired.
- `[INTENDED]` means this is a REL8TION business/product rule or target architecture, not proof of current implementation.
- `[NEEDS VERIFICATION]` means the repo is not enough to prove live behavior, deployment, schema, RLS, or external service state.
- `[RISK]` means this can break demos, production data, security, SMS, or user trust if handled casually.

## Read This First

`[IMPLEMENTED]` This repo is a product workspace with static Vercel pages, Supabase data access, Twilio/SMS integration points, WordPress-side working files, and many historical handoff docs. Treat the current route files and current source code as the source of truth. Older docs are useful context but should not override the current implementation.

`[IMPLEMENTED]` Latest known live production code anchor: `modular-claim-test` commit `51d2d1a`, tagged `production-51d2d1a-2026-05-08`.

`[PARTIAL]` Branch cleanup is moving toward `main` as the production branch and `staging` as the preview/staging branch. Do not force-push either branch. Vercel API inspection on 2026-05-09 confirmed project Git `productionBranch = main`; keep `main` reconciled before relying on automatic production deploys.

`[INTENDED]` After any production-flow change, update `CURRENT_STATE.md` immediately and update `REL8TION_SYSTEM_OVERVIEW.md` when routes, schema expectations, NFC behavior, SMS behavior, dashboard behavior, compliance behavior, or deployment/source-of-truth status changes.

Before making changes, inspect:

- `vercel.json`
- `apps/rel8tion-app/vercel.json`
- `apps/rel8tion-app/k.html`
- `apps/rel8tion-app/sign-demo-activate.html`
- `apps/rel8tion-app/src/modules/signResolver/*`
- `apps/rel8tion-app/src/modules/eventShell/*`
- `apps/rel8tion-app/agent-dashboard.html`
- `apps/rel8tion-app/claim.html`
- `apps/rel8tion-app/src/modules/claimStyled/*`
- `apps/rel8tion-app/onboarding.html`
- `b.html` and `a.html`
- `api/admin/reset-key.js`
- `api/cron/enrich-agents.js`
- `estately-enrichment-worker.cjs`
- `supabase/functions/*`
- `sql/*.sql` and `sql/migrations/*.sql`
- `wordpress/README.md`

## [IMPLEMENTED] Current App Shape

The repo's current app surface is primarily static HTML plus browser JavaScript. The root `vercel.json` rewrites most currently configured app routes into `apps/rel8tion-app`.

Important route behavior:

- `[IMPLEMENTED]` `/k` is the NFC/key router and routes keychains, sign chips, loan officer tags, and reset scans.
- `[IMPLEMENTED]` `/claim` is the agent keychain claim flow.
- `[IMPLEMENTED]` `/onboarding` is the post-claim agent setup page and contains the smart sign activation entry point.
- `[IMPLEMENTED]` `/sign-demo-activate` is the smart sign setup and listing binding flow.
- `[IMPLEMENTED]` `/s` and `/sign` resolve a smart sign public code and route to activation or live event.
- `[IMPLEMENTED]` `/event` is the smart sign buyer check-in page.
- `[IMPLEMENTED]` `/agent-dashboard` is the live event dashboard for the host agent.
- `[PARTIAL]` `/nmb-activate` and `/nmb-verified` are loan officer tag/profile pages. Formal remote LO coverage management is not built: no invite/request/accept workflow, no remote availability queue, no scheduled coverage assignment, and no persistent agent-LO relationship management. Current LO support is scan/session based.
- `[PARTIAL]` `/key-reset` is an admin/beta reset utility. It is not a full admin dashboard.
- `[IMPLEMENTED]` `/a` is a root static redirect page that sends claimed agent chip traffic to `/b`.
- `[IMPLEMENTED]` `/b` is a root static buyer profile and lead capture page tied to an agent slug.
- `[IMPLEMENTED]` Current sign activation carries a selected open house from the keychain claim host session and offers it first for sign binding.
- `[IMPLEMENTED]` Current sign activation loads agent profile data and displays agent name/brokerage instead of relying on raw slugs in the visible activation flow.

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
- `[RISK]` Do not detach or reset real field signs unless explicitly requested. Elena/Galluzzo sign data has been treated as protected in reset code.
- `[IMPLEMENTED]` The demo/beta lane currently uses:
  - keychain UID `7ce5a51b-8202-4178-afc7-40a2e10e2a4d`
  - agent slug `main-beta`
  - sign public code `0e4b015f3782`
  - front chip UID `f005e166-70b3-407c-ba24-b91464a3d22a`
  - rear chip UID `b70d2bde-d185-43ee-8962-083b64fa4347`
- `[IMPLEMENTED]` `/key-reset` is token-protected and restricted to the beta lane above. Do not broaden reset scope without explicit approval.
- `[RISK]` Smart sign QR activation currently resolves `smart_sign_inventory.public_code` first. The older `smart-sign-qr-export.sql` exports from `smart_signs.public_code`; reconcile this before batch printing.
- `[RISK]` Outreach and auto-reply behavior can spend money and affect real agent conversations. Do not deploy or enable new outbound behavior without checking filters, quiet hours, opt-out handling, and owner approval.
- `[NEEDS VERIFICATION]` No tracked Browserless/Trulia enrichment source was found in the 2026-05-09 audit. The tracked enrichment worker is Estately + Cheerio.

## [PARTIAL] Data Model Warning

`[PARTIAL]` `/b` saves buyer profile leads into `leads`. `/event` saves event attendance/check-ins into `event_checkins`. These should be unified by treating `leads` as the global CRM/person record and `event_checkins` as the event-specific attendance/action record. This is not fully implemented yet.

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
- When changing sign activation, test both Android-style direct NFC navigation and iPhone popup behavior.
- When changing buyer check-in, verify SMS side effects and preapproval routing.
- When changing outreach, inspect both `agent_outreach_queue` and `agent_outreach_replies`.

## Supabase Boundaries

`[IMPLEMENTED]` Client-side app code talks directly to Supabase REST/RPC using the anon key in:

- `apps/rel8tion-app/src/core/config.js`
- several standalone HTML pages
- root `b.html`

`[IMPLEMENTED]` Server-side/admin code uses env vars:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `KEY_RESET_ADMIN_TOKEN`

`[NEEDS VERIFICATION]` Known RPCs used by the app but not defined in the checked-in SQL files:

- `find_nearest_open_house`
- `queue_recent_outreach_candidates`
- `verified_profiles_lookup`
- `verified_profiles_activate_or_create`

`[NEEDS VERIFICATION]` Known Edge Function called by browser code but not present under `supabase/functions`:

- `send-lead-sms`

Treat these as live Supabase dependencies that need verification before refactors.

`[INTENDED]` Current browser code still performs several direct Supabase writes with the anon key, including sign activation/session writes and event check-ins. The intended production architecture is to move sensitive writes and security-critical state transitions through Edge Functions or serverless APIs with explicit validation.

## Vercel Boundaries

`[IMPLEMENTED]` Root `vercel.json` is the route map for this repo deployment. It currently has rewrites but no root `crons` block.

`[NEEDS VERIFICATION]` `api/cron/enrich-agents.js` exists and imports `estately-enrichment-worker.cjs`, but the root Vercel cron schedule is not present in the inspected root config. If the endpoint is running in production, it is either triggered externally, deployed from another config, or needs verification.

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

There is no confirmed full automated test suite for the main static REL8TION app. For NFC/sign work, verification is usually a manual route/state test plus targeted Supabase row inspection.

## [RISK] High-Risk Areas

- `/k` routing order. It decides whether a scan is a buyer chip, rear agent chip, loan officer tag, reset scan, pending sign chip, claimed keychain, or unclaimed keychain.
- `smart_sign_activation_sessions`. Stale rows can make a scan resume the wrong setup.
- `open_house_events`. Historical code sometimes expected `agent_slug`; current event host field is `host_agent_slug`.
- `smart_sign_inventory` to `smart_signs` linking. QR code binding depends on this relationship.
- Root `/b` buyer profile and `/event` smart sign check-in are different experiences.
- Estately enrichment. It can populate bad office numbers if parsing/validation is loose.
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
