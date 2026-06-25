# AGENTS.md

Repo operating guide for Codex sessions working on REL8TION.

Last cleaned: 2026-06-04.

This file is for operating rules, dangerous files, route priorities, and "do not break" instructions. Use `CURRENT_STATE.md` for the daily implementation status and `REL8TION_SYSTEM_OVERVIEW.md` for the human architecture/product overview.

Status labels used in this repo:

- `[IMPLEMENTED]` means code exists in the repo. It does not guarantee that the feature is deployed, live, passing RLS, or working with current Supabase production data.
- `[PARTIAL]` means some code exists, but the complete product behavior is not built or not fully wired.
- `[INTENDED]` means this is a REL8TION business/product rule or target architecture, not proof of current implementation.
- `[NEEDS VERIFICATION]` means the repo is not enough to prove live behavior, deployment, schema, RLS, or external service state.
- `[RISK]` means this can break demos, production data, security, SMS, or user trust if handled casually.

## Read This First

- `[IMPLEMENTED]` Production is configured to deploy from `main` through Vercel Git production branch automation. Verify the exact live SHA with Vercel inspection plus `git log -1 origin/main` before making live claims.
- `[IMPLEMENTED]` `staging` exists as the preview/staging branch. Do not force-push `main` or `staging`.
- `[IMPLEMENTED]` The older direct deploy from `modular-claim-test` commit `51d2d1a` is historical only and preserved as tag `production-51d2d1a-2026-05-08`. Do not treat that branch as the current production source.
- `[IMPLEMENTED]` Root `vercel.json` is the route and cron map for the repo deployment. Always inspect it before route, cron, or production-flow changes.
- `[RISK]` Root wrapper files and app files are not identical. Do not assume `b.html`, `a.html`, `claim.html`, `event.html`, `s.html`, `sign.html`, or other root wrappers match `apps/rel8tion-app/*`.
- `[RISK]` Legacy/test artifacts exist at root and under folders such as `smart-sign/` and `openai/Rel8tion.info/`. Use current route maps and active app files as source of truth.

Before production-flow edits, inspect the relevant current files:

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

## Critical Product Rules

- `[INTENDED]` Event Pass is B2B open-house technology. It is not lead selling, referral purchasing, or a buyer-lead resale product.
- `[IMPLEMENTED]` Sponsored Event Pass requires per-event host-agent consent before the sponsoring loan officer receives event check-in visibility or is assigned as live event support.
- `[IMPLEMENTED]` Loan Officer Coverage Signs stay with the loan officer. They are separate from Sponsored Event Passes and from a loan officer's personal Rel8tionChip/keychain.
- `[INTENDED]` Buyer financing help is opt-in only when the buyer explicitly requests financing, second-opinion, or pre-approval help.
- `[INTENDED]` Rel8tion must not collect borrower application data, SSN, income, assets, credit, borrower documents, or loan documents.
- `[IMPLEMENTED]` `/k` is the universal NFC router. Routing priority is critical.
- `[IMPLEMENTED]` Printed Event Pass QR source of truth is `smart_sign_inventory.public_code`.
- `[IMPLEMENTED]` `open_house_events.host_agent_slug` is the current event host field. Do not reintroduce `open_house_events.agent_slug` writes.
- `[IMPLEMENTED]` Agent and loan-officer printed QR behavior is public/profile oriented; NFC behavior is private owner/operator oriented.
- `[INTENDED]` Buyer-facing chips should never expose sign activation, claim, admin, or dashboard controls.

## `/k` Routing Guardrails

`apps/rel8tion-app/k.html` decides whether a scan is a buyer chip, rear agent chip, loan officer tag, reset scan, pending sign chip, claimed keychain, unclaimed keychain, Event Pass, or Loan Officer Coverage Sign. Small ordering mistakes can break field demos.

Preserve these priorities:

- `[IMPLEMENTED]` Reset mode and Open House Kit pending confirmation are checked before normal claimed keychain/sign/event routing.
- `[IMPLEMENTED]` Loan Officer Coverage Sign UIDs (`loan_officer_coverage_signs.uid`, `uid_primary`, `uid_secondary`) must be checked before normal keychain fallback.
- `[IMPLEMENTED]` Active front smart sign chip routes public/buyer traffic to `/s?code=...` and then to `/event` when live.
- `[IMPLEMENTED]` Active rear smart sign chip starts an agent dashboard challenge and requires the agent keychain before dashboard access.
- `[IMPLEMENTED]` Rear-sign dashboard verification takes precedence over loan-officer sign-in browser state.
- `[IMPLEMENTED]` Sign activation chip scans take precedence over backup-keychain linking so a fresh sign chip cannot be claimed as an agent backup keychain.
- `[IMPLEMENTED]` Pending Event Pass and Sponsored Event Pass activation must keep their Event Pass behavior and must not fall into normal agent profile/keychain claim behavior.
- `[IMPLEMENTED]` Normal claimed agent NFC opens `/agent-home?agent=<slug>&uid=<uid>` only after higher-priority setup, rear-sign, Event Pass, LO, and backup-keychain flows are ruled out.

