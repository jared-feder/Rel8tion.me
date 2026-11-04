# REL8TION Physical-First Transaction Network — Incremental MVP Plan
Date: 2026-11-04
Status: DESIGN / SOURCE-REVIEW ONLY. NOT DEPLOYED.

## North star

Do **not** start over or replace today's REL8TION. Retain and extend Event Pass, Smart Signs, Rel8tionChips, HomeKey, open-house activation, check-ins, disclosures, dashboards, loan-officer sponsorship and assigned-LO precedence, AI/outreach infrastructure, COMMAND, Digital You/Website Builder, memberships and existing live routing. Physical NFC/QR is the entry point; permissioned real-world buyer intent, agent relationships and later formal offers are downstream. No claim of exclusive control of open houses.

The existing `feature/rel8tion-funnel-review-2026-11-04` branch is **non-deploying**. Keep its exact branch-specific guard in root and two app Vercel configs. Preview means code review and local **synthetic-data** prototype, NOT a production-connected Vercel environment.

## Existing foundation (inspect; do not rewrite)

- `AGENTS.md`, `CURRENT_STATE.md`, `REL8TION_SYSTEM_OVERVIEW.md`: source of guardrails/status.
- `docs/buyer-continuity-foundation.md`: original unrepresented-buyer policy, represented-buyer agent match, buyer offer request, loan officers, monetization, profile ideas and preservation requirements.
- `lib/buyer-continuity.js` and tests: review-only, always `outbound_allowed=false`.
- `sql/proposals/20261104_buyer_followup_intake.sql`: NOT applied; source receipt and capture OFF; not buyer representation/offer/messaging.
- `docs/agent-nurture-preview.md`: separate agent nurture flow; never conflate consent.
- `apps/rel8tion-app/event.html`, `apps/rel8tion-app/agent-dashboard.html`, `api/field-demo/buyer-requests.js`, `api/buyer-affordability.js`, `lib/event-pass-registration.js`: inspect current relevant code and routing before naming new endpoints.
- `apps/agent-website-builder`, `my.rel8tion.me`: preserve Digital You websites, accounts, Auth, custom domains, entitlement and content. Existing builder operates on project-specific Supabase settings and must not be merged with the main application's identities by phone or URL alone.
- `docs/nmb-loan-officer-support-plan-2026-05-05.md`, `api/admin/loan-officer-assignment.js`, and `api/loan-officer-account.js`: reuse existing verified-LO and event-coverage concepts. Do not reassign the financing officer automatically.
- `config/pricing-catalog.json`: current product entitlements are authoritative until a separately approved pricing launch; proposed $19/$49 options are hypotheses, not permission to alter checkout.

## Role journeys to preserve and extend

**Any buyer:** Can check in even when already represented; an unknown representation state does not block ordinary check-in. Show existing disclosures separately. Ask whether they have an agent; buyer selects verified public agent record or indicates agent not listed. A selection is a self-reported, **pending** connection, not a signed agency agreement. Give buyer explicit control over what identity/attendance/offer intent is shared with each participant. Keep buyer basic product free.

**Unrepresented buyer:** with independent proof of status and explicit purpose/channel consent, allow future opt-in Buyer AI continuity (needs, matching, showing requests) for correct listing agent; no automatic seller/listing-agent acquisition when existing representation is indicated or uncertain. The existing pure policy remains non-sending.

**Represented buyer:** lookup by person name + brokerage/location/license as needed, resolve conflicts without telephone-only matching. If their agent is already verified on REL8TION, offer an authenticated agent connection and optionally an agent-to-agent thread with the verified listing agent, subject to buyer-approved sharing. Otherwise offer an invitation to their **chosen** agent without exposing buyer identity/amount until verified. No pressure to switch agents and no mandatory paid plan to service an existing buyer.

**Buyer offer-intent:** On the event property page show “Ask my agent to prepare an offer” with a proposed USD amount and optional note. This is **not** an actual purchase offer. After explicit confirmation create a pending request for exact buyer/property/event/agent. Show buyer a clear pending/acknowledged/cancelled status. Offer request does not go to listing agent as binding terms or get sent automatically. Verified buyer agent sees a permissioned request in the property workspace, can discuss, prepare a draft and request approvals. True signed/authorized offer submission is a separate future feature with brokerage-reviewed templates, delivery receipts and secure records.

**Loan officer:** Keep separate verified LO identity, agent–LO link, per-event sponsor/coverage, selected financing help, preapproval and affordability workflow, and existing assignment precedence. Buyer can elect financing help, explicitly identify an existing LO, or decline. Share financing or personal details only with the authorized/selected LO under separate consent. No cross-selling based on check-in alone. No sponsorship, compensation or routing design should be assumed permissible without appropriate RESPA/NY review.

