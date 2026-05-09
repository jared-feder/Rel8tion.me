## Rel8tion Uniform Language, Feature Set, Timeframes, And Pricing

Version: `V1`
Date: `2026-04-22`

This document is the working source of truth for:

- product language
- trust-layer terminology
- offer structure
- feature tiers
- rollout order
- pricing

If the product evolves, update this file first so messaging, design, code, onboarding, sales copy, and the dashboard all stay aligned.

### 1. Core Product Language

#### Rel8tionChip

Definition:
- the chip represents `you`
- it is the agent identity token
- it is the persistent trust credential

Meaning in the platform:
- who the agent is
- who is authorizing activity
- who owns the relationship layer

#### Smart Sign

Definition:
- the sign represents `your live event`
- it is the event identity layer
- it is not just a QR sign or check-in board

Meaning in the platform:
- which open house is live right now
- where buyers check in
- where the verified event experience begins

#### Handshake

Definition:
- the handshake is the verification ceremony between agent identity and event identity

Meaning in the platform:
- the chip says `this is me`
- the sign says `this is the event`
- the final handshake says `this agent is authorizing this live event now`

#### Trust Layer

Definition:
- the trust layer is the verified, time-stamped, real-world interaction model behind Rel8tion

Meaning in the platform:
- real presence
- real time
- real place
- real event

This is what makes the product feel more valuable than:
- a fake review
- a basic QR form
- a generic lead capture page

#### Buyer Check-In

Definition:
- a clean, buyer-friendly event interaction that captures verified presence and useful sales data

Meaning in the platform:
- not just “sign in”
- not just contact sharing
- a guided buyer experience
- a qualification and relationship-preservation tool

### 2. One-Sentence Product Definition

`Rel8tion is a trust-driven Smart Sign system that turns a verified open house interaction into buyer capture, relationship protection, and long-term deal opportunity.`

### 3. Primary Value Layers

#### 1. Trust Value

- real-world
- time-stamped
- event-bound
- agent-authorized

#### 2. Lead Value

- captures buyer details
- captures buyer intent
- captures mortgage opportunity
- captures represented-buyer status

#### 3. Relationship Value

- protects buyer-agent relationships
- keeps listing agent visible
- creates agent-to-agent communication paths
- supports post-event coordination

#### 4. Experience Value

- buyer-friendly check-in
- property info
- media
- disclosures
- questions
- guided house experience

### 4. MVP Product Promise

The MVP promise should remain:

`No app. No password. No setup headache. Tap, confirm, and go live.`

The MVP should feel like:

1. agent receives chip
2. agent taps chip at open house
3. system detects closest enriched open house
4. system asks “Is this you?”
5. agent confirms
6. event is live

That is the wedge.

### 5. Smart Sign Activation Logic

#### Initial Registration

The sign setup flow should register:

- `two NFC chips`
- `one smart sign`
- `one owner agent`

Recommended verification order:

1. agent chip activated first
2. sign chip A registered
3. sign chip B registered
4. ownership verified through:
   - listing recognition
   - browser session
   - OTP text code
   - fallback password only if necessary

#### Event Handshake

Recommended live event handshake:

1. keychain tap
   - identifies host agent
   - starts activation session
2. sign tap
   - verifies physical sign
3. final keychain tap
   - seals trust handshake
4. listing confirmation
   - nearest listing or manual selection
5. event goes live

This should be the official production model.

### 6. Core Check-In Questions For MVP

The buyer check-in flow should capture, at minimum:

- name
- phone
- email
- represented or not
- buyer agent name
- buyer agent phone
- buyer agent email
- `Are you pre-approved?`

That last question matters because:

- if `yes`, that helps qualification
- if `no`, that creates mortgage lead opportunity

This is both:
- short-term value
- long-term revenue value

### 7. Relationship Protection Language

Rel8tion should consistently describe this feature as:

`Buyer-Agent Relationship Protection`

Meaning:

- if a buyer arrives with an agent, that relationship is preserved
- the listing agent knows the buyer is connected
- the buyer agent can remain visible in the process
- agent-to-agent communication can open
- fee / compensation communication can happen more cleanly

### 8. Buyer Experience Language

The buyer-facing shell should consistently be described as:

`The Live Open House Experience`

Not:

- form page
- sign-in page
- lead page

The Live Open House Experience should eventually include:

- buyer-friendly check-in
- disclosures
- e-signature
- property card
- photos
- video
- ask a question
- find out more
- school info
- walk score
- area info

For MVP, only the cleanest essential pieces should ship first.

### 9. Offer Structure

#### Tier 1: Founding 20 Beta

Purpose:
- field testing
- bug discovery
- social proof
- testimonials
- case studies

Recommended structure:

- `20 agents only`
- `2 to 3 week beta period`
- `free for life`

Agent gives in exchange:

- active bug testing
- real event usage
- feedback
- testimonial if experience is positive
- permission to use social proof, photos, and/or short video

Recommended public label:

`Founding 20 Smart Sign Beta`

#### Tier 2: Core Smart Sign Plan

Purpose:
- first real paid offer
- centered on sign value and automation value

Recommended positioning:

`Your Smart Sign goes live instantly and keeps the relationship working after the open house.`

Included:

- one smart sign
- two Rel8tionChips
- instant activation
- live event setup
- buyer check-in
- basic buyer qualification
- SMS alerts
- automated buyer follow-up
- automated relationship-building
- lightweight status center

Recommended price:

- `$299/month`
- `+$199 one-time activation kit fee`

Reasoning:

- the sign is where the value is
- the relationship engine creates recurring value
- this should not be priced like a gadget

#### Tier 3: Pro Smart Sign + CRM

Purpose:
- higher-value operators
- serious solo agents
- small teams
- broker-ready expansion

Included:

- everything in Core
- advanced dashboard
- analytics
- check-in history
- event history
- outreach inbox
- buyer timeline
- CRM-style workflow
- multi-sign management
- advanced follow-up controls

Recommended price:

- `$599/month`
- `includes first sign`
- additional sign recommendation:
  - `+$99/month per additional active sign`

#### Tier 4: Brokerage / Enterprise

Purpose:
- team rollouts
- brokerage control
- multi-agent usage

Included:

- everything in Pro
- team permissions
- brokerage analytics
- multi-agent oversight
- shared event controls
- admin tools

Recommended price:

- custom pricing
- recommend anchor:
  - `starting around $1,500/month+`

### 10. What Each Tier Actually Gets

#### Founding 20 Beta

- no heavy dashboard requirement
- no setup complexity
- primarily SMS-based operations
- enough tooling to test the real-world flow

#### Core Smart Sign Plan

- sign value
- trust value
- capture value
- relationship automation

This is the true first paid plan.

#### Pro

- operations visibility
- analytics
- workflow management

This is where the dashboard becomes a feature, not the product itself.

### 11. Rollout Timeframes

These are recommended execution windows, not promises to customers.

#### Phase 1: Lock The Magic

Target:
- `1 to 2 weeks`

Goals:

- modular claim flow promoted
- `claim2.html` wording merged into modular claim
- nearest listing detect + confirm flow stable
- instant activation experience polished

#### Phase 2: Lock Smart Sign Handshake

Target:
- `1 to 2 weeks after Phase 1`

Goals:

- dual-chip sign registration
- chip -> sign -> chip handshake
- setup session persistence
- create/resume live event

#### Phase 3: Public Event Experience

Target:
- `1 week`

Goals:

- public sign route stable
- sign resolver stable
- event shell stable
- active/inactive/stale handling stable

#### Phase 4: Founding 20 Beta

Target:
- `2 to 3 weeks`

Goals:

- real-world testing
- bug logging
- social proof collection
- testimonial collection

#### Phase 5: Core Paid Launch

Target:
- immediately after beta stabilization

Goals:

- convert beta lessons into Core offer
- launch monthly plan
- keep onboarding friction near zero

#### Phase 6: Pro Dashboard

Target:
- after Core offer is operational and sticky

Goals:

- analytics
- CRM
- multi-sign and advanced operator controls

### 12. Uniform Messaging Rules

Always say:

- `Rel8tionChip`
- `Smart Sign`
- `Handshake`
- `Trust Layer`
- `Live Open House Experience`
- `Buyer-Agent Relationship Protection`

Avoid reducing the product to:

- check-in tool
- NFC sign
- QR form
- lead form

The right framing is:

- trusted event infrastructure
- live open house operating system
- relationship engine

### 13. Build Priority Rules

#### Build First

- modular claim
- final claim wording
- smart sign handshake
- public event chain

#### Build Second

- automated follow-up
- relationship engine
- clean buyer shell

#### Build Third

- full dashboard
- analytics
- CRM
- brokerage controls

### 14. One-Line Offer Language By Tier

#### Founding 20 Beta

`Be one of the first 20 agents to use the Rel8tion Smart Sign system free for life in exchange for testing, feedback, and social proof.`

#### Core Smart Sign Plan

`Turn every open house into a trusted live event that captures buyers and keeps the relationship working after they leave.`

#### Pro Smart Sign + CRM

`Run your open house system with advanced visibility, analytics, and relationship workflow tools.`

### 15. Final Strategic Rule

The dashboard is not the wedge.

The wedge is:

- instant activation
- trusted live event
- buyer capture
- relationship protection

The dashboard becomes valuable after the magic is already proven.
