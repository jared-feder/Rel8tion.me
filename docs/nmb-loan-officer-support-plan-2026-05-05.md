# NMB Loan Officer Support Plan

Date: 2026-05-05

## Purpose

The current loan officer support inside Rel8tion is only a very early event-present flow. It lets an agent add a loan officer from the agent dashboard by having the loan officer scan their keychain near the event. That is useful as a backup path, but it is not the full product.

The real goal is to create an NMB support system where loan officers can support agents remotely, accept event invitations ahead of time, go live from their own device, and receive buyer financing inquiries in real time.

This document describes the intended product flow before implementation.

## Current State

The current dashboard flow is simple:

1. Agent opens the live event dashboard.
2. Agent selects `Add Loan Officer`.
3. The system waits for a loan officer keychain scan.
4. A verified loan officer scans their keychain.
5. A live loan officer session is created for the event.
6. The agent dashboard shows that loan officer as live.
7. Buyer financing requests can be routed to the live loan officer.

This works only when the loan officer is physically present or scanning on the same activation path. It does not yet support real remote coverage, pre-event invitations, loan officer acceptance, agent-loan officer relationships, or a clean loan officer-side dashboard.

## Target Product

NMB loan officer support should work as a coverage network, not just a keychain scan.

The ideal system should allow:

- Agents to request specific NMB loan officers.
- NMB loan officers to request or offer support to agents.
- Agents and loan officers to become linked before an event.
- Agents to invite a linked loan officer to support a specific open house.
- Loan officers to accept or decline event support from their own device.
- Loan officers to go live at event time by scanning their own keychain on their own phone.
- Agent dashboards to show whether support is invited, accepted, live, or unavailable.
- Buyers who are not pre-approved to be routed immediately to the live loan officer.
- Agent, buyer, and loan officer communication to happen through SMS, call, video link, or later in-app messaging.

## Core Concept

There should be three separate layers:

1. Loan officer identity
2. Agent-to-loan-officer relationship
3. Event-specific loan officer coverage

Keeping these separate prevents the system from becoming fragile.

An agent may know a loan officer before an event exists.

A loan officer may be linked to an agent but not supporting a specific event.

A loan officer may be invited to an event but not yet live.

A loan officer may be live for an event and ready to receive buyer financing requests.

Each of those states needs to be tracked separately.

## Layer 1: Loan Officer Identity

This layer identifies verified NMB loan officers.

The current system already has a version of this through verified profiles and NMB activation.

A loan officer profile should include:

- Loan officer name
- Title
- Company
- Phone
- Email
- Photo
- Keychain UID
- Calendar link
- CTA link
- Active status

The keychain should verify that the loan officer is really the person going live.

This profile should exist even if the loan officer is not currently assigned to an event.

## Layer 2: Agent And Loan Officer Relationship

This is the relationship layer.

Agents should be able to request specific loan officers.

Loan officers should also be able to request or offer support to agents.

Suggested table:

`agent_loan_officer_links`

Suggested fields:

- `id`
- `agent_slug`
- `loan_officer_slug`
- `loan_officer_uid`
- `status`
- `requested_by`
- `created_at`
- `accepted_at`
- `declined_at`
- `blocked_at`

Suggested statuses:

- `requested`
- `accepted`
- `declined`
- `blocked`
- `preferred`

Example:

Donna Agent requests John Loan Officer.

John accepts.

Now John appears as an available support option on Donna's agent dashboard.

This does not mean John is live for every event. It only means the relationship exists.

## Layer 3: Event Loan Officer Invitation

This layer connects a loan officer to one specific open house event.

Suggested table:

`event_loan_officer_invites`

Suggested fields:

- `id`
- `open_house_event_id`
- `agent_slug`
- `loan_officer_slug`
- `loan_officer_uid`
- `status`
- `invite_token`
- `invite_channel`
- `invited_at`
- `accepted_at`
- `declined_at`
- `canceled_at`
- `go_live_prompted_at`

Suggested statuses:

- `invited`
- `accepted`
- `declined`
- `canceled`
- `live`
- `ended`

Example:

Donna Agent has an open house tomorrow.

Donna invites John Loan Officer to support that event.

John receives a text or email.

John accepts.

When the event starts, John is prompted to go live.

John scans his own keychain on his own phone.

The agent dashboard now shows John as live.

## Live Coverage Layer

The existing `event_loan_officer_sessions` table can remain the live session layer.

This table should represent who is actually live right now.

Suggested behavior:

- When a loan officer accepts an invite, they are not live yet.
- When they scan their keychain for the event, they become live.
- When the event ends or the loan officer signs out, the live session ends.

For beta, the cleanest version is one primary live loan officer per event.

Later, this can expand to multiple loan officers, primary and backup support, or an NMB coverage pool.

## Agent Dashboard Experience

The agent dashboard should have a clear `Loan Officer Support` section.

Possible states:

### No Loan Officer Assigned

Show:

- No loan officer assigned yet.
- Request NMB loan officer.
- Invite preferred loan officer.
- Local keychain sign-in.

