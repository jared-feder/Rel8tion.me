# Codex implementation prompt: REL8TION agent UX test batches

Jared requests implementation of the attached REL8TION agent experience review in small test batches he can view before release. This authorizes development and safe synthetic previews. It does not authorize production release, merging into main/staging, real messaging, live event mutation, billing changes, or database migration application.

## Read and reconcile first

- Read AGENTS.md, CURRENT_STATE.md, REL8TION_SYSTEM_OVERVIEW.md, docs/GIT_WORKFLOW.md, docs/ENVIRONMENTS.md, both active route maps, the pricing catalog, and this folder's review.html and evidence/source-manifest.json.
- The review used main on November 6, 2026; its blob hashes pin findings. Recheck each finding against the current implementation. Preserve already-fixed Event Pass sponsorship entry. Do not blindly implement stale recommendations.
- This documentation branch was created from staging at fea00ec42227a31e208ebaa13e6bc541268c1a0a. Inspect staging/main drift before implementation and retain unrelated assistant/outreach/buyer-AI work. Use isolated feature branches following the repo workflow; never change production branch or domain settings.
- Improve the real static application. Do not replace it with a generic mockup, new framework, alternate invented app or fabricated working features.

## Review cadence and preview boundary

Implement Batch 1 first, complete its focused checks, and provide a working, safe preview with before/after screenshots and a draft PR. Then STOP implementation at that review boundary and wait for Jared's feedback before starting Batch 2. Repeat for every batch. Approval of a test batch is not production-release approval.

Use a separate identifiable commit and draft PR per batch. Prefer independent branches from current staging when feasible; declare dependencies and use clearly based stacked branches only when required. Never merge, auto-merge, promote, or deploy production. Preserve each reviewed preview so Jared can compare it later. After approved changes eventually reach staging, production release still requires Jared's explicit release instruction.

Previews must use actual changed components/pages with synthetic/deidentified fixtures. Existing Vercel previews may reach production Supabase, so do not assume a Preview label makes writes safe. Use isolated test services or a loopback-only harness that intercepts all app data, auth, messaging, checkout and write calls and fails closed for unmatched requests. Keep fixture/auth bypass code out of production pages and APIs. Verify no live provider invocation or production write is possible before exercising mutations. Do not publish a synthetic auth bypass in a cloud preview. A protected server-backed preview must use isolated resources and real authorization.

Give Jared an accessible clickable preview, a route/state selector, fixture-state labels, exact commit SHA, restart command if local, and exported screenshots at desktop and 320/390px phone sizes. Include the actual changed workflow, not screenshots alone. If a deployable isolated preview cannot be made, provide the working local harness and screenshots, identify the access blocker, and do not claim a live preview exists.

## Batch 1: dashboard trust and recovery

Scope: apps/rel8tion-app/agent-dashboard.html and the smallest supporting modules needed.

1. Reproduce the single-snapshot issue. Add manual Refresh, last-successful-update time, explicit stale/offline/error state, and bounded refresh while visible. Avoid concurrent requests and discard stale responses. Keep last good data on failed refresh; never show defaults as current facts. Preserve active input, expanded details, focus and scroll; defer background rendering while editing. Stop timers on exit and avoid aggressive retries.
2. Improve missing-context/access failure recovery: Retry, contextual physical tap instructions, safe Home and existing support. Retain authorization; public QR is never private-dashboard access. Cover Event Pass and Smart Sign rather than hardcoding rear-sign guidance for everyone.
3. Reproduce and fix the no-loan-officer plus populated-check-in null dereference if still present. Separate explicit financing-help requests from lack of preapproval in labels/counts without changing consent or messaging behavior. Check that ordinary agents are not directed into admin-only management.

Acceptance: synthetic new check-ins appear without reopening; hidden tabs do not poll; failed reads preserve data and visibly mark staleness; stale responses cannot roll back newer data; editing survives refresh; no-LO, empty-event, expired-session and missing-context states work. Include executable focused behavioral tests and a no-network fixture browser demonstration.

## Batch 2: accessibility and consistent field visual controls

Scope: touched field screens in claim renderer/flow, activation and dashboard; shared CSS only where appropriate.

Replace clickable selection divs with semantic controls, add persistent input labels, visible focus, associated errors and appropriate focus placement after dynamic replacement. Preserve tap targets and selected state. Fix small-text contrast, including bright sky and green button fills; measure actual computed/gradient/composited colors. Keep navy/sky identity, Plus Jakarta Sans headings and Inter UI; use consistent primary/secondary/status roles. Honor reduced motion across animations. Do not rewrite disclosure wording or signature requirements.

