## Rel8tion Go-Forward Blueprint V1

Date: `2026-04-22`

This is the practical working draft for moving Rel8tion forward.

It is meant to be:
- clear
- opinionated
- easy to revise later

It is not meant to be perfect.

## 1. The Product In One Sentence

`Rel8tion turns a verified open house interaction into trust, buyer capture, relationship protection, and long-term opportunity.`

## 2. The Core Mental Model

### Rel8tionChip

- represents `you`
- portable identity token
- trust credential
- agent authorization object

### Smart Sign

- represents `your live event`
- public-facing event identity
- buyer entry point
- physical open-house gateway

### Handshake

- links the agent and the event
- verifies the event is real and authorized
- creates the trust layer

### Trust Layer

- real person
- real event
- real place
- real time

This is the strategic difference between Rel8tion and a generic QR check-in form.

## 3. The Actual Product Stack

### Layer 1: Identity

Purpose:
- identify the agent
- bind chip to claimed profile

Core entities:
- `keys.uid`
- `keys.agent_slug`
- `agents.slug`

### Layer 2: Activation

Purpose:
- let an agent go live in seconds

Core experience:
- tap chip
- detect listing
- ask “Is this you?”
- confirm
- go live

Primary implementation source:
- `modular-claim-test`

### Layer 3: Smart Sign Event

Purpose:
- make the sign the live event object

Core entities:
- `smart_signs`
- `smart_sign_scan_events`
- `open_house_events`

### Layer 4: Buyer Experience

Purpose:
- give buyers a clean, modern open-house interface

Core experience:
- tap phone
- see property
- check in
- answer qualification questions
- get a guided open-house experience

### Layer 5: Relationship Engine

Purpose:
- keep listing agent, buyer agent, buyer, and mortgage opportunity connected after the visit

Core experience:
- alerts
- follow-up
- buyer-agent protection
- listing-agent visibility

### Layer 6: Service Partner Activation

Purpose:
- bring loan officers and other service professionals into the system through the same trust model
- create verified public service pages activated from a physical Rel8tionchip
- support long-term deal tracking and revenue attribution

Core experience:
- tap chip
- activate verified page
- publish public contact + service profile
- capture downstream opportunity

### Layer 7: Ops / Dashboard

Purpose:
- give the operator visibility and control

This is important, but it is not the wedge.

## 4. MVP Definition

The MVP is:

- no app
- no password
- no setup headache
- near-instant activation
- buyer-friendly check-in
- mortgage lead capture
- simple SMS-based value after the event

### MVP Promise

`Tap, confirm, and go live.`

### MVP Agent Flow

1. Agent taps Rel8tionChip.
2. System checks closest open house.
3. If enriched, agent details appear.
4. Screen asks: `Is this you?`
5. Agent confirms.
6. Rel8tion goes live.

That is the first magic moment.

## 5. Smart Sign Logic

### Registration Logic

A Smart Sign should have:

- one sign identity
- two NFC chips registered to it
- one owning agent or account context

### Live Event Handshake

Recommended final production sequence:

1. keychain tap
2. sign tap
3. final keychain tap
4. listing confirmation
5. event goes live

### Why This Matters

This sequence means:
- QR alone cannot go live
- sign alone cannot go live
- chip alone does not define the event

Only the handshake creates the trusted event.

## 6. Buyer Check-In MVP

### Required Fields

- name
- phone
- email
- represented buyer or not
- buyer agent name
- buyer agent phone
- buyer agent email
- pre-approved yes/no

### Why Pre-Approval Matters

If buyer is not pre-approved:
- that is a mortgage opportunity
- this creates direct revenue value for you

This should be treated as a core monetization branch, not a side feature.

## 7. Buyer-Agent Relationship Protection

This should be named consistently as:

`Buyer-Agent Relationship Protection`

Meaning:
- listing agent can see when a buyer came with an agent
- buyer agent remains visible
- buyer-agent relationship is protected
- agent-to-agent communication can begin
- future cooperation/fee conversations become easier

This is one of the strongest differentiators in the whole system.

## 8. Buyer-Facing Experience Vision

The buyer interface should eventually become:

`The Live Open House Experience`

Not just:
- a form
- a sign-in screen
- a contact capture page

### Future Buyer Experience Features

