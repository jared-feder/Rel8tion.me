# REL8TION Event Pass Monetization Source of Truth

Last updated: 2026-05-16

## Core Decision

REL8TION's near-term monetization model is the **Rel8tion Event Pass**.

The Event Pass is a low-cost, keychain-sized open-house technology pass that lets a loan officer sponsor and support an agent's live open house without requiring the agent to buy a full kit first.

The Event Pass creates a live proof moment:

1. Buyer scans the QR and checks in.
2. Buyer completes the required disclosure flow.
3. Agent receives live buyer info by SMS during the event.
4. Loan officer appears as available mortgage support when financing help is requested.
5. At the end of the open house, the agent sees a recap dashboard and receives an email summary.
6. Agent is offered the permanent Rel8tion Open House Kit and dashboard subscription.

This closes the loop from outreach to live event to paid conversion.

---

## What the Event Pass Is

The Event Pass is a **B2B open-house technology product**.

It may be physically produced as a keychain or small pass with:

- **Buyer-facing QR side:** routes buyers to the active open-house check-in experience.
- **NFC side:** used for activation, agent dashboard access, or event setup flow.

The Event Pass is not positioned as a free giveaway. It is a sponsored live-event technology pass.

Preferred public name:

> **Rel8tion Event Pass**

Internal/legal/product name:

> **B2B Event Pass License**

---

## What Loan Officers Pay For

Loan officers are not buying leads or referrals.

Loan officers are purchasing:

- Verified loan officer profile
- Availability placement
- B2B Event Pass access
- Open-house event coverage tools
- Communication routing infrastructure
- Event reporting / recap tools
- Ability to appear as available mortgage support when a buyer requests financing help

Correct framing:

> Loan officers purchase a verified profile, availability placement, and B2B Rel8tion Event Pass access so they can support live open-house events when a buyer requests financing help.

Avoid wording such as:

- leads
- referrals
- buyer referrals
- guaranteed borrowers
- pay-per-preapproval
- pay-per-closing
- exclusive buyer leads

---

## What Agents Receive During The Sponsored Event

Agents receive value immediately, even if they never purchase.

During the event, agents receive:

- Live buyer check-in alerts by SMS
- Buyer contact information as it is submitted
- Disclosure completion status
- Pre-approval / financing-interest signals when buyer provides them
- A live or post-event dashboard view
- End-of-event recap email

Important principle:

> Rel8tion does not hold buyer information captive. The agent already receives live buyer information by SMS. The email recap and dashboard are the organized follow-up machine.

---

## Agent Conversion Offer

At the end of the open house, the agent sees proof of value and is offered a paid upgrade.

Conversion message:

> You already received the buyer alerts live by text. Activate your permanent Rel8tion dashboard to keep everything organized, use Rel8tion at your next open house, and receive your own open-house kit.

Paid product:

> **Rel8tion Open House Kit**

Includes:

- Branded smart sign
- Two branded Rel8tionChip keychains
- Permanent agent dashboard
- Buyer check-in
- Digital disclosure records
- Post-event recap reports
- Optional live/virtual loan officer support

Suggested pricing:

- Hardware/setup: $199
- Monthly dashboard/service: $49/month
- Annual option: $399/year
- Brokerage/team pricing: custom

---

## End-of-Open-House Conversion Screen

When the event ends, the dashboard should show:

- Buyer check-ins
- Disclosures completed
- Financing/pre-approval support opportunities
- Represented buyer count
- Follow-up opportunities
- Confirmation that live SMS alerts were already sent
- Confirmation that the recap email was sent

Suggested headline:

> **You Captured Real Buyers Today. Don't Let Them Go Cold.**

Suggested CTA:

> **Activate My Dashboard + Order My Kit**

Secondary CTAs:

- Text me the activation link
- Have my loan officer help me set it up
- Book another sponsored Event Pass

---

## Post-Event Email Role

The recap email is not the only way the agent gets lead information. It is the organized proof and conversion bridge.

Email should include:

- Event address/date/time
- Number of check-ins
- Disclosure completion count
- Financing-interest count
- Buyer list summary
- Live SMS confirmation
- CTA to activate permanent dashboard
- CTA to order Rel8tion Open House Kit

Core email message:

> You already received the live buyer alerts by text during the event. This recap keeps everything organized in one place so you can follow up faster, stay compliant, and use Rel8tion at your next open house.

---

## Buyer-Facing Disclosure Principle

Rel8tion is not a lender and does not handle pre-approval.

Rel8tion should not collect:

- Social Security numbers
- Credit reports
- Bank statements
- Income documents
- Loan applications
- Credit authorization

Rel8tion may collect:

- Name
- Phone
- Email
- Buyer/agent status
- Disclosure acknowledgements
- Optional financing-help request / consent

Buyer-facing language:

> Rel8tion is an open-house technology platform. Rel8tion is not a lender, mortgage broker, or loan approval provider. If you request financing help, your contact information may be shared with a licensed mortgage loan officer available to support this open house. You are not required to use any specific lender or loan officer and may choose any mortgage provider.

---

## Loan Officer-Facing Terms

Suggested LO-facing language:

> Rel8tion provides B2B open-house technology, verified profile placement, event availability tools, Event Pass access, communication routing, and reporting. Rel8tion does not sell referrals, guarantee borrower volume, guarantee loan applications, guarantee closings, collect mortgage applications, make credit decisions, or provide pre-approvals.

---

## QR Endpoint Rule

Do not print more QR codes until the Event Pass routing strategy is locked.

Physical QR codes must point to a stable resolver URL controlled by Rel8tion, not directly to a one-time event URL.

Preferred rule:

> The printed QR should resolve through a permanent public-code endpoint. The backend can then route that code to the currently active event, inactive setup page, or purchase/activation flow.

The QR should never be printed as a direct `/event?event=...` URL because event IDs change.

Best endpoint candidates to validate before printing:

1. Use the current smart-sign resolver pattern: `/s?code=<public_code>`
2. Add a future branded alias: `/pass?code=<public_code>` or `/ep/<public_code>`
3. Ensure the alias rewrites to the same resolver so printed codes remain future-proof

Final decision still needed before batch printing:

> Should Event Pass QR codes use the existing `/s?code=` resolver immediately, or should Rel8tion add a dedicated `/pass`/`/ep` alias first and print only that going forward?

Recommended next decision:

> Use `/pass?code=<public_code>` as the permanent Event Pass QR endpoint and make it reuse the existing smart-sign resolver behavior behind the scenes.

---

## Immediate Build Priorities

1. Lock the Event Pass QR endpoint.
2. Confirm whether the existing smart-sign resolver can safely support Event Pass inventory.
3. Add Event Pass product/status fields in the database.
4. Add end-of-open-house recap screen.
5. Add recap email send flow.
6. Add checkout CTA for agent kit activation.
7. Add LO sponsor/profile/availability association to events.
8. Add post-event SMS follow-up sequence.
9. Add fulfillment status for ordered kits.
10. Update source-of-truth docs after implementation.

---

## One-Sentence Business Model

> Loan officers sponsor the Event Pass. Agents experience the system live, receive their buyer info immediately, and upgrade to own the permanent Rel8tion Open House Kit and dashboard.

---

## Strategic Summary

The Event Pass is the distribution weapon.

The Open House Kit is the paid agent product.

The verified loan officer profile and availability placement is the B2B sponsor product.

The dashboard recap is the conversion moment.

The physical keychain keeps Rel8tion attached to the agent after the event and gives them a reason to call again before the next open house.
