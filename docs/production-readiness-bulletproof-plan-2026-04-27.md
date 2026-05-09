# Rel8tion Production Readiness Plan

Date: 2026-04-27

Goal: move the full Rel8tion app into a clean production-ready state with Smart Sign, buyer check-in, outreach, enrichment, and recovery tools working reliably.

## Guiding Rule

No live deploys, Supabase function deploys, database changes, or production data operations should happen without a clear review of:

- what is changing
- why it is changing
- what files/functions/tables are touched
- what could break
- how it will be tested
- whether the change is approved for production

## 1. Production Branch Cleanup

Needed:

- Confirm the official production branch.
- Confirm which branch Vercel production is currently deploying from.
- Compare `modular-claim-test` against the production branch.
- Review all dirty/untracked files.
- Decide for each untracked file:
  - keep and commit
  - archive as documentation
  - ignore
  - remove later only with approval
- Keep unrelated local changes out of production commits.
- Avoid staging generated docs, PDFs, temp deploy folders, or secret files by accident.
- Create clean release commits with focused scope.

Definition of done:

- Production branch contains only intended app code, config, docs, and migrations.
- `git status` is understood before deploy.
- No accidental files are shipped.

## 2. Smart Sign Activation

Needed:

- Confirm sign QR public code lookup uses `smart_sign_inventory`.
- Confirm fresh sign assignment:
  - agent scans Rel8tionChip
  - agent scans sign QR
  - agent taps sign chip 1
  - agent taps sign chip 2
  - agent confirms ownership/listing
  - sign is assigned to the correct agent
- Confirm assigned signs cannot be claimed by another agent.
- Confirm inactive sign QR opens host activation flow.
- Confirm active sign QR opens buyer check-in flow.
- Confirm deactivated signs keep ownership but detach from current event.
- Confirm demo reset cannot affect real field signs.

Definition of done:

- Agent can set up a sign from fresh hardware.
- Agent can activate the sign at an open house.
- Buyer scan always goes to the correct buyer check-in page.
- Wrong-agent or stale-session assignment is blocked.

## 3. Open House Binding

Needed:

- Make listing discovery loose enough for live field use:
  - same-day open houses
  - upcoming open houses
  - recently ended events with grace window
  - wider location fallback
  - manual listing search
- Ensure agent can search for a listing if GPS misses.
- Ensure correct listing creates/updates `open_house_events`.
- Prevent wrong-agent sign/listing binding.
- Prevent stale host sessions from assigning another person's sign.
- Show a clear confirmation before activating a sign to a listing.

Definition of done:

- If GPS works, the correct listing appears.
- If GPS fails, the agent can still find the listing.
- Activation is not blocked by narrow time windows.

## 4. Buyer Check-In Page

Needed:

- Remove demo/internal copy from public buyer experience.
- Hide internal data:
  - agent slug
  - event ID
  - source ID
  - placeholder/debug language
- Show:
  - property photo
  - address
  - price
  - beds
  - baths
  - square feet
  - taxes, if available
  - OneKey listing link
  - hosted by agent name
  - agent photo
  - brokerage
  - save contact button
  - call/text buttons where appropriate
- Keep the check-in form short and mobile-friendly.
- Add post-check-in buyer preference capture.

Buyer preference capture should ideally show actual homes:

- Query real nearby/current `open_houses`.
- Show up to three real properties with:
  - photo
  - address
  - price
  - basic facts
- Save selected property to `event_checkins.metadata.preferred_example_home`.

Fallback if real homes are unavailable:

- Move-In Ready
- Rental Potential
- Fixer Upper

Definition of done:

- Buyer sees a polished product, not a demo shell.
- Agent receives buyer details by SMS.
- Buyer receives confirmation SMS.
- Jared receives financing alert if buyer is not pre-approved.
- Buyer preference is saved on the check-in row.

## 5. Agent Profile And Claim Flow

Needed:

- Fresh chip goes to onboarding.
- Claimed chip goes to buyer/profile route, not sign activation.
- Agent onboarding supports:
  - detected agent
  - manual agent entry
  - brokerage
  - phone
  - email
  - profile photo
  - listing selection fallback
- "Activate Smart Sign" appears only in correct agent/onboarding context.
- It must not appear on buyer-facing pages.
- Agent photo should show reliably on:
  - `/a`
  - `/b` if still used
  - `/event`
  - sign/event pages

Definition of done:

- Agent onboarding feels clean and intentional.
- Buyer pages never expose activation controls.
- Agent identity is consistent across flows.

## 6. Outreach Pipeline

Needed:

- Keep enrichment and outreach sending separate.
- Enrichment should save valuable agent data even if the open house already passed.
- Outreach should only text eligible current/future opportunities.
- Confirm Estately enrichment:
  - saves to `listing_agents`
  - backfills `open_houses.agent`
  - backfills `open_houses.agent_phone`
  - does not overwrite better existing data