Acceptance: keyboard-only and screen-reader selection flow; 200% zoom; 320/390px no overflow; ordinary text at least 4.5:1 and large text at least 3:1; consistent focus and status text. Screenshots must show actual changed pages and the same fixture states before/after.

## Batch 3: gateway, setup and sponsorship clarity

Shorten the gateway's technical pitch and put working sign-in/activation actions earlier on mobile. Do not imply unconnected Tasks, Messages or AI commands execute. Provide genuine access recovery only through the correct existing identity flow; if unavailable, clearly label support recovery rather than inventing it.

Remove duplicate brokerage instructions; add concise step progress; keep listing search reachable while location work is pending and guard against late geolocation results overwriting newer input. Preserve selected agent/pass/property across handoffs and canceled checkout. Defer optional profile/backup-keychain setup until after first success where safe. Compact the full-screen reuse choice with consistent cost/live-use/recap/history/sponsor-visibility rows and explicit unchecked sponsor consent. Prices come from catalog. Hardware remains separate from membership. Never imply retroactive permanent access to sponsored history.

Acceptance: location denied/timed out, blocked storage, listing search, unauthorized host recovery, first registration, reuse, assigned/unavailable sponsor, paid return and canceled checkout. Verify code/UID/agent/listing context and existing host/sponsor precedence with focused regression tests.

## Batch 4: task-first owner home and event closeout

Reorder owner home to live/next event, entitled visitor work, history, then profile/setup. Make identity compact, keep public business-card sharing clear, and move QR/hardware explanations into setup. Label unavailable follow-up automation as planned or remove its working-tool presentation. Reuse existing call/text links without claiming composer opening means a message was sent.

Compact live visitor cards; keep disclosure and requested-help status legible; put scenarios/details behind deliberate expansion and event-ending controls apart from visitor work. Closeout shows authoritative recap status and destination first, useful outcomes next, then next-open-house continuation. Keep member hardware secondary. If an action contacts an LO, label it as contact rather than booking. Preserve sponsored recap-before-close and retry idempotency.

Acceptance: member, sponsored-only and unpaid states; zero/many visitors; no LO; failed/missing-recipient/already-sent recap; no duplicate event or second subscription; reachable next-event sponsorship. Confirm all permanent-history and hardware entitlements remain server enforced.

## Batch 5: persistent member follow-up, separately reviewable

Only after the earlier batches are reviewed, implement a minimal real follow-up queue: saved next action, due date and completion, scoped to the canonical authorized agent and membership. Reuse a suitable existing task model if one exists; do not invent fake progress or expose another agent's records. Any migration must be separately reviewed, unapplied in production, and tested only against isolated storage. If isolated backend resources are unavailable, stop this batch at an explicit reviewable schema/API proposal and state that persistence is unimplemented. Do not quietly substitute local-only storage for permanent product records.

Notification preferences and Web Push are a later optional batch proposal. This UX task does not enable live notifications, autonomous replies, SMS drips or any existing outreach backlog. Coordinate with the separate assistant/send/push work rather than editing it. Do not change provider routing, suppression, quiet hours, rate limits, secrets, charges or live subscription state.

## Required delivery after each batch

- Batch number, exact scope, source baseline and commit; what changed and why.
- Working safe preview link or local access instructions, plus state selector and before/after screenshots as accessible attachments.
- Draft PR targeting staging (or explicitly documented preceding batch), focused passing test results, meaningful browser verification, unresolved issues and rollback instructions.
- State exactly which outcomes are simulated, source-inspected, tested or unverified; never label provider acceptance handset delivery.
- Update CURRENT_STATE.md for implemented behavior and REL8TION_SYSTEM_OVERVIEW.md when its source-of-truth contract changes. Update AGENTS.md only for durable rules, otherwise record 'AGENTS.md reviewed - no durable rule change'.
- End with 'Ready for Jared to review Batch N; not released.' Wait for his feedback before the next batch. Release remains a separate explicit approval.

Run the repository's checks matching each change, including route-map, Event Pass activation/security/reuse/mobile/membership and agent-LO-assignment checks as relevant. Keep private owner access, physical-first NFC/QR priorities, canonical person identity, buyer financing opt-in, required disclosure evidence and history entitlements intact. Do not use real customers, real events or live texts to validate these batches.