## QR And Inventory Guardrails

- `[IMPLEMENTED]` Printed agent Rel8tionChip QR inventory lives in `rel8tion_chip_inventory` and resolves through `/c/:code` or `/chip/:code`.
- `[IMPLEMENTED]` Linked agent QR rows redirect to `/b?agent=<slug>`. Do not route printed agent QR codes directly to `/agent-home`.
- `[IMPLEMENTED]` Linked loan-officer/NMB/verified-professional QR rows redirect to `/nmb-verified?slug=<lo_slug>`. Do not route printed LO QR codes directly to `/loan-officer-dashboard` or `/lo-field-dashboard`.
- `[IMPLEMENTED]` Smart Sign and Event Pass printable QR rows use `smart_sign_inventory.public_code`.
- `[RISK]` `smart_signs.public_code` may still exist as a legacy fallback for old smart sign links. It must not be used for new QR printing or Event Pass source-of-truth behavior.

## Supabase Boundaries

- `[IMPLEMENTED]` Client-side app code uses the public Supabase anon key in `apps/rel8tion-app/src/core/config.js`, several standalone HTML pages, and root `b.html`.
- `[IMPLEMENTED]` The anon key is intentionally public. Do not hardcode service-role keys, Twilio secrets, Vercel tokens, Stripe secrets, or admin reset tokens.
- `[IMPLEMENTED]` Sponsored Event Pass and Loan Officer Coverage Sign privileged writes go through service-role serverless routes:
  - `/api/sponsored-pass/action`
  - `/api/lo-sign/action`
