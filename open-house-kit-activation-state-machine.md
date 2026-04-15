# Rel8tion Open House Kit Activation State Machine

## Goal
Turn the self-serve kit into a no-dashboard activation flow:

1. Agent activates Rel8tionChip first
2. Agent starts smart sign activation
3. Agent taps sign NFC
4. Agent scans sign QR
5. Agent taps Rel8tionChip again to complete the handshake
6. System detects / confirms listing and binds sign to event
7. Sign goes live

---

## Core Principle
The final chip tap is the trust handshake.

Without an activated Rel8tionChip and final handshake, the sign must not go live.

This makes the base paid phase possible with no dashboard.

---

## Main Entities

### Agent chip identity
- `keys.uid`
- `keys.agent_slug`

### Agent profile
- `agents.slug`

### Smart sign identity
- `smart_signs.id`
- `smart_signs.public_code`
- `smart_signs.owner_agent_slug`
- `smart_signs.status`
- `smart_signs.active_event_id`

### Event identity
- `open_house_events.id`
- `open_house_events.open_house_source_id`

---

## Recommended Sign Statuses
- `unclaimed`
- `chip_activated`
- `sign_detected`
- `qr_verified`
- `handshake_pending`
- `listing_pending`
- `active`
- `inactive`
- `error`

You can simplify later, but this is the safest state model for now.

---

## End-to-End Activation Flow

### State 0 - Kit received
Physical box contains:
- 2 Rel8tionChips
- 1 smart sign
- Sign QR already printed
- Sign NFC already embedded
- Activation instructions

### State 1 - Agent activates chip
Route:
- existing claim / keychain activation flow

Expected result:
- `keys.uid` linked to `keys.agent_slug`
- chip is now trusted as the activation token

### State 2 - Prompt to activate sign
After chip activation succeeds, show CTA:
- `Activate Your Smart Sign`

### State 3 - Sign NFC scan
The sign NFC identifies the physical sign.

Expected result:
- system finds or creates `smart_signs` row
- sign status moves to `sign_detected`

### State 4 - Sign QR scan
QR points to permanent route:
- `/s.html?code=PUBLIC_CODE`

Expected result:
- confirms public sign identity
- sign status moves to `qr_verified`

### State 5 - Final chip tap / handshake
Agent taps the activated Rel8tionChip again.

System verifies:
- chip is already activated
- same agent is authorizing
- sign session is in progress
- sign and chip belong to the same activation session

Expected result:
- sign status moves to `handshake_pending` -> `listing_pending`
- ownership / trust is sealed

### State 6 - Listing detection and confirmation
System detects nearest listing, then asks agent to confirm.

Expected result:
- create or resume `open_house_events` row
- attach sign to event
- update `smart_signs.active_event_id`
- set `smart_signs.owner_agent_slug`
- set `smart_signs.status = 'active'`
- set `smart_signs.setup_confirmed_at`

### State 7 - Live
Public route chain:
- `/s.html?code=PUBLIC_CODE`
- `-> /sign-view-test.html?code=PUBLIC_CODE`
- `-> /event-shell-test.html?event=OPEN_HOUSE_EVENT_ID`

Expected result:
- QR and sign taps land in the same live event shell

---

## Required Resolver Behavior

### Branch A - Sign exists but is not active
Route:
- `/s.html?code=PUBLIC_CODE`

Behavior:
- show sign exists but is not active
- protected activation only
- do not show buyer event shell

### Branch B - Sign is active
Route:
- `/s.html?code=PUBLIC_CODE`

Behavior:
- resolve active event
- show live event shell

---

## Fallbacks

### Fallback 1 - Chip activated but sign NFC fails
Show:
- `We could not read the sign NFC. Scan the sign QR to continue.`

### Fallback 2 - QR scanned but sign not yet sealed
Show:
- `Sign found. Final chip tap required to bring it to life.`

### Fallback 3 - Handshake chip tap does not match activation agent
Show:
- `This sign can only be activated by the Rel8tionChip that started setup.`

### Fallback 4 - Listing detection fails
Show:
- manual listing select
- manual setup continue option

### Fallback 5 - Event creation fails
Show:
- retry event attach
- preserve activation session
- do not lose verified sign session state

### Fallback 6 - Public QR scanned before activation
Show:
- sign found
- not active yet
- protected setup required

### Fallback 7 - Existing active event stale / old
If sign points to ended event:
- show inactive / reactivation prompt to protected agent flow
- do not drop buyers into wrong stale event shell

---

## Safety Rules

1. A sign cannot go live without an already-activated chip.
2. A sign cannot go live from QR alone.
3. A buyer should never be able to accidentally trigger setup.
4. Final handshake must match the initiating agent token.
5. Listing confirmation is required before live activation.
6. Same printed QR must work before activation, during activation, and after activation.

---

## No-Dashboard Base Paid Phase
This model supports a paid phase with no dashboard because setup itself becomes the interface.

Base paid kit can include:
- Rel8tionChip activation
- Smart sign activation
- Live public event shell
- Represented-buyer workflow
- Compliance-friendly event records

Dashboard becomes an upgrade layer later for:
- analytics
- history
- multi-sign management
- reassignment tools
- broker controls

---

## Suggested Next Build Order
1. Make `s.html` branch on inactive vs active sign states.
2. Add activation-session persistence for sign NFC + QR + final chip tap.
3. Add final handshake verification logic.
4. Add manual listing fallback in activation flow.
5. Replace placeholder sections in `event-shell-test.html` with real buyer check-in and represented-buyer flows.
6. Add stale-event guard so ended events do not stay publicly live.

---

## One-Line Product Framing
Tap. Scan. Handshake. Live.
