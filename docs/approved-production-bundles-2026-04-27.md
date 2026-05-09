# Rel8tion Approved Production Bundles

Date: 2026-04-27

Purpose: break the final production push into approved, reviewable bundles so mismatches are resolved before work begins and no live changes happen without explicit approval.

## Approval Rule

Each bundle should be reviewed before implementation or deployment.

Before approval, confirm:

- purpose
- files touched
- tables/functions touched
- risk level
- test path
- rollback path
- exact deploy scope

## Bundle 0: Repo Triage And Release Map

Purpose: get control of the workspace before changing more code.

Includes:

- identify production branch
- identify current Vercel production source
- compare production branch against `modular-claim-test`
- list dirty/untracked files
- decide what belongs in release vs archive
- avoid product behavior changes

Touches:

- Git
- docs, if needed

Risk: low.

Approval needed:

- final production branch
- which pending files are allowed into release
- what should be archived or ignored

Done when:

- release map is clear
- no mystery files are included
- production work starts from a known state

## Bundle 1: Smart Sign Core Flow

Purpose: make sign assignment and activation reliable.

Includes:

- sign QR lookup from `smart_sign_inventory`
- fresh sign assignment
- chip 1 and chip 2 binding
- assigned sign ownership protection
- inactive sign opens host activation
- active sign opens buyer check-in
- deactivation and rebind rules

Touches:

- `smart_signs`
- `smart_sign_inventory`
- `keys`
- `open_house_events`
- `/s`
- `/sign-demo-activate`
- claim/onboarding only if needed

Risk: high.

Approval needed:

- exact sign activation ceremony
- whether agent must re-tap Rel8tionChip after sign chips
- reset rules for demo signs vs real signs

Done when:

- fresh sign can be claimed
- active sign sends buyer to correct event
- wrong agent cannot take over a sign

## Bundle 2: Open House Binding And Listing Search

Purpose: make sure agents can always attach a sign to the right listing.

Includes:

- loose GPS search
- wider time windows
- manual listing search
- show more listings
- correct event creation
- stale host-session protection
- confirmation screen before activation

Touches:

- `open_houses`
- `open_house_events`
- `/claim`
- `/onboarding`
- `/s`
- `/sign-demo-activate`

Risk: medium-high.

Approval needed:

- how far back and forward to search
- radius
- what happens if listing is still not found
- whether an agent can activate a sign without a selected listing

Done when:

- GPS works when available
- manual search works when GPS fails
- activation is not blocked by narrow open-house timing

## Bundle 3: Buyer Check-In Product Polish

Purpose: make the public buyer page feel production-ready.

Includes:

- remove internal/demo copy
- property photo
- address, price, beds, baths, square feet, taxes
- OneKey listing link
- hosted by agent name, photo, brokerage
- save contact button
- clean check-in form
- buyer SMS
- agent SMS
- Jared financing alert
- post-check-in preference selection

Touches:

- `/event`
- `event_checkins`
- `agents`
- `open_houses`
- SMS helper function usage

Risk: medium.

Approval needed:

- final buyer wording
- required fields
- preference selection behavior
- whether represented buyer paths stay visible

Preference behavior:

- preferred final behavior: show real nearby homes first
- fallback categories:
  - Move-In Ready
  - Rental Potential
  - Fixer Upper

Done when:

- buyer scan looks polished
- check-in works
- SMS paths work
- preference saves to `event_checkins.metadata`

## Bundle 4: Agent Claim And Profile Flow

Purpose: make chip onboarding and agent identity reliable.

Includes:

- fresh chip goes to onboarding
- claimed chip goes to profile/buyer route
- no sign activation on buyer-facing pages
- agent photo upload/display
- brokerage detection
- manual fallback
- Activate Smart Sign only where appropriate

Touches:

- `/claim`
- `/onboarding`
- `/k`
- `/a` or buyer profile route
- `agents`
- `keys`
- profile image storage

Risk: medium.

Approval needed:

- exact pages where Activate Smart Sign should appear
- whether `/a` and `/b` both remain
- required profile fields

Done when:

- agents register smoothly
- buyers never see setup controls
- agent identity is consistent

## Bundle 5: Outreach Enrichment And Queue Reliability

Purpose: stop enrichment and outreach from drifting apart.

Includes:

- Estately enrichment keeps collecting all valuable agent data
- no overwriting good data
- passed open houses enrich but do not send immediately
- current/future eligible opportunities queue properly
- queue refresh rules
- queue status audit
- duplicate, landline, and STOP behavior

