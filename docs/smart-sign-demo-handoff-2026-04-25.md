# Smart Sign Demo Handoff - April 25, 2026

This file preserves the working state reached tonight for the Rel8tion Smart Sign physical demo. It is intentionally detailed so nothing has to be reconstructed from memory tomorrow.

## Executive Summary

The real Smart Sign activation flow is now working end to end on production at `https://app.rel8tion.me`.

The tested physical flow is:

1. Fresh agent Rel8tionChip opens claim/onboarding.
2. Agent activates Smart Sign from onboarding.
3. Agent scans the printed Smart Sign QR.
4. Agent taps sign chip 1.
5. Agent taps sign chip 2.
6. Agent taps the agent keychain/Rel8tionChip again.
7. App detects listing options.
8. Agent selects the listing.
9. App creates the open house event and marks the sign active.
10. Buyer-facing live sign route opens.
11. After activation, scanning either sign chip opens the live buyer sign route, not the agent activation flow.
12. The activation success screen includes a guarded reset button so the same demo sign can be cleared and activated again.

The demo has been proven with real QR, real NFC chips, real Supabase rows, and the production alias.

## Demo Reset Button

A reset control was added after the first handoff package was created.

Where to find it:

1. Open the Smart Sign activation success screen.
2. Look under `Open Live Sign Route` and `Open Event Shell`.
3. Tap `Reset This Demo Sign`.
4. Type the exact sign public code to confirm.
5. Tap `Delete Last Full Sign Activation`.

For the current working sign, the confirmation code is:

`38e8d6eb579c`

The reset button is intentionally not on the buyer-facing `/s?code=...` page. It only appears on the activation success screen.

What the reset does by default:

- Deletes `open_house_events` rows tied to that `smart_sign_id`.
- Clears the `smart_sign_inventory.smart_sign_id` link.
- Clears `smart_sign_inventory.claimed_at`.
- Deletes the `smart_signs` row for that public code.
- Clears the browser's local Smart Sign activation session.
- Leaves the agent Rel8tionChip/keychain claimed.

What it does not do by default:

- It does not delete or unclaim every key for the agent.
- It does not wipe unrelated signs.
- It does not reset other rows unless they are tied to the exact sign public code being confirmed.

There is an optional checkbox:

`Also unclaim this current keychain UID`

Leave that unchecked for normal demo reset use. Only check it if the current agent keychain itself should be returned to first-time setup.

The reset flow was tested with a throwaway sign/inventory/event before deployment. The real working sign `38e8d6eb579c` was confirmed still active after deployment.

## Current Live Production State

Production URL:

`https://app.rel8tion.me`

Branch used for deploys:

`modular-claim-test`

Latest relevant deployed commit:

`0e617c3 Add demo smart sign reset action`

### Working Smart Sign

Smart sign public code:

`38e8d6eb579c`

Live sign route:

`https://app.rel8tion.me/s?code=38e8d6eb579c`

Inventory QR URL:

`https://app.rel8tion.me/s.html?code=38e8d6eb579c`

Smart sign row:

`smart_signs.id = 2b0f9786-6476-4b99-99fc-13bdee0e90a9`

Sign chip 1:

`uid_primary = 8ce0364c-411e-45f8-a9eb-2eb8954b0ca0`

Sign chip 2:

`uid_secondary = 987fb582-6ca3-4d8a-8dc2-54b6af6e2962`

Owner agent slug:

`owner_agent_slug = jared-u0j`

Sign status:

`status = active`

Active event:

`active_event_id = e19e02a8-f898-4859-8110-a8ee472d20a9`

### Working Open House Event

Event ID:

`e19e02a8-f898-4859-8110-a8ee472d20a9`

Listing:

`3727 Oceanside Rd E, Oceanside, NY 11572`

Open house source ID:

`M00000489-972883`

Host agent slug:

`host_agent_slug = jared-u0j`

Event status:

`status = active`

Activation method:

`activation_method = sign_demo_claimed_chip`

Setup context includes:

```json
{
  "flow": "sign-demo",
  "source": "claimed-chip-bridge",
  "address": "3727 Oceanside Rd E, Oceanside, NY 11572",
  "agent_slug": "jared-u0j",
  "sign_chip_primary": "8ce0364c-411e-45f8-a9eb-2eb8954b0ca0",
  "sign_chip_secondary": "987fb582-6ca3-4d8a-8dc2-54b6af6e2962",
  "detected_brokerage": "Coldwell Banker American Homes"
}
```

### Working Inventory Row

Inventory row:

`smart_sign_inventory.id = 00bd6326-bac9-48e7-8b39-61ba7f115980`

Public code:

`public_code = 38e8d6eb579c`

Printed QR URL:

`qr_url = https://app.rel8tion.me/s.html?code=38e8d6eb579c`

