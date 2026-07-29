# Universal Rel8tion Application Audit

Date: 2026-07-28

Branch: `feature/role-aware-dashboard`

Baseline: `origin/main` at `4db129ed5f2790394df9b2ace2057fdff5ec60c1`

## Current architecture

- The production application is a static HTML and browser ES-module application with Node.js Vercel serverless functions.
- There is no root frontend framework, bundler, lint command, type-check command, or application build command.
- `apps/rel8tion-app` is the active static application source for the public NFC, QR, Event Pass, Smart Sign, event, agent, loan-officer, and admin routes.
- Root HTML files are a mix of wrappers, legacy pages, and marketing/test artifacts. They are not consistently identical to the active application files.
- Root `vercel.json` is the production route and cron source of truth.

## Root behavior

- `/` currently serves `index.html`.
- The live page is titled `Rel8tion App Test` and identifies itself as a Vercel smoke test.
- It is unauthenticated, contains no application session behavior, and links directly to claim, sign, event, and activation flows.
- It is not suitable as the universal authenticated application gateway.

## Existing dashboards

- Agent operations: `/agent-home`, `/agent-dashboard`.
- Loan-officer operations: `/loan-officer-account`, `/loan-officer-dashboard`, `/field-dashboard?role=loan_officer`, `/lo-field-dashboard`.
- Open House Kit: `/kit-dashboard`.
- REL8TION OS API: `/api/rel8tionos/*`, protected by a dedicated API key.
- Internal platform administration: `/admin` and `/admin/agent-ranking`, with data APIs under `/api/admin/*`.
- The dashboards are independent static pages with duplicated layout, navigation, storage, and identity assumptions.

## Authentication and authorization

- Loan-officer accounts use Supabase Auth and bind the authenticated user id to `verified_profiles.uid`.
- Agent/device flows primarily use NFC identifiers, query parameters, and browser-local device sessions.
- Internal admin APIs require a server-side admin token or an allowlisted admin NFC UID.
- REL8TION OS APIs require a separate server-side API key.
- No shared repository model exists for users with multiple roles, organizations, organization memberships, teams, territories, subscription levels, permission grants, or workspace selection.
- Client query parameters such as `role=loan_officer` affect presentation in legacy pages and are not a universal authorization model.

## Database dependencies

- Browser and server code point to Supabase project `nicanqrfqlbnlmnoernb`.
- Checked-in migrations cover product-specific tables such as outreach, Smart Signs, Event Passes, coverage, conversations, consent, field visits, and agent relationship streams.
- The complete production schema and every live RLS policy are not reconstructable from the repository alone.
- There is no checked-in universal application RBAC schema.
- Vercel Preview currently receives the same Supabase URL and server-only credential targets as Production. Preview must therefore be treated as production-data-connected.

## Permanent public-route contracts

The following existing routes must remain compatible:

- `/k` and `/k.html`
- `/s`, `/s.html`, and `/sign`
- `/event`
- `/claim`
- `/a` and `/b`
- `/c/:code` and `/chip/:code`
- `/l/:id` and `/o/:id`
- Event Pass, Sponsored Event Pass, Smart Sign, Loan Officer Coverage Sign, disclosure, check-in, activation, onboarding, and invitation/follow-up links

Live baseline checks confirmed that `/event`, `/claim`, `/s.html`, `/a`, and `/b` resolve to their current safe missing-context states. A context-free `/k` redirects to the marketing site with `kerror=missing_uid`, which is current expected behavior.

## Deployment

- Vercel project: `rel8tion-me` (`prj_HZtvd8TJN0GKDSWE4srHYT5Yv86A`).
- Git source: `jared-feder/Rel8tion.me`.
- Production branch: `main`.
- Framework preset: none.
- Project root: repository root.
- Runtime: Node.js 24.x serverless functions.
- Production domains include `app.rel8tion.me`, `irel8.me`, `getrel8tion.com`, and `www.getrel8tion.com`.
- The inspected production deployment is READY at commit `4db129ed5f2790394df9b2ace2057fdff5ec60c1`.
- Non-production Git branches create Vercel Preview deployments. Preview deployments are protected and are not assigned the production custom domains.

## Local and remote differences

- The original checkout was on `codex/confirmed-lo-hotfix` at `55dd4c0b9dfe205cdff305398162b7d77f0ee460`, 27 commits behind and 6 commits ahead of the latest `origin/main` history.
- It contained nine tracked modifications, 709 untracked files, 38,908 ignored files, and no staged files.
- Those files remain untouched in the original checkout.
- This branch uses a linked worktree created directly from the fetched `origin/main`.

## Risks and missing pieces

- Preview code can reach production Supabase data.
- Legacy browser flows still perform some direct Supabase writes under current RLS policies.
- A browser-readable page exists at `/admin`; its APIs are protected, but the route itself is not server-gated.
- Existing product tables do not consistently expose organization ids or assignment scopes needed for universal organization isolation.
- No shared task, activity, permission, workspace, or audit-log model exists.
- Agent and buyer authentication/membership provisioning is incomplete.
- Production Auth redirect and invitation configuration must be verified before changing live onboarding.

## Recommended implementation

1. Preserve every public route and existing application file.
2. Replace only the application root behavior with a clean unauthenticated gateway and shared authenticated shell.
3. Add a server-managed Supabase session cookie flow with cache-disabled responses.
4. Resolve all roles, memberships, permissions, workspaces, and domain assignments on the server.
5. Add an additive, unapplied RBAC migration with RLS and audit tables.
6. Provide a strict legacy fallback only for an authenticated loan officer whose Auth user id matches `verified_profiles.uid`.
7. Treat users without a provisioned workspace as onboarding users with no domain-data access.
8. Add a server-gated `/admin` entry and permission-checked admin data API while preserving legacy COMMAND access separately.
9. Return real authorized counts when a server-verified assignment exists; otherwise return explicit empty/setup states rather than fabricated metrics.
10. Add route-map and authorization regression checks before any preview deployment.
