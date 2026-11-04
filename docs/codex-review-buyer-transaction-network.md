# Codex task — REL8TION Buyer AI, Agent Connect, Offers & Loan Officers
Repository: `jared-feder/Rel8tion.me`
Target existing source-review branch: `feature/rel8tion-funnel-review-2026-11-04`
Mode: **review and safe prototype only** — no production changes.

I am the owner of REL8TION. I want to **complete and expand what already exists**, not rewrite, replace, rename or break it. Physical-first Event Pass, Smart Signs, NFC/QR Rel8tionChips, HomeKey, live open-house activation/check-ins/disclosures, authenticated listing-agent attribution, loan-officer sponsor and coverage, existing borrower financing flows, current agent and LO dashboards, REL8TION COMMAND, current outreach/messaging safety, membership, Digital You / my.rel8tion.me Website Builder, domains and integrations must continue to work.

Read `AGENTS.md`, `CURRENT_STATE.md`, `REL8TION_SYSTEM_OVERVIEW.md`, `docs/rel8tion-funnel-review.md`, `docs/buyer-continuity-foundation.md`, `docs/plans/2026-11-04-physical-first-transaction-network-mvp.md`, `docs/nmb-loan-officer-support-plan-2026-05-05.md`, and the relevant implementation source/tests before proposing or changing anything. Identify existing canonical tables/routes/auth boundaries instead of assuming they are missing.

**The business workflow to prototype:**
1. Any buyer scans an existing physical Event Pass/Sign and may check in, whether represented or not. Existing check-in and disclosures are preserved. Ask if they have an agent; allow a simple verified agent lookup and show ambiguity explicitly.
2. An unrepresented buyer who separately consents may later receive Buyer AI help with the visited listing, needs, search, showings and listing-agent follow-up. A represented/unknown buyer cannot be enrolled in listing-agent acquisition.
3. If buyer has an agent, connect the **buyer-selected** verified agent without changing agency. For an agent already on REL8TION show a secure, property-specific buyer-agent / listing-agent relationship and a buyer-authorized agent-to-agent conversation. If not onboard, prepare a permissioned invitation with no buyer-sensitive details until agent verification; free/basic access must let an agent serve their client.
4. Buyer can enter a proposed USD amount and tap **“Ask my agent to prepare an offer.”** This is a request, not a signed or transmitted offer. Create a simulated request; show a simulated agent inbox/property workspace with discuss/draft/respond actions. Only an eventual brokerage-approved separate flow may transmit actual signed offers.
5. Preserve loan officers as first-class participants: existing LO assignments, event sponsorship and coverage remain intact. Buyer financing-help requests, LO selection and sharing require independent buyer consent, and should never replace an existing chosen LO or treat event sponsorship as permission to solicit.
6. Explore an **additive** professional Profile Builder for agent/LO (buyer private profile), reusing trusted identities while leaving the existing Website Builder, Digital You accounts/domains and public websites unchanged.
7. Buyers remain free. Consider optional low-priced agent workflow subscriptions only *after* free fulfillment of buyer-authorized requests is possible; do not alter live Stripe pricing or entitlements.

**Your task NOW:**
A. Review today's protected branch and enumerate all existing modules, missing adapters, inter-project Auth/Supabase concerns, data/agency/consent risks, and dependencies. Provide a clear “already built / missing / do not change” table. Highlight any mistaken assumptions in the plan.
B. Add a **standalone synthetic, clickable preview** under `docs/prototypes/` without network calls, live backend, secrets, providers or production data. Make the two buyer pathways, agent invite/connection, offer request, loan officer opt-in and profile idea understandable. It may be a single HTML file.
C. If feasible within this safe scope, build small **pure, side-effect-free policies and tests** for buyer-agent matching and buyer offer-intent state; keep fail-closed behavior and maintain `outbound_allowed=false` in existing policy. If this requires verified live schema, stop at proposal and identify the blocker instead of guessing.
D. Run focused existing tests: `npm run verify:buyer-continuity`, `npm run verify:agent-nurture`, `node --test test/event-sms-outcomes.test.cjs`, and new isolated tests; report exact pass/fail/not run. Review the root and two app Vercel deployment guards and ensure no preview deployment is triggered.
E. Deliver a concise Codex report with demo opening instructions, files changed, architecture/dependency map, security/compliance issues and the **next smallest nonproduction implementation step**, with readiness gates and clear separation of prototype from live function.

**HARD LIMITS:** DO NOT merge, create PR, deploy, remove/rename the guarded branch, enable Vercel Git deployment, apply/move the SQL proposal into migrations, touch real Supabase data, change production or staging databases, change existing checkout/pricing, adjust sender/crons/limits, auto-enroll buyer contacts, send SMS/email, change public website builder/Auth, submit actual offers, or expose personal data. Do not claim a completed offer or message delivery from a local simulation. No user interaction is needed until the review report is prepared.

If anything is uncertain, identify the exact repository file/project/table/permission to verify rather than manufacturing behavior. Preserve the current system before adding anything. Work only on the named protected branch.