Linked smart sign:

`smart_sign_id = 2b0f9786-6476-4b99-99fc-13bdee0e90a9`

Claimed:

`claimed_at = 2026-04-25T02:47:49.655-04:00`

## What Was Built

The goal was a basic demo-ready Smart Sign activation mode with no dashboard requirement and no password friction.

The desired physical workflow was:

- Agent starts with a Rel8tionChip.
- Agent scans/taps through setup.
- Smart Sign QR identifies the physical sign.
- Two NFC chips bind to that sign.
- Final keychain tap confirms the owner.
- Agent selects listing.
- Sign becomes live.
- Sign chips become buyer-facing entry points.

That is now working.

## Core Code Paths

### `apps/rel8tion-app/k.html`

This is the live chip router.

It now handles these cases:

- Missing UID.
- Fresh unclaimed Rel8tionChip.
- Claimed agent Rel8tionChip.
- Sign chip 1 during activation.
- Sign chip 2 during activation.
- Final keychain handshake during activation.
- Already-active sign chip.

The most important final change was adding active sign chip routing before activation-session routing:

```js
async function findActiveSignByChipUid(chipUid) {
  const encodedUid = encodeURIComponent(chipUid);
  const response = await fetch(`${SUPABASE_URL}/rest/v1/smart_signs?or=(uid_primary.eq.${encodedUid},uid_secondary.eq.${encodedUid})&status=eq.active&select=id,public_code&limit=1`, {
    headers: {
      apikey: KEY,
      Authorization: `Bearer ${KEY}`,
      'Content-Type': 'application/json'
    }
  });
  if (!response.ok) return null;
  const rows = await response.json().catch(() => []);
  return Array.isArray(rows) ? rows[0] : null;
}
```

If a scanned UID belongs to an active sign, the router clears stale activation state and opens:

```js
/s?code=<public_code>
```

This fixed the problem where scanning a live sign chip still opened the agent activation flow.

### `apps/rel8tion-app/sign-demo-activate.html`

This is the Smart Sign demo activation state machine.

It handles:

- QR scanner.
- Manual QR code fallback.
- `smart_sign_inventory` lookup.
- Smart Sign creation/update after chip 1.
- Chip 2 registration.
- Final keychain handoff.
- Listing detection.
- Event creation.
- Smart Sign activation.
- Success screen.

Important rule:

QR scan should identify inventory/sign code only. It should not create a `smart_signs` row before chip 1 exists, because `smart_signs.uid_primary` is required.

### `sign-demo-activate.html`

This root duplicate file also exists and production can serve it directly.

Important: when changing the activation page, patch both:

- `sign-demo-activate.html`
- `apps/rel8tion-app/sign-demo-activate.html`

This duplicate file issue caused a real production mismatch during testing. The app copy was fixed, but production was still serving the old root copy.

## Trial And Error Timeline

### 1. QR scan failed with `uid_primary` not-null violation

Symptom:

After scanning the QR and continuing with code, Supabase returned:

`null value in column "uid_primary" of relation "smart_signs" violates not-null constraint`

Cause:

The QR step tried to create the `smart_signs` row before sign chip 1 was scanned.

Fix:

Delay sign creation/update until chip 1 exists. QR only resolves `smart_sign_inventory.public_code`.

Commit:

`916a52f Create smart sign after first sign chip scan`

### 2. Chip 1 returned to "Now Tap Sign Chip 1"

Symptom:

After tapping sign chip 1, the app kept returning to the same screen.

Cause:

The router treated the sign chip like a normal key. It did not prioritize the activation session stage.

Fix:

When session stage is `waiting_for_sign_chip_1` or `waiting_for_second_sign_chip`, route scanned chip UID to:

`/sign-demo-activate.html?sign_uid=<uid>`

Commit:

`d52cc33 Prioritize sign chip scans during activation`

### 3. Activation context disappeared between taps

Symptom:

The phone could return from an NFC scan, but the page lost sign/agent context.

Cause:

The redirect was not carrying enough activation context.

Fix:

Carry pending values through the redirect:

- `uid`
- `agent`
- `code`
- `sign_id`
- `inventory_id`

Commit:

`b818449 Carry activation context through sign chip scans`

### 4. Final keychain handoff got stuck

Symptom:

After chip 1 and chip 2 were saved, the screen stayed on:

`Now Tap The Keychain Again`

Cause:

The phone/browser lost the final activation session context.

Fix:

Add a fallback in `k.html`: if an agent keychain scans and a recently paired inactive sign exists with both chips, route back into activation with that sign context.

Commit:

`e3b8741 Add paired sign handshake fallback`

### 5. The final handoff still looped

Symptom:

Even after the fallback, tapping the keychain still returned to the same screen.

Cause:

`mergeStateFromSession()` in `sign-demo-activate.html` copied saved chip 1 into `state.signChipUid`:

```js
if (!state.signChipUid && p.primaryChipUid) state.signChipUid = p.primaryChipUid;
```

That made the page think the current scan was sign chip 1 again.

Fix:

Do not restore `signChipUid` from saved session. The current scanned UID must only come from the actual scan URL.

Commits:

`8832fed Fix smart sign keychain handoff loop`

`739e2e8 Fix root smart sign activation handoff`

### 6. Production was serving a different file

Symptom:

The code looked fixed locally and deployed, but the phone still saw the old loop.

Cause:

There are two files:

- `sign-demo-activate.html`
- `apps/rel8tion-app/sign-demo-activate.html`

Production served the root file.

Fix:

Patch both copies and verify the exact production URL response.

Commit:

`739e2e8 Fix root smart sign activation handoff`

### 7. Event creation failed with `agent_slug` schema-cache error

Symptom:

On the listing confirmation screen, activation returned:

`Could not find the 'agent_slug' column of 'open_house_events' in the schema cache`

Cause:

The live `open_house_events` table uses `host_agent_slug`, not `agent_slug`.

Fix:

Change event payload from:

```js
agent_slug: state.agentSlug
```

to:

```js
host_agent_slug: state.agentSlug
```

Also store `agent_slug` inside `setup_context` for compatibility/history.

This was verified with a live Supabase insert/delete test using a real open house ID.

Commit:

`4c87aa9 Use host agent slug for sign events`

### 8. Live sign chip still opened activation

Symptom:

After success, scanning a sign chip still behaved like an agent activation scan.

Cause:

The router checked activation/session behavior before asking whether this UID belonged to an active sign.

Fix:

Add active sign-chip lookup before activation-stage routing:

```js
smart_signs?or=(uid_primary.eq.<uid>,uid_secondary.eq.<uid>)&status=eq.active&select=id,public_code&limit=1
```

If found, clear activation localStorage and open:

```js
/s?code=<public_code>
```

Commit:

`662442e Route active sign chips to live sign`

### 9. Demo reset button added

Need:

For live demos, the same physical sign may be shown repeatedly instead of left with every agent. Manually deleting rows from Supabase would waste time and risks deleting the wrong rows.

Fix:

Add `Reset This Demo Sign` on the activation success screen.

The reset requires typing the exact sign code and then:

- Deletes event rows for the sign.
- Clears the inventory claim/link.
- Deletes the Smart Sign row, including chip bindings.
- Optionally unclaims the current keychain only if the checkbox is selected.

Commit:

`0e617c3 Add demo smart sign reset action`

## Commit Trail

Relevant commits in order:

```text
4484bcc Add onboarding smart sign demo activation
67e850a Add smart sign QR scanner inventory lookup
916a52f Create smart sign after first sign chip scan
d52cc33 Prioritize sign chip scans during activation
16c076b Add manual first sign chip fallback
b818449 Carry activation context through sign chip scans
ca1922c Accept pending keychain handshake by uid
e3b8741 Add paired sign handshake fallback
8832fed Fix smart sign keychain handoff loop
739e2e8 Fix root smart sign activation handoff
4c87aa9 Use host agent slug for sign events
662442e Route active sign chips to live sign
0e617c3 Add demo smart sign reset action
```

## What Must Not Be Lost Tomorrow

The working state is not theoretical. It is live in Supabase and live on production.

Do not reset or overwrite these rows unless intentionally starting a new demo sign:

- `smart_signs.id = 2b0f9786-6476-4b99-99fc-13bdee0e90a9`
- `smart_sign_inventory.id = 00bd6326-bac9-48e7-8b39-61ba7f115980`
- `open_house_events.id = e19e02a8-f898-4859-8110-a8ee472d20a9`
- `public_code = 38e8d6eb579c`
- `uid_primary = 8ce0364c-411e-45f8-a9eb-2eb8954b0ca0`
- `uid_secondary = 987fb582-6ca3-4d8a-8dc2-54b6af6e2962`

Exception:

If you intentionally use the new `Reset This Demo Sign` button and type the exact code `38e8d6eb579c`, these rows will be cleared so the same physical sign can be activated again. That is now the preferred reset path for demos.

Do not run a broad cleanup against:

- `smart_signs`
- `smart_sign_inventory`
- `open_house_events`
- `keys`

unless the target rows are explicitly filtered.

Before changing anything tomorrow, run a read-only check:

```powershell
$base = 'https://nicanqrfqlbnlmnoernb.supabase.co/rest/v1'
$code = '38e8d6eb579c'
# Use the existing anon KEY from apps/rel8tion-app/src/core/config.js.
# Confirm smart_signs.status is active and active_event_id is populated.
```

## Tomorrow Morning Demo Checklist

