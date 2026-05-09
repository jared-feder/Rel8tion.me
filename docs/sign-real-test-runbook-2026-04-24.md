# Sign Real Test Runbook - 2026-04-24

## Goal

Get one physical Smart Sign into a real testable state tonight with:

- one claimed agent chip
- one seeded `smart_signs` row
- two embedded sign-chip UIDs
- one public sign code

Then verify:

1. chip context is recognized
2. sign resolves
3. buyer route loads from the live sign

## Branch And Preview

- Branch: `modular-claim-test`
- Preview:
  - `https://rel8tion-me-git-modular-claim-test-jared-feders-projects.vercel.app`

## Required One-Time DB Prep

Run:

- [20260423_device_assignment_slots.sql](C:/Dev/GitHub/Rel8tion.me/sql/migrations/20260423_device_assignment_slots.sql:1)

Then run:

- [sign-real-test-seed.sql](C:/Dev/GitHub/Rel8tion.me/sql/sign-real-test-seed.sql:1)

Fill these values first:

- `AGENT_SLUG`
- `SIGN_PUBLIC_CODE`
- `SIGN_CHIP_UID_PRIMARY`
- `SIGN_CHIP_UID_SECONDARY`
- `SIGN_SLOT_NUMBER`

## What The Seed Must Produce

The target `smart_signs` row needs to contain:

- `public_code`
- `uid_primary`
- `uid_secondary`
- `activation_uid_primary`
- `activation_uid_secondary`
- `assigned_agent_slug`
- `assigned_slot`

That is the current manual stand-in for the not-yet-built dual-chip auto-registration ceremony.

## Real Test URLs

Use the real preview alias from the handoff:

- Agent chip route:
  - `https://rel8tion-me-git-modular-claim-test-jared-feders-projects.vercel.app/k?uid=REAL_AGENT_CHIP_UID`
- Public sign route:
  - `https://rel8tion-me-git-modular-claim-test-jared-feders-projects.vercel.app/s?code=REAL_PUBLIC_CODE`

## Real Test Sequence

1. Confirm the agent chip is already claimed to the correct `agent_slug`.
2. Seed the sign row with both real embedded sign-chip UIDs and the public code.
3. Open the chip route with the real claimed chip UID.
4. Open the sign route with the real public code.
5. Confirm the sign resolves instead of showing "Invalid Sign" or "not attached".
6. Continue into the buyer shell from the sign if an active event is present.

## Expected Outcomes

Pass looks like:

- chip route recognizes the claimed chip and agent context
- sign route finds the `smart_signs` row by `public_code`
- sign route can load an active event when attached
- buyer-facing shell opens from the sign route

Fail modes to watch for:

- no `smart_signs` row found for the code
- only one sign chip UID present
- wrong claimed agent slug
- sign exists but `active_event_id` is still null

## Fast Debug Checks

If the sign route fails first:

- verify the exact `public_code`
- verify both sign-chip UIDs are on the same `smart_signs` row

If the sign resolves but is inactive:

- the row exists, but no live event is attached yet
- that means the seed worked, but activation/event binding still needs to occur

## Important Truth

For tonight, the real blocker is not the public sign page itself.

The blocker is getting one clean `smart_signs` record into the expected shape so the existing flow has something real to resolve against.