- `[IMPLEMENTED]` Server/admin code expects env vars such as `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, and `KEY_RESET_ADMIN_TOKEN`.
- `[PARTIAL]` `send-lead-sms` source is checked in under `supabase/functions/send-lead-sms` and uses the shared SMS provider layer. Deployed source/version, provider env, and live delivery remain `[NEEDS VERIFICATION]` unless checked in Supabase.
- `[NEEDS VERIFICATION]` Known RPCs used by app code but not proven from checked-in SQL include `find_nearest_open_house`, `queue_recent_outreach_candidates`, `verified_profiles_lookup`, and `verified_profiles_activate_or_create`.
- `[INTENDED]` Sensitive writes should continue moving toward Edge Functions or serverless APIs with explicit validation. Current browser code still performs some direct Supabase writes.

## Vercel Boundaries

- `[IMPLEMENTED]` Root `vercel.json` defines app rewrites, short QR/link routes, API routes, and cron entries. Inspect it before route or cron assumptions.
- `[IMPLEMENTED]` Route-map guardrails exist. Run `npm run verify:routes` before production route/API changes.
- `[NEEDS VERIFICATION]` After deploy, run `npm run verify:production-routes` and inspect Vercel deployment/runtime state before calling a route live.
- `[NEEDS VERIFICATION]` Cron entries in repo code do not prove Vercel Cron execution, env vars, or production data effects.

## Outreach And SMS Safety

- `[RISK]` Outreach and auto-reply behavior can spend money and affect real agent conversations. Do not deploy or enable new outbound behavior casually.
- `[RISK]` Before outreach changes, inspect queue filters, quiet hours, opt-out handling, provider selection, and owner approval.
- `[RISK]` REL8TION COMMAND's outreach inbox must load inbound rows separately from recent all-thread rows so outbound bursts cannot hide incoming replies.
- `[RISK]` Android SMS Gateway is a temporary outreach-volume fallback. Keep Twilio code intact and switch providers by route-scoped env vars.
- `[IMPLEMENTED]` Twilio outreach recovery and webhook settings are documented in `docs/twilio-outreach-sms-runbook.md`. Do not delete that runbook; update it when Twilio numbers, Messaging Service settings, callback tokens, or inbound routing behavior changes.
- `[IMPLEMENTED]` SMS provider selection supports `SMS_OUTREACH_PROVIDER` for outreach/manual outreach and `SMS_EVENTS_PROVIDER` for buyer/event/owner operational traffic, both falling back to `SMS_PROVIDER`. Current production outreach should use `SMS_OUTREACH_PROVIDER=android_gateway`, `SMS_EVENTS_PROVIDER=twilio`, and `SMS_PROVIDER=twilio`, with `SMS_TWILIO_OUTREACH_BROKERAGES=Douglas Elliman`.
- `[IMPLEMENTED]` Brokerage-specific outreach uses `SMS_TWILIO_OUTREACH_BROKERAGES`; Douglas Elliman outreach is the Twilio/MMS auto-send lane. Non-Douglas Elliman outreach must not auto-send through Twilio.
- `[IMPLEMENTED]` Automatic outreach is cron-driven and must not require hidden per-row approval. Eligible rows are `send_mode=automatic`, generated, rendered, due, with a listing photo and pending SMS copy. REL8TION COMMAND may explicitly Pause cron/Resume cron by changing `send_mode`.
- `[IMPLEMENTED]` Current Twilio sender path uses `SMS_PROVIDER=twilio` and `TWILIO_PHONE` for the sender number. Twilio inbound replies must point to the public `twilio-inbound-router` webhook, not directly to `twilio-inbound-reply`.
- `[RISK]` In Twilio Messaging Service settings, inbound messages must be set to `Send a webhook`; `Receive the message` stores replies at Twilio but does not invoke REL8TION.
- `[RISK]` Replay endpoints such as `/api/admin/android-inbox-replay` and `/api/cron/replay-android-inbox` must never send SMS.

## Admin And Reset Safety

- `[PARTIAL]` `/key-reset` is an admin/beta reset utility, not a full admin dashboard.
- `[IMPLEMENTED]` `/key-reset` and `api/admin/reset-key.js` require server-side admin controls. Do not broaden reset scope without explicit approval.
- `[RISK]` Do not detach, reset, or repurpose real field signs unless explicitly requested.
- `[RISK]` Elena/Galluzzo sign data has been treated as protected in reset code. Do not casually detach or reset it.
- `[IMPLEMENTED]` The demo/beta lane has historically used:
  - keychain UID `7ce5a51b-8202-4178-afc7-40a2e10e2a4d`
  - agent slug `main-beta`
  - sign public code `0e4b015f3782`
  - front chip UID `f005e166-70b3-407c-ba24-b91464a3d22a`
  - rear chip UID `b70d2bde-d185-43ee-8962-083b64fa4347`
- `[RISK]` Treat those beta identifiers as historical/protected context. Verify live rows before assuming they are still current.
- `[RISK]` REL8TION COMMAND has a browser-local admin Dashboard Lock concept for PIN/passkey testing. Treat it as UX validation only until privileged APIs require a server-issued unlock session.

## WordPress Boundary

- `[PARTIAL]` The `wordpress/` folder is a local tracking area for WordPress-side files.
- `[RISK]` Per `wordpress/README.md`, those files are not automatically synced to the live WordPress page.
- `[RISK]` WordPress files can contain redacted placeholders such as `YOUR_ANON_KEY_HERE`. Do not treat them as app source-of-truth.

## Coding Style

- Prefer small, targeted edits that follow surrounding style.
- This repo uses plain static HTML pages, inline scripts, and ES modules in `apps/rel8tion-app/src`.
- Keep static pages browser-compatible. Avoid adding build-only assumptions unless a build pipeline already exists for that area.
- Use existing helper modules under `apps/rel8tion-app/src/api` and `apps/rel8tion-app/src/core` when editing app modules.
- Root API routes under `api/` are Node/Vercel serverless code.
- Supabase Edge Functions under `supabase/functions/` are Deno TypeScript.
- Files under `docs/supabase-functions/` are reference/source-tracking copies unless deployment is verified separately.
- Default to ASCII in new files unless the target file already uses non-ASCII heavily.
- Add comments only where they explain non-obvious state transitions or safety constraints.

## Worktree Safety

- Use `git status --short` before major edits and before final handoff.
- Do not revert user changes.
- Do not use `git reset --hard` or checkout old versions unless explicitly requested.
- Do not clean untracked files by deleting them blindly. Classify them as source to commit, generated artifact to ignore, or local archive to move after approval.
- Be careful with RLS. Browser code must only depend on policies intentionally available to anon/authenticated users.

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

OneKey freshness dry-run:

```powershell
npm run refresh:onekey:dry-run -- --id=M00000489-971018
```

There is no confirmed full automated test suite for the main static REL8TION app. For NFC/sign work, verification is usually a manual route/state test plus targeted Supabase row inspection.

## Documentation Rule

When changing a production flow, update `CURRENT_STATE.md` immediately and update `REL8TION_SYSTEM_OVERVIEW.md` when routes, schema expectations, NFC behavior, SMS behavior, dashboard behavior, compliance behavior, or deployment/source-of-truth status changes.
