# Buyer continuity foundation

Status: review-branch implementation; no merge, migration application, activation or deployment.
Base: `jared-feder/Rel8tion.me` at `ad31361d5b1a22993def74736ab769151f04f392`.

## Existing product direction

Continue the mapped relationship engine, rather than add a generic drip campaign:

- `docs/rollout-and-pricing-plan-v1.md`, Phase 4: automated buyer follow-up and relationship reminders.
- `docs/go-forward-blueprint-v1.md`, Relationship Engine: preserve the buyer, agent and mortgage relationship after the visit.
- `docs/rel8tion-current-state-team-handoff-2026-05-27.md`: persistent leads and buyer follow-up backlog.
- July 2026 `REL8TION_Relationship_Infrastructure_Vision_v2.pdf`, pages 11-12: ask about the visited house, learn stated needs and objections, match relevant listings, and help schedule while preserving representation. The PDF explicitly labels the engine planned, not live.

The future success measure is buyer-side progress for the correct listing agent: a meaningful reply, learned preferences, consultation/showing requested and held, explicit representation choice, and ultimately a transaction. A check-in, AI message or delivery receipt is not conversion or buyer agency.

## What this patch does

1. `lib/buyer-continuity.js` assesses readiness for human agent review using a normalized internal evidence contract. It has no network/filesystem/database calls, credentials or model dependency. Every result has `outbound_allowed=false` and `representation_established=false`.
2. The SQL proposal creates a private source-receipt ledger, not a message queue. Capture defaults off. Its allowed states are only `pending_review` and `suppressed`; a database constraint forbids outbound enablement. Service access is read plus suppression only. Browser roles cannot access it. It records source IDs and time, not copied contacts, disclosures, consent text or message bodies.
3. Once explicitly approved, verified and enabled, a database trigger makes a new check-in and its receipt one transaction. Closing the browser after saving the check-in would no longer lose this receipt. This does not replace the existing confirmation, identity-sync or disclosure behavior.
4. Same-source repeats cannot duplicate the receipt. The policy also creates a stable canonical-buyer + listing-agent + purpose + channel review key across separate check-ins. That key is NOT an atomic enrollment lock; no enrollment store or sending state exists yet.

Nothing here creates an AI conversation, sends a text, reads production buyers, changes existing routes, auto-enrolls old leads or grants representation. The current production behavior is unchanged.

## Internal evidence contract

Call `assessBuyerContinuity(context, nowIso)` only behind a future authenticated, trusted server resolver. It is a validator, not an authenticator. Passing `verified=true` from an HTTP body is never acceptable. The current public check-in accepts metadata, and its update action replaces metadata, so metadata must never supply positive eligibility evidence.

All evidence objects require `verified: true`, a nonempty server evidence ID, and `checked_at` normalized by the resolver to UTC ISO milliseconds. Reads must be no older than five minutes and cannot be future dated. This freshness limit is for REVIEW ONLY; a later send must re-read all mutable policy state at send time.