- Confirm queue creation:
  - enriched records become outreach candidates when eligible
  - passed open houses do not trigger immediate outreach
  - future/relevant open houses do trigger queue rows
- Confirm message pipeline:
  - queue generation
  - mockup rendering
  - send eligibility
  - Twilio send
  - reply capture

Rules needed:

- no duplicate phone spam
- quiet hours
- STOP compliance
- replied agents stop follow-up
- landline/mobile failures become terminal blocked states
- no automatic replies until copy/rules are approved

Definition of done:

- Enrichment can run continuously.
- Outreach sends consistently only when eligible.
- Replies are captured and visible.
- Automatic response behavior is configurable and explicitly approved before use.

## 7. Database Integrity

Tables to document and verify:

- `keys`
- `agents`
- `smart_sign_inventory`
- `smart_signs`
- `open_houses`
- `open_house_events`
- `event_checkins`
- `listing_agents`
- `agent_outreach_queue`
- `agent_outreach_replies`

Needed constraints/rules:

- one active event per sign
- unique sign public code
- UID cannot belong to conflicting signs
- claimed chip cannot silently transfer ownership
- active sign cannot be hijacked by wrong agent
- duplicate outreach per phone/listing window is blocked
- event check-ins stay tied to the correct event

Definition of done:

- Each table has a clear job.
- Production behavior does not rely on guessing.
- Reset/deactivation paths preserve data unless deletion is explicitly intended.

## 8. Production Deployment

Needed:

- Verify Vercel root project config.
- Verify production routes:
  - `/claim`
  - `/onboarding`
  - `/k`
  - `/s`
  - `/event`
  - `/sign-demo-activate`
  - `/admin`
- Verify cron jobs:
  - Estately enrichment
  - OneKey sync, if active
  - outreach generate
  - mockup render
  - outreach send
- Verify env vars in production:
  - Supabase URL/key
  - Supabase service role where required
  - Twilio credentials
  - cron secrets
  - render/mockup env vars
- Cache-bust changed modules.
- Deploy preview first.
- Smoke test preview.
- Deploy production only after approval.

Definition of done:

- Preview passes the runbook.
- Production deploy is approved.
- Production URL is verified after deploy.

## 9. Testing Runbook

Required test cases:

- Fresh agent chip registration.
- Existing agent chip scan.
- Fresh sign assignment.
- Sign QR scan before event activation.
- Sign QR scan after event activation.
- Sign chip scan as buyer.
- Sign deactivate/rebind.
- Agent manual listing search.
- Buyer direct check-in.
- Buyer with agent check-in.
- Buyer agent check-in.
- Buyer SMS confirmation.
- Agent SMS alert.
- Jared financing alert.
- Buyer preference selection.
- Preference saved in `event_checkins.metadata`.
- Estately enrichment run.
- Outreach queue creation.
- Outreach render.
- Outreach send.
- Inbound reply capture.
- STOP handling.

Definition of done:

- Every critical route has been tested on mobile.
- Every SMS path has been tested with known safe numbers.
- Every failure state has a readable user-facing message.

## 10. Admin And Recovery Tools

Needed:

- Search sign by public code.
- Search sign by UID.
- Search agent by slug/name/phone.
- View active sign event.
- Deactivate sign from event.
- Reset demo sign only.
- View latest check-ins.
- View buyer preference choice.
- View SMS send status.
- View outreach queue status.
- View inbound replies.
- Repair wrong ownership with explicit confirmation.

Definition of done:

- Demo problems can be fixed quickly without raw database edits.
- Recovery tools are protected and cannot be used accidentally by buyers/agents.

## 11. Polish Pass

Needed:

- Consistent typography.
- Consistent spacing.
- Mobile text does not overflow.
- No demo language.
- No internal IDs/slugs shown publicly.
- Better loading states.
- Better empty states.
- Better error messages.
- Real property imagery wherever possible.
- Clean Rel8tion/NMBNOW branding.
- Buyer pages feel like a finished product, not a test route.

Definition of done:

- The app looks intentional on mobile.
- There is no visible placeholder/debug wording.
- A real agent can use it without explanation.

## 12. Final Handoff Package

Create:

- production readiness checklist
- Smart Sign test runbook
- outreach pipeline runbook
- database table map
- emergency recovery guide
- known limitations list
- demo do-not-touch list
- final deploy commit hash
- production URL
- rollback instructions

## Current Notes As Of 2026-04-27

- Estately enrichment is live and working.
- There is a local, not-deployed worker change that refreshes outreach queue after successful enrichment.
- That local worker change should not be deployed until reviewed.
- Three-property buyer preference is being added locally to the real `/event` route.
- Current local fallback choices are:
  - Move-In Ready
  - Rental Potential
  - Fixer Upper
- The better final version should show real nearby homes first, with category fallback only if not enough homes are available.
- Auto-response to inbound outreach replies is not approved and should remain off until rules/copy are defined.

