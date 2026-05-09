## Rel8tion Rollout And Pricing Plan V1

### Core MVP Principle

The first paid-feeling experience should be:

- no app download
- no password
- no account setup wall
- no dashboard required
- no training required
- no manual CRM work required

The product should feel like:

1. hand agent a Rel8tionChip
2. they tap it at the open house
3. nearest listing is detected
4. if the listing is enriched, their identity appears
5. they confirm
6. they are live

That is the real wedge.

### Product Layers

#### Layer 1: Activation Simplicity

This is the growth wedge.

The promise:
- “10 second activation”
- “No app, no password, no setup headache”

Primary experience:
- chip claim
- listing detection
- quick confirm
- immediate live status

#### Layer 2: Smart Sign Event Operation

This is the operational moat.

The promise:
- the sign becomes a live event object
- the sign is activated through physical trust, not dashboard busywork

Primary experience:
- keychain tap
- sign tap
- final keychain tap
- listing confirmation
- event goes live

#### Layer 3: Automated Relationship Engine

This is the recurring-value layer.

The promise:
- buyers and agents keep hearing from you without manual chasing
- Rel8tion helps keep the agent top of mind through the sales cycle

#### Layer 4: Advanced Ops / CRM / Analytics

This is the expansion layer.

The promise:
- better oversight
- lead intelligence
- pipeline visibility
- historical performance

### Recommended Commercial Structure

#### 1. Trial / Entry Tier

Best framing:
- `14-day trial`

What they get:
- one sign kit or temporary sign access
- two keychains
- simple chip activation
- live open house setup
- buyer check-in capture
- SMS-only delivery of check-in data
- one-time buyer lead SMS alerts

What they do not get:
- full dashboard
- CRM
- advanced analytics
- long automated nurture flows

Why this is right:
- removes friction
- proves the magic fast
- gets real-world traction
- lets setup itself be the interface

#### 2. Core Monthly Tier

Best framing:
- `Rel8tion Core`

What they get:
- everything in trial, after trial converts
- automated buyer follow-up
- automated relationship-building touches
- ongoing reminders / nurture logic
- improved buyer and lead visibility
- lightweight dashboard or status center

Primary value:
- keeps the agent fresh in the buyer’s mind
- reduces lead decay after the open house
- turns one-day traffic into a longer sales-cycle asset

This should likely become the real first revenue tier.

#### 3. Pro / Brokerage Tier

Best framing:
- `Rel8tion Pro` or `Rel8tion Brokerage`

What they get:
- advanced dashboard
- analytics
- lead timeline
- event history
- check-in history
- smart sign fleet visibility
- CRM-like tools
- richer outreach controls
- broker/admin visibility

Primary value:
- operational control
- reporting
- scale

### Recommended MVP Packaging

For launch, the product should not feel like “software.”

It should feel like:
- a chip
- a sign
- instant activation
- texts that keep them informed

That means the first customer pitch is not:
- “Here is your dashboard”

It is:
- “Tap this at your open house and you’re live.”

### Build Priority

#### Phase 1: Get The Magic Working

Goal:
- instant activation
- simple event go-live

Build focus:
- modular claim
- final claim wording from `claim2.html`
- key-to-agent linking
- nearest listing detection
- live confirmation flow

Primary source:
- `modular-claim-test`

#### Phase 2: Finalize Smart Sign Handshake

Goal:
- real physical trust handshake

Build focus:
- dual-chip sign registration
- chip -> sign -> chip activation sequence
- setup session tracking
- listing confirm
- create/resume event
- lock sign to active event

#### Phase 3: Public Event Flow

Goal:
- the sign reliably resolves to the correct live event

Build focus:
- `s.html`
- `sign-view-test.html`
- `event-shell-test.html`
- active/inactive/stale state handling

#### Phase 4: Core Monthly Automation

Goal:
- convert the “cool demo” into recurring value

Build focus:
- outreach automation
- buyer follow-up
- relationship reminders
- SMS-based ops

#### Phase 5: Pro Dashboard

Goal:
- give power users and brokerages a real command center

Build focus:
- analytics
- CRM-like tools
- sign history
- event history
- check-in history
- outreach inbox

### Merge Plan For Claim

#### Keep

- `modular-claim-test` structure
- `claim-test-styled.html` shell
- modular files:
  - `src/core/config.js`
  - `src/api/keys.js`
  - `src/api/openHouses.js`
  - `src/modules/claimStyled/bootstrap.js`
  - `src/modules/claimStyled/flow.js`
  - `src/modules/claimStyled/renderer.js`

#### Replace / Update

- wording and product framing from `claim2.html`
- intro copy
- buttons
- confirmation language
- anything that better supports the “instant live” promise

#### De-emphasize

- legacy `claim.html`

### Product Positioning Summary

#### Trial

“Try it for 14 days. No app. No password. No setup headache.”

#### Core

“Now Rel8tion keeps your buyers warm and your relationships active.”

#### Pro

“Now you can actually run the system at scale.”

### Best Immediate Next Move

Do not build the full dashboard first.

Do this first:

1. move the modular claim branch toward the real Vercel app path
2. port the current copy from `claim2.html`
3. finish the Smart Sign handshake
4. lock the public sign/event chain
5. then build dashboard layers on top