- `checkin`: exact saved ID, event ID, creation time and visitor/representation fields. Only the buyer path with explicit false representation is considered, and any existing-agent hint vetoes. Client-controlled direct/unrepresented metadata does not grant eligibility.
- `intake`: fresh verified receipt matching the source check-in/event, live-capture origin, pending-review status and outbound disabled. A suppressed or absent receipt can never pass review, even if a different suppression lookup later says clear. Capture time must follow the source creation and not postdate verification.
- `buyer`: independently verified canonical buyer ID linked to this check-in, canonical E.164 phone, `identity_status: verified`. Do not merge people solely on matching phone/email; shared or recycled numbers require review.
- `ownership`: authoritative listing attribution for this exact event plus the selected follow-up agent. Both agent slugs must be the same canonical, lowercase listing-agent slug. The host may be a substitute and is not used as the default owner. Co-listing/agency ambiguity must be resolved explicitly upstream.
- `consent`: exact buyer ID, phone, listing-agent slug, SMS channel and `buyer_relationship_followup` purpose; opted-in status, consent text version/source/capture time, explicit null revocation, and explicit null or future expiry. Capture cannot postdate its verification. The existing global `sms_consent_records` schema does not contain this scope. Check-in completion, e-signatures, seller-agency disclosure and lending opt-ins are not substitutes.
- `representation`: fresh independent evidence that this buyer is unrepresented. Any unknown, represented or conflicting status blocks new acquisition. This policy never changes agency or tries to poach a represented buyer.
- `membership`: verified active recurring agent membership with assisted follow-up entitlement. Hardware ownership and event-only sponsorship are not membership. The future resolver must map the actual entitlement source; this object is not a new production schema claim.
- `suppression`: successful fresh lookup for the exact buyer/phone, explicitly clear. Unknowns, failures and STOP/opt-out all block. Future delivery must still use the centralized suppression/provider layer and recheck before every attempt.
- `controls`: exact agent, explicit global/agent unpaused values, explicit review enabled and `review_only` mode. Missing, manual, away or automatic modes do not grant this review path; no existing agent-outreach permission is borrowed for buyers.
- `continuity`: fresh lookup keyed to this canonical buyer, phone and review key, with explicit false values for shared/recycled identity conflict, other-agent relationship, existing enrollment and previous contact. New enrollment requires a future atomic reservation, not this boolean snapshot.
- `intake.intake_origin`: exactly `live_capture`; historical/unknown entries require separate review. The proposal performs no backfill.

Returned reason codes are diagnostic only and should not be treated as buyer-facing wording. The output contains IDs and agent ownership, not buyer contact details or generated copy.

## SQL and reliability boundaries

The proposal lives outside `supabase/migrations` deliberately. It must not run in an unattended migration push. It assumes UUID source IDs based on checked-in event-conversation SQL, but the target schema, trigger inventory and actual roles have not been verified.

Its SECURITY DEFINER function has an empty search path and schema-qualified access. Tables use RLS plus FORCE RLS, with no browser grants. Trigger ownership must have the intended narrow privilege and RLS behavior in the target. Only the database owner can enable capture; an application service cannot. Suppression cannot be reversed through status updates. There is no delete grant, outgoing message field or sendable status.

Atomicity has a tradeoff: intake insertion failure rolls back the check-in. Isolated tests demonstrate this explicitly. Before live application, test target roles, timeout/error behavior, monitoring, and disable/rollback procedure with a nonproduction database. Never mask a failed source save as success, blindly resubmit a saved check-in, or claim message delivery.

Deleting the source check-in/event cascades its receipt; the receipt does not create an independent retained copy of buyer information. Target privacy/retention requirements still require review.

The SQL uses explicit CREATE statements, not IF NOT EXISTS. A repeat application intentionally fails rather than silently accept an incompatible pre-existing table. Inspect any existing object before a reviewed upgrade. Application and activation are separate, unauthorized steps for this review task.

## Local verification

No application credentials or live contacts are used.

Run policy checks:

    npm run verify:buyer-continuity
    node --check lib/buyer-continuity.js

Optional isolated PostgreSQL-engine checks (dependency outside the repository):

    npm --cache /tmp/rel8tion-buyer-npm-cache install --prefix /tmp/rel8tion-buyer-sql-test --ignore-scripts --no-audit --no-fund @electric-sql/pglite@0.3.14
    PGLITE_MODULE=/tmp/rel8tion-buyer-sql-test/node_modules/@electric-sql/pglite node --test test/integration/buyer-continuity-postgres.cjs

The optional suite fails clearly when its local package path is absent; it never falls back to a database URL. It creates and removes only its own synthetic temporary database. It verifies capture defaults off, no historical backfill, role restrictions, transaction rollback, same-source deduplication, send-state rejection, one-way suppression and persistence across close/reopen.