Before handing signs to agents:

1. Open `https://app.rel8tion.me/s?code=38e8d6eb579c`.
2. Confirm the buyer-facing page opens.
3. Tap sign chip 1.
4. Confirm it opens the buyer-facing page, not activation.
5. Tap sign chip 2.
6. Confirm it opens the buyer-facing page, not activation.
7. Tap the agent keychain.
8. Confirm it opens the agent route/profile, not the sign activation flow.
9. Confirm the database still shows `smart_signs.status = active`.
10. Confirm `active_event_id = e19e02a8-f898-4859-8110-a8ee472d20a9`.
11. If you need to reuse the same sign for another demo, use `Reset This Demo Sign` from the activation success screen and type the exact public code.
12. After reset, scan the QR again and run the activation flow fresh.

For each additional demo sign tomorrow:

1. Use a fresh sign QR/public code from `smart_sign_inventory`.
2. Use fresh/unbound sign chips.
3. Complete the activation flow once.
4. Confirm both sign chips route to `/s?code=<public_code>` after activation.
5. Record the new public code, smart sign ID, chip UIDs, agent slug, and event ID.

## What Needs To Be Done Next

### Immediate tomorrow safeguards

Create a small "demo sign registry" note or table before giving signs to agents. For each physical sign, record:

- Printed QR public code.
- Printed QR URL.
- Sign chip 1 UID.
- Sign chip 2 UID.
- Agent slug.
- Smart sign ID.
- Event ID.
- Whether buyer route was tested.
- Whether both NFC chips were tested after activation.
- Whether the sign was reset after the demo.

This prevents physical signs and database rows from drifting apart.

For signs you are only demoing and not leaving behind:

1. Demo the live sign.
2. If the agent will not keep it, return to the activation success screen.
3. Tap `Reset This Demo Sign`.
4. Type the exact public code.
5. Leave `Also unclaim this current keychain UID` unchecked unless you mean to reset that specific keychain.
6. Confirm the reset.
7. The printed QR and sign chips are ready for the next activation.

### Stabilize the codebase

1. Remove or consolidate duplicate root/app HTML files, especially `sign-demo-activate.html`.
2. Add a shared route/build rule so production cannot serve stale root copies.
3. Move the Smart Sign activation state machine out of one giant inline HTML script into versioned modules.
4. Add a small admin/debug page for demo signs showing public code, chips, owner, status, and event.
5. Add a read-only verification script:
   - Given public code, show inventory row, sign row, event row, and chip routing expectation.
6. Add a reset script for demo-only signs, but make it require the exact public code.
7. Later, move the reset action behind a proper admin/demo-only gate before wider production usage.

### Database protection

Add a safer server-side activation/session table later:

`smart_sign_activation_sessions`

Suggested fields:

- `id`
- `agent_uid`
- `agent_slug`
- `public_code`
- `smart_sign_id`
- `stage`
- `primary_chip_uid`
- `secondary_chip_uid`
- `expires_at`
- `completed_at`

This would reduce reliance on phone browser localStorage.

### Product polish

After the demo is safe:

1. Improve the activation UI copy.
2. Remove manual UID fallback buttons from demo mode if not needed.
3. Add clearer success language:
   - "This sign is live."
   - "Both sign chips now open the buyer page."
4. Add an agent handoff page for activated demo signs.
5. Add SMS-only confirmation if that is the basic tier.

## Known Caveats

1. The activation page still exists in two locations. Patch both until consolidated.
2. The current fallback for a recently paired inactive sign was built for demo speed, not multi-agent production scale.
3. Browser localStorage can still hold stale activation state, but active sign chip routing now clears it when the sign is live.
4. `open_house_events` uses `host_agent_slug`; older code may still refer to `agent_slug`.
5. `owner_agent_slug` is on `smart_signs`; event ownership is `host_agent_slug`.
6. The reset button is powerful. It is guarded by exact public-code confirmation, but it is still a real database reset for that sign.

## Verified End State

The final success screen showed:

- Sign Activated.
- Address: `3727 Oceanside Rd E, Oceanside, NY 11572`.
- Sign code: `38e8d6eb579c`.
- Event ID: `e19e02a8-f898-4859-8110-a8ee472d20a9`.
- Agent: `jared-u0j`.

The user confirmed:

- Open Live Sign Route works.
- Scanning the live sign chip opens the live buyer-facing sign route after the final router fix.

## The Human Milestone

I believe you. That was a lot of invisible weight: NFC weirdness, live database state, duplicate files, schema mismatch, phone browser state, deployment aliasing, all while you are trying to prove a real physical flow in your hand.

But you got it across the line. Not "kind of." The actual sign, actual chips, actual QR, actual live route. That is a huge milestone.

Take the win for a minute. This thing works.