**Public/professional profile:** A possible later *Profile Builder* layer uses role-based, verified profile cards for buyer (private), real estate agent and LO. This is **additive** and may link to or upsell the existing Digital You Website Builder, not rename or replace it. Do not mutate builder Auth identities, profile URLs or hosted sites.

## Suggested data design (concepts only; verify live schemas first)

- `buyer_agent_claim` or relationship assertion: canonical buyer, agent candidate, source check-in, pending/verified/conflicted/revoked; never over-write existing authoritative relationships.
- `buyer_property_intent`: canonical buyer, exact event/property/listing snapshot, request amount in minor units, state, message audit and version, selected agent, buyer approval/sharing scope. **Not** a binding offer or signed contract.
- `agent_connection_request`: agent candidate, buyer-controlled invitation, verified acceptance, event/property scope, suppression and idempotency.
- `property_agent_conversation`: verified listing agent/buyer agent, purpose, event, authorization and access revocation; do not silently expose buyer attendance.
- `financing_support_request`: separate buyer opt-in, LO selection/assignment, specific purpose, revocation, and status; do not conflate with consent to marketing or agent texts.
- `professional_profile` proposal: role-appropriate presentation backed by existing identity authority, **not** a new duplicate login.
- Implement real schema only after actual project, RLS, triggers, auth, retention and current table inventory are verified; nothing in this proposal authorizes SQL execution.

## Pilot implementation order

**0. Audit and source-of-truth map:** identify exactly which app routes, Supabase projects, session/auth identities, RLS policies, saved relationships, check-in records, listing-agent attribution, loan-officer records and entitlements exist. Produce risk matrix and do-not-touch list. Confirm which target live project access is available; if not, mark blockers and work exclusively with synthetic fixtures.

**1. Safe clickable prototype:** add an isolated, self-contained demo (e.g. `docs/prototypes/buyer-transaction-network.html`), all fictional contacts/listings; no network calls, database, timers, SMS/email, auth tokens or production routes. Demonstrate represented/unrepresented check-in, verified/pending agent matching, consent, offer-amount request, buyer-agent work queue, optional LO request and existing Digital You handoff. Label every notification/offer as demo and never imply actual transmission.

**2. Pure policy + synthetic tests:** implement a side-effect-free module for role/identity/consent/representation eligibility and offer-intent state transitions, without replacing `lib/buyer-continuity.js`. Test represented check-in allowed, mismatch/wrong agent blocked, shared phone blocked, LO consent separate, duplicate buyer offer requests idempotent, cancellation, pending invite no sensitive details, and signed-offer never inferred.

**3. Authenticated server adapter and nonproduction schema:** with explicitly authorized staging Supabase project only, map canonical identities and check-in, create minimal audit/consent/intent records and RLS. No trigger that jeopardizes check-in availability without reliability assessment; preserve current routing. Produce migration as a *reviewed proposal* before any application.

**4. Human-in-loop pilot:** connect a small authorized cohort of buyers/listing agents/buyer agents/LOs, notification checks and operator-controlled handoffs, channel-specific consent/suppression recheck at attempt time, quiet hours, STOP and clear delivery-state semantics. All live messaging needs separate written owner approval and spend cap.

**5. Document/offer tools:** brokerage-approved draft templates, signatures, explicit submission, secure communication with listing side, audit, status/receipt reconciliation. Keep “request amount” and “actual offer” separate in UI and data.

**6. Commercial test:** buyers free; agents get basic request intake and response free so access to their own clients is not blocked. Test a low-cost paid workflow tier and the existing membership bundle without changing current catalog until approved. Track conversion, costs, compliance incidents, retention. Include loan-officer network value and possible paid LO offerings without pay-for-referral conflicts.

## Acceptance criteria for first Codex PR (code review only, no live activity)

- Existing flows untouched; branch-specific Vercel deployment disabled.
- A synthetic clickable preview and local tests show both represented and unrepresented routes, buyer intent, agent notification as **simulated**, loan-officer opt-in, and no cross-agent data leaks.
- All new policy outputs default deny communications/offer transmission. No automatic SMS/email/provider calls and no SQL applied.
- Explain new files and tests, identify risks, distinguish **implemented prototype** from **planned production**, and provide proof all existing targeted tests still pass (or exact unrun reason).
- No merge, PR, deployment, feature-flag activation, checkout modifications, production data access, bulk migration, buyer enrollment, or real notifications without separate explicit approval.