These are focused local tests, not a full repository, Supabase integration, deployment or buyer-delivery pass. The source-reference snapshot is not a full checkout. Existing CI scans the literal database-role marker and would flag benign role declarations in the proposal and synthetic test. Do not obfuscate role names or weaken secret scanning; add a narrowly reviewed false-positive allowance before a future PR is considered ready.

## Remaining work before a real buyer AI pilot

1. Get authorized read access to the actual app Supabase project. Inspect live identity/relationship/consent/membership/suppression tables, RLS, event/check-in triggers, routing and existing data. The current connector access was denied; no alternate route was attempted.
2. Build an authenticated resolver and scoped consent capture/audit source. Protect metadata mutation and staff-chat boundaries before attaching a privileged AI. Reuse existing buyer tables; do not blindly rerun the historical buyer-affordability migration from another branch.
3. Verify listing-agent ownership, agency rules and explicit buyer intent. Keep represented visitors on a protected service/handoff path. Do not infer consent or buyer representation from the current active buyer-agent relationship record.
4. Test/apply only the reviewed target SQL in an approved nonproduction environment, then approve capture activation separately. Add operational alarms for intake/source-save failures and capture gaps.
5. Add atomic canonical buyer/owner/purpose/channel enrollment, conflict handling across shared phone identities, versioned consent revocation, cancellation and deduplication. Keep historical leads out of automatic enrollment.
6. Build provider-authenticated buyer inbound routing separate from agent outreach, conversational memory of voluntarily supplied needs, factual property matching, and agent-reviewed showing/consultation handoff. Treat listing/content/reply text as untrusted data, not system instructions.
7. Add durable retries/leases, quiet hours, caps, idempotent provider attempts, uncertain-outcome reconciliation, current suppression and pause rechecks, clear identity/transparency, and operator takeover. Do not reuse the generic event SMS category to evade outreach requirements.
8. Obtain authorization for a bounded pilot, recipient/consent rules, sending identity and spend limits. Only then connect delivery, test with approved recipients, and verify reply, handoff and conversion outcomes. Neither this code nor a passing local test authorizes contact.

AGENTS.md disposition: updated with durable review-only and unapplied-proposal guardrails. CURRENT_STATE.md and REL8TION_SYSTEM_OVERVIEW.md distinguish local foundations from live behavior.

## Proposed complementary pathway: represented buyer check-in and agent-to-agent handoff (owner direction, 2026-11-04)

This product requirement **complements** the unrepresented-buyer AI acquisition path above. It is a design proposal only; no implementation, outbound permission, representation grant, provider integration or deployment is authorized by this section.

**Core principle:** any visitor can check in to a property, including a buyer already working with an agent. REL8TION should *protect and strengthen* that existing buyer-agent relationship, not reject the visitor or try to acquire them for the listing agent.

### Buyer-facing experience

1. The buyer completes the normal open-house check-in and disclosures. A prominent question asks: **“Are you currently working with a real estate agent?”** with Yes, No, and Not sure options. Check-in is never denied simply because the buyer is represented.
2. **No / genuinely unrepresented:** keep the independent, purpose-specific opted-in Buyer AI acquisition/continuity path described above; no message is authorized merely because of check-in.
3. **Yes:** show a lightweight agent lookup, searchable by agent name, brokerage, city and optionally license number. Show enough verified public details for the buyer to confirm the correct professional; ambiguous, shared-name and unverified matches must be held, not auto-linked.
4. **Agent not found:** allow the buyer to provide an agent name and *optional* contact details, with clear separate permission to invite that professional. Do not require the existing agent to join REL8TION for the buyer's check-in to succeed.
5. Ask for informed, explicit permission before sharing the buyer's identity, visit or contact information with the chosen buyer's agent and/or notifying the listing agent of the claimed relationship. Sharing permissions and channel-specific invitations are distinct from generic marketing consent. Keep existing agency disclosures separate.

### Identity, relationship and invitation states