- clean check-in
- disclosures
- e-signature
- property card
- photos
- videos
- ask a question
- request more info
- school info
- walk score
- local area details
- listing-agent visibility through and after the visit

For MVP, keep only the cleanest essentials.

## 9. Pricing Structure

### Founding 20 Smart Sign Beta

Purpose:
- bug testing
- real-world usage
- testimonials
- social proof

Structure:
- 20 agents only
- 2 to 3 week beta window
- free for life

What they owe in exchange:
- real testing
- feedback
- testimonials if positive
- social proof if positive

### Core Smart Sign Plan

This should be the first real paid offer.

Included:
- Smart Sign
- two Rel8tionChips
- instant activation
- live open house setup
- buyer check-in
- qualification questions
- SMS alerts
- automated lead follow-up
- relationship-building automation

Recommended price:
- `$299/month`
- `+$199 one-time activation kit fee`

### Pro Smart Sign + CRM

Included:
- everything in Core
- advanced dashboard
- analytics
- event history
- check-in history
- outreach inbox
- CRM-style tools
- multi-sign visibility

Recommended price:
- `$599/month`

### Brokerage / Enterprise

Included:
- everything in Pro
- team permissions
- brokerage visibility
- admin control
- multi-agent operational tools

Recommended price:
- custom
- anchor around `$1,500+/month`

## 10. Rollout Plan

### Phase 1: Claim Foundation

Target:
- `1 to 2 weeks`

Goal:
- move modular claim toward real app foundation
- merge wording from `claim2.html`

Source of truth:
- structure from `modular-claim-test`
- wording from `claim2.html`

### Phase 2: Smart Sign Handshake

Target:
- `1 to 2 weeks`

Goal:
- finalize dual-chip sign registration
- finalize chip -> sign -> chip handshake
- finalize create/resume event logic

### Phase 3: Public Sign Flow

Target:
- `1 week`

Goal:
- stable public QR route
- stable sign resolver
- stable event shell

### Phase 4: Founding 20 Beta

Target:
- `2 to 3 weeks`

Goal:
- field test
- identify bugs
- gather proof

### Phase 5: Core Paid Launch

Goal:
- launch recurring revenue offer

### Phase 6: Pro Dashboard

Goal:
- add advanced operator value after the magic is already proven

## 11. Vercel App Direction

The final product should move toward a Vercel-based app shell rather than WordPress-first operations.

### Recommended App Zones

- `/k`
  - chip router
- `/claim`
  - activation flow
- `/sign`
  - sign resolver
- `/event`
  - buyer-facing event shell
- `/admin`
  - protected ops dashboard
- `/nmb-activate`
  - service-partner activation flow
- `/nmb-verified`
  - service-partner verified public page
- `/services/nmb/activate`
  - clean alias for the same activation flow
- `/services/nmb/verified`
  - clean alias for the same verified page

### WordPress Role Going Forward

WordPress should become:
- marketing site
- informational pages
- maybe lightweight public content

It should not remain the long-term operational shell.

That includes:
- NMB activation
- verified service pages
- chip logic
- sign logic
- event logic

## 12. Source Of Truth By Area

### Claim

- implementation: `modular-claim-test`
- wording: `claim2.html`
- legacy reference only: `claim.html`

### Smart Sign

- modular logic: `smart-sign/`
- schema direction: `sql/migrations/20260409_smart_sign_phase_1_1_cleanup.sql`

### Outreach

- current deployed handoff lives under `docs/` and Supabase functions

### Product Language

- `docs/uniform-language-pricing-roadmap-v1.md`
- `docs/platform-map-v1.md`
- this file

## 13. Immediate Action List

### Right Now

1. Treat `modular-claim-test` as the base claim implementation.
2. Pull the final language from `claim2.html`.
3. Finalize Smart Sign handshake rules.
4. Lock the public sign -> event flow.
5. Keep dashboard work secondary until the trust flow is stable.

### After That

1. Run Founding 20 beta.
2. Collect proof.
3. Tighten bugs.
4. Launch Core paid plan.

## 14. Final Strategic Rule

Do not let the product get described as:
- a form tool
- a check-in tool
- an NFC gadget

The right description is:

`Rel8tion is a trust-based Smart Sign system for open houses that verifies the event, captures the buyer, protects the relationships, and keeps the opportunity alive after the visit.`