Touches:

- `estately-enrichment-worker.cjs`
- `/api/cron/enrich-agents`
- `listing_agents`
- `open_houses`
- `agent_outreach_queue`
- possibly Supabase RPC `queue_recent_outreach_candidates`

Risk: high.

Approval needed:

- exact outreach eligibility rules
- whether enrichment should trigger queue refresh
- whether old enriched agents should be reused for future listings
- send volume and cooldown rules

Done when:

- enrichment grows useful data
- eligible outreach queue grows predictably
- old/passed open houses do not cause bad sends

## Bundle 6: Outreach Sending And Replies

Purpose: make SMS outreach consistent and compliant.

Includes:

- cron generate/render/send verification
- Twilio send rules
- reply capture
- STOP handling
- replied agents block follow-up
- optional auto-response only after approval
- hot list/admin reply view

Touches:

- `generate-agent-outreach`
- `send-agent-outreach`
- `twilio-inbound-router`
- `twilio-inbound-reply`
- `agent_outreach_queue`
- `agent_outreach_replies`
- Vercel mockup renderer app

Risk: high.

Approval needed:

- whether auto-response exists
- exact auto-response copy
- when not to auto-respond
- who receives owner alerts
- quiet hours
- max messages per day

Done when:

- outbound SMS is predictable
- inbound replies are captured
- STOP is respected
- automatic response behavior is explicitly approved before deployment

## Bundle 7: Admin And Recovery Console

Purpose: stop needing raw database edits during demos.

Includes:

- find sign by code or UID
- find agent
- view active event
- deactivate sign
- reset demo sign only
- view latest check-ins
- view buyer preference
- view SMS send status
- view outreach queue status
- view inbound replies
- protected access

Touches:

- `/admin`
- Supabase tables
- possibly admin-only serverless endpoints

Risk: medium-high.

Approval needed:

- who can access admin
- what actions require confirmation
- which signs are demo-resettable
- whether destructive actions are allowed

Done when:

- demo issues can be fixed safely
- buyers and agents cannot access recovery tools

## Bundle 8: Database Hardening

Purpose: protect the system from bad states.

Includes:

- constraints
- indexes
- RLS review
- RPC cleanup
- duplicate prevention
- ownership integrity
- schema docs

Touches:

- SQL migrations
- Supabase policies
- RPCs/functions

Risk: high.

Approval needed:

- migration timing
- backfill plan
- rollback plan

Done when:

- bad states are prevented instead of cleaned up manually

## Bundle 9: Production Deploy And Smoke Test

Purpose: ship approved bundles safely.

Includes:

- deploy preview
- run test checklist
- approve production deploy
- deploy production
- verify production routes
- verify crons
- verify SMS
- document commit hash and rollback

Touches:

- Vercel production
- Supabase production only if prior bundles are approved

Risk: medium.

Approval needed:

- final go/no-go
- test phone numbers
- rollback trigger

Done when:

- production is live
- production is tested
- rollback path is documented

## Bundle 10: Documentation And Handoff

Purpose: preserve everything.

Includes:

- production readiness doc
- Smart Sign runbook
- outreach runbook
- database map
- recovery guide
- final route map
- known limitations
- demo checklist

Touches:

- `docs/`

Risk: low.

Approval needed:

- final formats
- markdown
- Word document
- PDF

Done when:

- future work can continue without reconstructing the system from chat

## Recommended Order

1. Bundle 0: Repo Triage And Release Map
2. Bundle 3: Buyer Check-In Product Polish
3. Bundle 1: Smart Sign Core Flow
4. Bundle 2: Open House Binding And Listing Search
5. Bundle 4: Agent Claim And Profile Flow
6. Bundle 5: Outreach Enrichment And Queue Reliability
7. Bundle 6: Outreach Sending And Replies
8. Bundle 7: Admin And Recovery Console
9. Bundle 8: Database Hardening
10. Bundle 9: Production Deploy And Smoke Test
11. Bundle 10: Documentation And Handoff

## Mismatches To Resolve Before Final Path

- Buyer preference should show real homes if possible, with fallback categories only when needed.
- Enrichment should collect old and future data, but outreach should only text eligible active/future opportunities.
- Auto-response is not approved yet.
- Demo reset must only affect approved demo signs.
- Agent activation belongs only in agent/onboarding context, never buyer context.
- Production branch must be confirmed before final bundling.
- Official buyer/profile route must be clarified: `/a`, `/b`, or both.
- Admin recovery should be planned before relying on manual database edits.