- Persist a buyer-stated agent selection as a **claim/pending verification**, not a verified representation agreement. An independently authenticated buyer agent can accept/confirm the relationship through an authorized flow; disagreement or conflicting existing relationships routes to human review. Never infer agency solely from a search match, check-in, SMS reply or self-reported metadata.
- Store the buyer-agent relationship separately from the event's authoritative listing-agent ownership. Preserve the host-vs-listing-agent distinction: a substitute host does not become the listing agent automatically.
- **Buyer agent already registered:** if the buyer opts to share, send an authenticated in-app notification and let the buyer's agent confirm/participate in the event; create or reveal an agent-to-agent thread only after permissions and identities are verified.
- **Buyer agent not registered:** with an appropriate invitation permission and lawful channel, send a narrowly scoped platform invitation identifying REL8TION and why it was sent, without sensitive buyer details in the unsolicited invitation. After verified registration, a buyer-approved connection can be claimed. Respect STOP, unsubscribes, send limits and quiet hours; an invitation is not transactional by default and is never automatic under this review branch.
- De-duplicate check-ins, invitations, connection requests and thread creation by canonical buyer, event, requested agent and purpose. Protect shared phone/email numbers, mistaken selections and recycled identities. Provide buyer/agent controls to revoke sharing, correct an incorrect match, and close the relationship/thread where legally and operationally appropriate.

### Listing agent ↔ buyer agent communication

After the buyer's authorized linkage and agent verification, provide a secure, auditable conversation between the **actual listing agent** and the **confirmed buyer's agent** for the specific property/event. The listing agent may review/send or explicitly approve an accurately attributed welcome template such as:

> “Your buyer checked in at [property] today. I'll take good care of them. Feel free to message me here with any questions, and reach out when you're ready to discuss or submit an offer.”

Do not impersonate the listing agent, claim personal care they did not authorize, or disclose the buyer's attendance without buyer-approved sharing. If buyer attendance is not authorized to share, show a generic event-level connection rather than buyer-specific details. Message history, handoff and read receipts are distinct from marketing automation. A future **“Submit an offer on REL8TION”** action is a proposed authenticated broker/agent workflow requiring separate document, delivery, audit, brokerage and local rule review; a chat message is not an offer submission.

### Buyer AI and routing boundaries

- **Represented:** never auto-enroll in listing-agent buyer-acquisition messaging. Optional AI may later act as a buyer-agent-authorized *service assistant* for property questions, appointment coordination and document handoff, but it cannot replace or silently bypass the chosen agent.
- **Unrepresented:** eligible only for the separate verified consent, representation and suppression gates in this document.
- **Unknown/conflicting:** allow check-in; pause buyer-acquisition outreach and disputed agent handoffs until resolved.
- Recheck buyer consent, verified agent identity, platform entitlement and live suppression before *every* message or invitation. Review-only policy results are never permission to send.

### Success criteria for a future gated pilot

Measure: represented visitors successfully checked in; accurately selected and verified buyer-agent links; invitation acceptance (without conflating it with consent); authenticated agent-to-agent threads; buyer-agent responses; showing/consultation handoffs; future compliant offers submitted/acknowledged; and genuine closed transactions. Do not count check-ins or notifications as buyer-side conversions. Pilot with synthetic accounts and isolated staging before any buyer data or real messaging is enabled.

## Proposed buyer-initiated offer-request pathway (owner direction, 2026-11-04)

**Goal:** turn buyer intent at an open house into a structured, trackable request to the buyer's selected agent. The buyer does **not** directly submit a binding purchase offer by tapping a price. A licensed/authorized agent and buyer must review and approve the actual offer and required forms before any transmission to the listing side.

### Buyer experience

