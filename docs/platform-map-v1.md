## Rel8tion Platform Map V1

### What Is Already Real

- `modular-claim-test` is the strongest current source of truth for claim modularization.
- `claim-test-styled.html` is the best current modular UI shell.
- `claim2.html` is the best current source for updated claim wording and product framing.
- `claim.html` is still the large legacy all-in-one implementation and should now be treated as reference, not the future base.
- `smart-sign/` already contains a meaningful modular event/check-in layer:
  - `eventLifecycle.js`
  - `detection.js`
  - `api.js`
  - `checkin.js`
  - `renderer.js`
- `sql/migrations/20260409_smart_sign_phase_1_1_cleanup.sql` already establishes the correct backend direction for Smart Sign and event lifecycle hardening.
- `.vercel/project.json` shows the repo is already linked to the Vercel project `rel8tion-me`.
- `apps/mockup-renderer/` already has a working Vercel-style cron/API deployment shape for the outreach engine.

### Core Product Layers

#### 1. Agent Identity Layer

- `keys.uid`
  - physical chip identity
- `agents.slug`
  - public agent identity
- `keys.agent_slug`
  - bridge between chip and agent profile

This is the trust foundation.

#### 2. Claim / Activation Layer

Purpose:
- activate the chip
- create or update the agent profile
- link the chip to the agent
- hand the user into onboarding or sign setup

Primary source:
- `modular-claim-test`

Recommended implementation source split:
- structure from `modular-claim-test`
- styling baseline from `claim-test-styled.html`
- latest wording from `claim2.html`

#### 3. Smart Sign Identity Layer

Purpose:
- represent the reusable physical sign as its own durable object
- keep QR identity stable while active events change

Primary identifiers:
- `smart_signs.public_code`
- `smart_signs.id`

#### 4. Event Lifecycle Layer

Purpose:
- attach a smart sign to one active open house event
- track setup, resume, close, and check-in lifecycle

Primary tables and fields:
- `open_house_events`
- `open_house_events.open_house_source_id`
- `open_house_events.smart_sign_id`
- `open_house_events.activation_uid_primary`
- `open_house_events.activation_uid_secondary`
- `open_house_events.setup_confirmed_at`
- `open_house_events.ended_at`

#### 5. Buyer / Check-In Layer

Purpose:
- power the buyer-facing public event shell
- capture visitors, buyer agents, and represented-buyer signals

Primary pieces:
- `event_checkins`
- public route chain:
  - `s.html`
  - `sign-view-test.html`
  - `event-shell-test.html`

#### 6. Outreach / Ops Layer

Purpose:
- turn listing/open-house data into agent outreach
- send initial and follow-up messages
- capture replies and opt-outs

Primary pieces:
- `agent_outreach_queue`
- `agent_outreach_replies`
- `generate-agent-outreach`
- `send-agent-outreach`
- `twilio-inbound-router`
- `twilio-inbound-reply`
- `hot-list-elementor.html`

#### 7. Service Partner / Revenue Layer

Purpose:
- bring loan officers and service professionals into the Rel8tion network
- give them a verified, chip-activated identity page
- create a clean handoff from buyer opportunity to service-side monetization
- support future deal tracking and payout attribution at volume

Primary pieces:
- `nmb-activate.html`
- `nmb-verified.html`
- `verified_profiles`
- `verified_profiles_lookup`
- `verified_profiles_activate_or_create`

### Updated Smart Sign Handshake Model

This is the recommended real production flow based on the current product direction.

#### Initial Smart Sign Registration

1. Agent activates their Rel8tionChip first.
2. Both NFC chips inside the sign are registered to the same `smart_sign`.
3. Agent ownership is verified through one of:
   - listing recognition / nearby listing context
   - browser session or trusted app state
   - OTP text verification
   - fallback password only if necessary

Result:
- the sign becomes a real owned physical object in the system

#### Open House Activation Handshake

1. Keychain tap
   - identifies the host agent and begins an activation session
2. Sign tap
   - identifies the physical sign being activated
3. Final keychain tap
   - acts as the trust handshake
   - confirms the same host agent is authorizing the same sign
4. Listing confirmation
   - nearest listing detection or manual fallback
5. Event creation or resume
   - sign becomes locked to the event

Result:
- the sign is live only after agent identity, sign identity, and event intent all agree

### Why This Order Matters

The dashboard should be built after the contracts for:
- claim
- smart sign identity
- event lifecycle
- outreach state

are stable enough to become backend truth.

Otherwise the dashboard becomes a polished layer on top of shifting assumptions.

### Recommended Source Of Truth By Area

#### Claim

- Use `modular-claim-test` as the source of truth for implementation structure.
- Use `claim2.html` as the source of truth for current copy and interaction wording.

#### Smart Sign

- Use `smart-sign/` plus the April 9 migration as the source of truth for lifecycle direction.
- Use the handshake docs as the source of truth for new activation behavior.

#### Public Sign Routing

- Use modular branch artifacts as the source of truth:
  - `s.html`
  - `sign-view-test.html`
  - `event-shell-test.html`

#### Outreach

- Current source of truth is the Supabase/Vercel hybrid handoff now living under `docs/` plus deployed edge functions.

#### Service Partners

- Use `nmb-activate.html` and `nmb-verified.html` as the source of truth for the current loan-officer/service-professional activation flow.
- Keep this flow in the app layer, not the WordPress marketing layer.

### Recommended Build Order

#### Phase 1

- Promote the modular claim flow into the main Vercel app direction.
- Merge current wording from `claim2.html`.
- Keep old WordPress claim only as temporary fallback.

#### Phase 2

- Finalize Smart Sign registration and 3-step handshake.
- Ensure both sign chips belong to one `smart_sign`.
- Add activation session tracking and clear failure/retry states.

#### Phase 3

- Lock the public sign route chain:
  - public code
  - sign resolver
  - active event
  - event shell

#### Phase 4

- Move ops into a protected admin app on Vercel/React.
- Dashboard should cover:
  - claims
  - chips
  - smart signs
  - events
  - check-ins
  - outreach
  - replies
  - opt-outs
  - errors
  - service-partner activations
  - service-partner verified pages
  - deal attribution state

### Immediate Practical Next Step

The next implementation push should not be “build the whole dashboard.”

It should be:

1. bring `modular-claim-test` forward
2. merge `claim2.html` wording into it
3. update Smart Sign to the new handshake model
4. then wire those stable flows into a dashboard