### Invited

Show:

- Loan officer name
- Status: Invited
- Waiting for acceptance
- Cancel invite

### Accepted

Show:

- Loan officer name
- Status: Accepted
- Scheduled to support this event
- Waiting to go live

### Live

Show:

- Loan officer photo
- Name
- Phone
- Company
- Status: Live
- Call button
- Text button
- Video or meeting button if available
- Financing alerts enabled

### Offline Or Ended

Show:

- Loan officer was assigned but is no longer live.
- Request support again.
- Invite another loan officer.

## Loan Officer Experience

Loan officers need their own simple path.

They should be able to open a link and see:

- Agents requesting support
- Events they are invited to support
- Event address
- Event time
- Agent name
- Accept
- Decline
- Go live

At event time, they should see:

`Go Live For This Open House`

When they tap it, the app prompts them to scan their keychain on their own device.

After verification:

- Their session becomes live.
- The agent dashboard updates.
- Buyer financing requests can route to them.

## Buyer Financing Flow

When a buyer checks in and says they are not pre-approved, the system should check the loan officer support state.

### If A Loan Officer Is Live

The system should:

- Notify the loan officer.
- Notify the agent.
- Optionally send the buyer a loan officer intro text.
- Show call/text options where appropriate.
- Save the financing request to the buyer or event record.

### If A Loan Officer Accepted But Is Not Live

The system should:

- Notify the accepted loan officer that buyer financing help is needed.
- Notify the agent that the loan officer has not gone live yet.
- Optionally route to fallback NMB support.

### If No Loan Officer Is Assigned

The system should:

- Notify internal NMB support or the default fallback number.
- Notify the agent that no live loan officer is currently assigned.
- Save the buyer financing request so it is not lost.

## Communication Options

The first production-ready version should use simple reliable communication:

- SMS
- Click-to-call
- Loan officer calendar link
- Optional video link

Custom in-app chat should come later.

Suggested order:

1. SMS and call
2. Shared conversation log
3. In-app messaging modal
4. Video handoff
5. Full buyer-agent-loan officer support thread

This keeps the beta useful without overbuilding the hardest part first.

## Recommended MVP

The MVP should include:

1. Keep the current local keychain scan as a backup route.
2. Create agent-to-loan-officer relationship records.
3. Create event-level loan officer invites.
4. Let agents invite a linked loan officer from the event dashboard.
5. Send the loan officer an invite link.
6. Let the loan officer accept from their own phone.
7. Let the loan officer go live by scanning their keychain on their own phone.
8. Show invited, accepted, live, and ended states on the agent dashboard.
9. Route buyer not-pre-approved requests to the live loan officer.
10. Fall back to internal NMB support if no loan officer is live.

## Important Product Decisions

Before implementation, these decisions should be confirmed:

1. Should each event have only one live loan officer for now?
2. Should loan officers be able to support multiple events at the same time?
3. Should agents be able to invite any NMB loan officer, or only linked/preferred ones?
4. Should loan officer acceptance require a keychain scan immediately, or only when going live?
5. Should fallback support go to Jared, a default NMB number, or a rotating support pool?
6. Should buyer SMS introduce the loan officer automatically, or should the agent control that?
7. Should video be a simple external link first, instead of native in-app video?

## Recommended Decisions For Beta

For the beta version, the safest choices are:

- One primary loan officer per event.
- Loan officer acceptance does not require a keychain scan.
- Going live does require a keychain scan.
- SMS and call come before in-app chat.
- Video is an optional external link.
- Fallback support routes to a default NMB support number.
- The current local keychain scan remains available as an emergency/manual option.

## Build Phases

### Phase 1: Data Model

Add the relationship and invite tables.

Keep the existing live session table.

Make sure statuses are explicit and easy to debug.

### Phase 2: Agent Dashboard

Add a polished loan officer support card.

Allow the agent to:

- Request a loan officer
- Invite a linked loan officer
- View invite status
- See live support
- Call or text live support

### Phase 3: Loan Officer Invite Page

Add a simple loan officer page where they can:

- See event invite details
- Accept
- Decline
- Go live at event time

### Phase 4: Own-Device Keychain Verification

When the loan officer chooses to go live, require them to scan their own verified keychain.

This creates or updates the live event session.

### Phase 5: Buyer Financing Routing

When a buyer is not pre-approved:

- Send buyer info to the live loan officer.
- Notify the agent.
- Optionally send buyer an intro to the loan officer.
- Save all activity to the event/lead record.

### Phase 6: Messaging And Follow-Up

Add stored conversation records and a dashboard view.

This can later become a real chat system.

## Final Target

The final product should make the agent feel covered.

At the open house, the agent should see:

`NMB Support: Live`

with the loan officer's name, photo, company, phone, and action buttons.

When a buyer needs financing help, the agent should know that the buyer is not just being captured, but actively routed to someone who can help immediately.

The system should feel like the agent has a live lending partner at the event even when the loan officer is remote.