1. After check-in or while viewing the event/property page, offer a prominent **“I love this home — ask my agent to make an offer”** action. Show the property address and agent identity clearly. Ask for a **proposed offer amount** in USD, optionally a short note and desired timing. Mark it **“Request to my agent — not an official offer.”** No pressure, inferred agreement or contractual commitment.
2. If the buyer is already linked to a verified buyer agent, show that agent and allow a review/confirmation step. If the agent is only self-reported, unverified, missing or contested, route to identity verification or a clear non-automated handoff without leaking buyer intent to the wrong party. Buyer can cancel a pending request; preserve an audit record.
3. On explicit buyer authorization, create an **offer_request** for the exact property/listing version and buyer-agent relationship, with amount, currency, timestamps, status, initiating identity, consent/sharing scope and deduplication key. Display submission and delivery status separately; never claim the agent saw it merely because it was queued.
4. If the buyer's agent is an active REL8TION user, send a secure in-app notification and a permitted channel notification without exposing sensitive deal terms in previews/lock screens. Deep-link to an authenticated agent-view property page showing the buyer's request, listing facts, offer requirements and next steps.
5. If the buyer's agent is **not yet on REL8TION**, offer the buyer an authorized invite/request-link to that agent: **“Your client wants your help submitting an offer on [property].”** Use an invitation compliant with consent, legal requirements and existing suppression controls; require agent identity verification before revealing buyer identity/amount. Do not imply that the recipient is obligated to register, subscribe or submit. Preserve an off-platform option to relay the request; the buyer should not lose access to their chosen agent because of a paywall.

### Verified agent experience and potential monetization

- Both free and paid **verified** buyer-agent accounts should be able to claim an authorized client request, view the exact property and proposed terms, communicate with their client, and respond. **A paid subscription must not gate a buyer's request or basic communication.** Premium plans can offer advanced drafting assistance, document workflows, CRM integration, AI reminders and analytics, if compliant and clearly disclosed.
- Agent view: **“Buyer requested offer at $X — Review request”** with actions **Discuss terms**, **Prepare offer**, **Decline/Not ready**, and **Request missing details**. Amount is a buyer preference/request, not an instruction to automatically write or send a contract. Explicitly show the identity of the listing agent and verified listing facts.
- Offer drafting may later collect the agent/brokerage-required terms (financing/preapproval, deposit, contingencies, closing date, inspection or other terms), flag missing items, and generate a draft using reviewed templates. Do not populate legal terms from unsupported assumptions; use brokerage-approved documents and workflows as applicable. Validate signatures, jurisdiction, agency disclosures, record retention, document access, electronic-delivery consent and brokerage oversight before a live launch.
- Only the appropriately authorized buyer-side agent, with the buyer's informed approval and valid signatures where required, may submit an **actual offer package** to the correct listing-side recipient via an approved channel. Require explicit confirmation, immutable versioned documents, submission audit trail, verifiable acceptance/receipt semantics and clear distinction between submitted, received, acknowledged, under negotiation and accepted. Do not automatically announce acceptance or bind either party.
- Once submitted, offer a permissioned, secure **agent-to-agent** workspace to clarify terms and manage updates. Track material changes with buyer approval and re-signing if required. Keep the buyer-facing status accurate without promising deal outcomes.

### Safeguards and measurement

- Protect represented buyers against diversion to the listing side; invitations and requests go to the **buyer-selected verified agent**, not auto-transferred to the listing agent. Listing agent receives buyer-specific terms only after the required authorized submission/sharing step.
- Never use an untrusted listing record, search match, agent claim or inbound message as evidence of identity or binding instructions. Handle duplicate taps, stale property status, amount changes, wrong agent selection, buyer cancellation, spam invitations, unauthorized access, notification failures and provider uncertainty.
- Measure **offer intent → verified agent engagement → draft prepared → buyer approved → official offer transmitted → acknowledged → eventual accepted/closed**, with separate funnel counts for existing REL8TION agents vs newly invited agents, including invitation-to-verified-signup and free-to-paid conversion. Neither an offer request nor an agent invite counts as a transaction.

