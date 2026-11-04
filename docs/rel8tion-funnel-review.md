# REL8TION funnel foundations: Codex review

Branch: `feature/rel8tion-funnel-review-2026-11-04`

Base: `ad31361d5b1a22993def74736ab769151f04f392` on `jared-feder/Rel8tion.me`.

This branch contains two incomplete, deliberately non-sending foundations. Review the code and missing integration boundaries before planning a pilot. Do not merge, deploy, apply SQL, enable capture, enroll contacts or send messages as part of reviewing this branch.

## Agent nurture

- `lib/agent-nurture-preview.js`: pure preview planner; `send_allowed` is always false.
- `test/agent-nurture-preview.test.cjs`: 40 synthetic tests.
- `docs/agent-nurture-preview.md`: purpose-specific consent contract, proposed four-touch cycle and integration gaps.

Review person identity and shared phone/email handling; latest scoped consent and revocations; suppression completeness; replies/human takeover; sender health and pause controls; time zones/cadence; and uncertain or conflicting send outcomes. Input evidence must come from a trusted server adapter, never unchecked browser claims. No adapter, message generator, enrollment writer or dispatcher is included.

## Buyer relationship continuity

- `lib/buyer-continuity.js`: pure review policy; `outbound_allowed` and `representation_established` are always false.
- `test/buyer-continuity.test.cjs`: 25 policy tests.
- `sql/proposals/20261104_buyer_followup_intake.sql`: unapplied private source-receipt proposal, outside automated migrations, with capture OFF by default.
- `test/integration/buyer-continuity-postgres.cjs`: isolated PostgreSQL-engine fixtures, not a live database test.
- `docs/buyer-continuity-foundation.md`: ownership, consent, representation, entitlement, reliability and activation boundaries.

Review listing-agent attribution versus substitute host identity; scoped buyer consent; representation protections; membership entitlement; source/receipt matching; idempotency and irreversible suppression; and the fact that the proposed transactional trigger can roll back a check-in if intake fails. No AI conversation, inbound routing, enrollment store, scheduler or sender is included.

## Local checks

    npm run verify:agent-nurture
    npm run verify:buyer-continuity
    node --check lib/agent-nurture-preview.js
    node --check lib/buyer-continuity.js

The buyer guide documents the optional pinned PGlite package and local-only PostgreSQL test command. The test refuses to use a database URL and contains synthetic data only.

These focused tests do not constitute full application CI, target schema/RLS verification, live-provider testing, deployment or actual conversion validation.

## Deployment and CI boundaries

The root, `apps/rel8tion-app`, and `apps/mockup-renderer` Vercel configs contain `git.deploymentEnabled` set to false only for this exact branch. Other branches are untouched. The guard is present in the initial published commit so creating the branch should not start a preview deployment. Do not rename the branch or remove the guard to obtain a preview: existing previews can access production data.

The existing GitHub workflows run on pull requests, not ordinary branch pushes. No PR is created by this publication. `feature/*` follows the repository's eventual path into staging, not directly into main.

The existing lightweight secret scan matches literal database-role names. A local reproduction flags seven benign SQL role lines and eight synthetic PostgreSQL-fixture role lines. No credentials are present in those matches, and the scanner remains unchanged. Address this known false positive with a narrowly reviewed solution before a future PR is considered ready; do not hide role strings or weaken credential detection.

All live schemas, RLS, account permissions and delivery infrastructure still require authorized verification. The production branch and existing outreach/check-in behavior remain unchanged by this review branch.