**Implementation status:** proposed future capability only. No offer request table, buyer UI, invitations, agent deep-link, electronic-signature flow, document generator, brokerage approval, notification or submission integration is deployed as part of this branch. Add product UX/security/compliance review and isolated test coverage before requesting a pilot.

## Proposed buyer-free / agent-subscription monetization (owner direction, 2026-11-04)

Product hypothesis: Buyers always use core REL8TION property discovery, check-in, verified agent selection, buyer-to-agent offer requests and request-status tracking for free. Agent convenience and workflow automation—not access to a client's expressed interest—fund the SaaS subscription. A buyer's agent should see a *client-initiated invitation* with a strong reason to join: their buyer is interested in making an offer on a specific property. Sign-up conversion and any optional paid upgrade are separate steps.

**Proposed pricing for testing, not live catalog prices or a production entitlement change:**

| Persona/plan | Target monthly price | Core capability |
| --- | ---: | --- |
| Buyer | Free | Check in, choose/verify their agent, request an offer amount, communicate with their agent, receive request/status updates. |
| Agent Basic | Free | Claim/verify buyer relationship, access shared property and buyer-authorized request, respond and communicate, upload or relay an actual offer package through a lawful channel without a paywall, and view basic receipt status. |
| Agent Deal Desk | $19/month (hypothesis) | Unlimited structured offer workspaces, reusable term checklists, document management, guided drafting, request follow-ups, reminders, status monitoring and integrations subject to cost caps. |
| REL8TION Pro | $49/month (hypothesis / confirm against live pricing) | Deal Desk plus full Event Pass, eligible Buyer AI follow-up, lead/relationship tools and broader agent automation; avoid duplicate charges or contradictory entitlements. |

**Conversion design:** Buyer initiates a permissioned request → verified selected agent receives an invitation or notification → free agent can accept and service that buyer → contextual premium trial/upgrade appears *after* seeing the value of workflow organization and time savings. Avoid compulsory checkout mid-transaction. Free agents should not be prevented from delivering legally valid offers, reading buyer requests, correcting records, or communicating with the other agent. Do not impair represented buyers, discriminate against brokerages, claim an offer was delivered unless receipt is verified, or gate essential data export/retrieval behind an active subscription.

**Product positioning:** “From open-house check-in to offer preparation and agent-to-agent communication in one workflow.” Basic networking/offer exchange creates useful two-sided liquidity; paid automation saves time and reduces errors. Agent-paid features can include brokerage-specific templates, e-signature integrations, offer checklists, AI-assisted but human-approved drafting, follow-up summaries and analytics, all subject to authorization, broker supervision, regulations, licensing and real provider costs. Agent collaboration may need to be cross-brokerage and should never require an agent to switch brokerages.

**Market reference points (checked 2026-11-04, require revalidation):** Present My Offer lists a $10/month listing-agent plan and free buyer-agent submissions (https://presentmyoffer.com/pricing/); ShowingTime+ Appointment Center advertises $15/month agent subscription for showing/offer tools, subject to availability (https://showingtime.com/solutions/showings-and-offers/appointment-center); Final Offer advertises free buyer/agent entry and a $25/month Channels+ tier billed annually (https://www.finaloffer.com/pricing). These are different product scopes, not proof that REL8TION can achieve this price or margin.

**Validation before pricing commitment:** In an opt-in pilot, track invited-agent verification, percentage of requests serviced without subscription, first value achieved, paid trial activation, 30/90-day retention, total buyer intent → official offer conversion, and per-active-agent costs (AI inference, SMS, e-signature, document storage, compliance support). Test $9/$19/$29 entry-price willingness and whether $49 Pro upgrades outperform standalone Deal Desk, without paywalling essential transaction communication. Pricing should ultimately be set by observed adoption and contribution margin.

**Status:** documentation proposal only. No billing change, entitlement change, checkout, offer submission route, data migration, new notification, or production deployment has been made.

## Physical-first market entry and buyer-driven agent network effects (owner thesis, 2026-11-04)

**Positioning hypothesis:** REL8TION is not primarily an app that agents must remember to open. It starts as a **physical-to-digital relationship infrastructure at the open house**, using Event Pass, Smart Signs, NFC/QR and buyer check-in to create an immediate, permissioned connection. The app, agent workspace and buyer AI become the downstream operating layer. Say **“We start where real estate relationships start: at the property.”** Avoid unsupported claims of exclusive ownership of open houses, universal adoption or proprietary market control; the actual defensible advantage, if validated, is deployed physical distribution, habitual check-in, identity/agent attribution, and the resulting permissioned relationship network.

### What the founder reports / what remains to be demonstrated

- Founder reports strong positive reactions from a range of agents—from high-volume producers to infrequent producers—to the existing physical open-house experience. This is qualitative feedback, **not yet documented paid willingness, retention, causal conversion lift or market share**.
- Founder observes a present monetization gap: agents like the hardware/check-in but lack a demonstrated direct buyer-business result they would pay for. **Proposed value unlock:** buyer-intent capture, AI assistance for unrepresented buyers, and represented-buyer agent matching, bidirectional communication and offer-request handoff.
- Buyers remain free; verified agents can receive and act on their own clients' requests and communicate without a coercive paywall. A convenient, low-cost premium agent deal workspace can monetize workflow automation rather than buyer access.
- Physical distribution creates potential network effects: each participating listing agent hosts check-ins; a represented visitor selects their buyer agent; buyer-initiated offer intent prompts an authorized invitation if that agent is not on REL8TION; newly joined agents may in turn deploy Event Pass at their own open houses. **This is a growth mechanism to measure, not a guaranteed viral loop.**
- Agents with one transaction per year and top producers have different perceived value and affordability. Validate a clear entry plan, then paid automation/integrations for heavier users. Do not force paid enrollment mid-offer or block the buyer's chosen agent from receiving an authorized request.

### The physical-to-digital flywheel

1. **Place:** Event Pass/Sign is present at a real listing's open house, with verified host and listing attribution.
2. **Meet:** Buyer taps/scans and checks in, regardless of representation; preserve disclosures and consent boundaries.
3. **Connect:** The correct buyer agent is explicitly selected or verified, or the genuinely unrepresented buyer chooses permissioned follow-up.
4. **Intent:** Buyer requests information, a showing or a proposed offer amount; these are tracked as distinct funnel events, not binding commitments.
5. **Collaborate:** Verified agents receive permissioned buyer requests, coordinate with listing agents and prepare compliant formal offers.
6. **Earn:** Optional paid agent workspace saves measurable time and improves follow-through; no claims of generated business without tracked outcomes.
7. **Expand:** Invited buyer agents adopt REL8TION and may use the physical products at their next event, restarting the loop.

### Pilot scorecard and decision criteria

Track at event, agent and cohort level (with clear denominators): active physical assets → unique check-ins; share explicitly unrepresented vs represented/unknown; valid agent match rate; invited agents → verified signup; buyer requests → agent acknowledgment → drafted offer → authorized official offer delivered → acknowledged → accepted → closing; premium trial → paid activation → 30/90-day retention; incremental cost per activated agent; support/consent/identity misrouting incidents. Segment listing-side vs buy-side acquisition and compare by agent volume.

Baseline existing check-ins and conversion before enabling pilot. A properly authorized, limited live pilot is required to test whether physical distribution drives lower acquisition cost, higher paid conversion and measurable buyer-side transactions. Measure real agent-provided buyer opportunities and user outcomes rather than relying on positive feedback alone.

**Guardrails:** Never imply that physical check-in itself creates representation, follow-up consent, exclusivity, permission to notify a third party, an offer, or contract acceptance. Verify identities and ownership; prevent represented-buyer poaching; permit human/off-platform participation; comply with brokerage supervision, privacy, communications and offer-delivery requirements. This note changes no production system, subscription or messaging controls.
