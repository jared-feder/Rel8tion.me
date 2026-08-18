# CURRENT_STATE.md

Daily operational source of truth for REL8TION.

Last cleaned: 2026-06-04.

## 2026-08-18: Agent dashboard loan-officer assignment regression guard

- `[IMPLEMENTED]` The live agent event dashboard sends Add/Assign/Replace Loan Officer actions to the authenticated REL8TION COMMAND Open Houses workspace. It does not ask the loan officer to tap a keychain or create browser-local pending sign-in state; event coverage remains sourced only from the event's real `event_loan_officer_sessions` assignment.
- `[IMPLEMENTED]` A focused source regression test rejects the retired keychain handler, prompt, and local-storage marker and is part of GitHub's required repository checks so this legacy flow cannot silently return through a future pull request.

## 2026-08-18: Event Pass private-dashboard NFC boundary

- `[IMPLEMENTED]` `/k` now exchanges a currently claimed agent NFC UID for a signed, Secure, HttpOnly, SameSite=Strict session before opening `/agent-dashboard` or `/agent-home`. The session expires after 30 minutes and is revalidated against the current `keys` owner on every private request, so an agent slug, event id, copied dashboard URL, or browser-local declaration is not sufficient.
- `[IMPLEMENTED]` `/agent-dashboard` no longer reads buyer check-ins, event state, sign state, outreach context, or live loan-officer context through the public Supabase browser key. `/api/agent-event-dashboard` verifies the NFC session, the current claimed device, the event host, and the sign/event pairing before returning the event snapshot or performing closeout with the service role. Property-fit data now requires the same session.
- `[IMPLEMENTED]` Buyer check-in create/update now uses `/api/event-checkin`; the field loan-officer buyer-request view uses an assigned-account or host-NFC server route; paid-agent history uses the NFC-protected server snapshot. Migration `20260818143000_lock_event_pass_private_rows.sql` enables RLS and blocks anonymous Event Pass check-in reads/writes plus Event Pass event/sign mutations while preserving the still-legacy non-Event-Pass browser flows.
- `[IMPLEMENTED]` The first physical QA activation exposed PostgreSQL `42501` because `/sign-demo-activate` still attempted to create the Event Pass backing `smart_signs` row through the anonymous browser client after that RLS boundary was enabled. Fresh Event Pass activation now keeps the browser read-only and delegates exact QR/NFC backing-sign creation, collision recovery, inventory linking, and agent locking to `/api/event-pass/action` with the service role. Normal Smart Sign setup remains on its existing compatibility path.
- `[IMPLEMENTED]` Normal Event Pass activation success is now an agent-facing field instruction instead of a technical record screen: **Success — Your Open House Is Live**, a two-panel visual showing visitors scanning the QR to check in and the agent tapping the Event Pass for the dashboard, and one **Open Live Dashboard** action. Pass code, event id, setup explanation, buyer-route shortcut, and restart controls are removed from this Event Pass handoff. The live agent dashboard now keeps a **Get Support** email action in its header with agent, property, and event context prefilled for `jared@rel8tion.me` without exposing the NFC UID.
- `[IMPLEMENTED]` The buyer `/event` page now keeps a dominant **Start Check-In** action fixed inside the first mobile viewport until the visitor reaches the form. Tapping it jumps to a renamed **Begin Your Check-In** section and the **Buyer / With Agent / Agent** choice. Name, phone, email, and buyer-agent contact inputs use grouped native browser-autofill semantics; financing selections and disclosure acknowledgements are never stored in browser storage by this feature.
- `[VERIFIED]` Local Chrome at 320×568 placed the mobile action at `top=480`, `bottom=558`; tapping it scrolled the check-in section to `top=12` and hid the prompt. Commit `ecca160e` is live through Vercel production deployment `dpl_9qVbRL6Cu1bkn7DqR5Rwt5JpdnmQ`; the exact `main` SHA, READY/PROMOTED state, aliases, cache-busted live source, and full production route suite were verified. The live Event Pass QR route displayed **Start Check-In** inside the first mobile viewport (`top=543`, `bottom=621`, `innerHeight=631`), then landed **Begin Your Check-In** at `top=84` with the path chooser at `top=271` and the prompt hidden. Live visitor autofill tokens were correct. The nine-case mobile suite, seven-case Event Pass security suite, app, route, syntax, and diff checks pass. No check-in was submitted; the bounded log scan found only existing Node deprecation warnings on intentional route-check responses and no check-in runtime failure.
- `[IMPLEMENTED]` The mobile prompt now remains visible until the first actual contact field reaches the usable viewport or the visitor taps the prompt. The earlier heading-based threshold could hide **Start Check-In** on a tall phone while only the path/heading was visible and the form fields remained below the fold. The event itself does not need to be closed or restarted for this display correction.
- `[VERIFIED]` At the reported 430×932 local layout, the corrected prompt remained fixed at `top=844`, `bottom=922` while the first name field was below the fold at `top=1154`; tapping it hid the prompt and brought **Begin Your Check-In** to `top=148`. Commit `ff99e2a5` is live through Vercel production deployment `dpl_4wepe5mS35EFxNB9jENkpfkm22N7`, built from the exact `main` SHA and serving the new cache-busted module on `app.rel8tion.me`. The live 433×937 Event Pass QR route kept the button visible at `top=850`, `bottom=928` while the first field remained at `top=1155`; tapping it hid the prompt and placed the heading at `top=84`. The full production route suite passed. No check-in was submitted, and the bounded log scan found only existing Node deprecation warnings with no check-in runtime error.
- `[VERIFIED]` Headless Chrome at 320×568 rendered the complete Event Pass success instruction and single dashboard action within the viewport (`buttonBottom=513`, `scrollHeight=568`) with both guide panels and the Event Pass image loaded and no error overlay. The mocked live dashboard exposed **Get Support** at the top (`buttonBottom=181`) with the correct contextual email and no UID. The seven-case activation, seven-case mobile, seven-case security, app, and route-map checks pass. Commit `7672ad4a` is live through Vercel production deployment `dpl_E8YrCsBnbHSC7waAXA3BEWH6L3vY`; the exact `main` SHA, READY/PROMOTED state, live source markers, 320×568 production rendering, and full production route suite were verified. The release log scan found only the existing Node deprecation warnings on intentional route-check responses and no Event Pass runtime failure.
- `[VERIFIED]` The seven-case Event Pass security suite, existing Event Pass activation and paid-membership suites, mobile viewport suite, app verification, and route-map verification pass. Application commit `1a0daac5` is live through Vercel production deployment `dpl_52sxMMBTBz5WXGjkjFCrX8dGiHfU`; its exact `main` SHA and READY state were confirmed, the full production route suite passed, and the new-route error scan found no functional runtime failures. Migration `20260818143000_lock_event_pass_private_rows.sql` is applied in production: an Event Pass fixture retained five service-visible check-ins while anonymous access returned zero, a legacy non-Event-Pass fixture retained its two anonymous-visible check-ins, and anonymous Event Pass event/sign update probes affected zero rows.
- `[VERIFIED]` The first-activation regression now covers a fresh pass with no backing sign and proves that only the protected server module creates it. The seven-case activation suite, seven-case private-dashboard security suite, six-case mobile viewport suite, nine-case paid-membership suite, app verification, and route-map verification pass. Repair commit `504476a1` is live through Vercel production deployment `dpl_BkrAFn4ibCMsw1LWLoNT5azfcLn1`; the exact `main` SHA, READY/PROMOTED state, live activation source, guarded API response, and full production route suite were verified. The bounded post-release error scan found only existing Node deprecation warnings and no functional activation failure. The physical retry remains pending.
- `[RISK]` The NFC session is server-validated, but the legacy universal router and activation system still depend on public reads that expose raw NFC UID values in `keys` and sign inventory. This release prevents a copied agent/event URL or browser-local declaration from opening the private Event Pass dashboard and removes public Event Pass PII/state access; it does not yet make the UID itself a secret possession factor. Moving all UID resolution behind server routes and then revoking public UID reads is the next authentication hardening step.
- `[NEEDS VERIFICATION]` The physical QA tap successfully claimed the disposable Event Pass keychain and reached listing confirmation, then stopped before sign/event creation on the now-fixed `42501` path. Retry after deployment plus closeout of that disposable test event remain manual field checks; no real open house was ended for release verification.

## 2026-08-17: Paying-agent Event Pass becomes a reusable Rel8tionChip

- `[IMPLEMENTED]` A claimed Event Pass now has two NFC states. While its open-house event is active, `/k` opens that event dashboard. After the event ends, the same NFC opens `/agent-home` as the agent's Rel8tionChip and digital-business-card owner surface instead of reopening historical event results or immediately forcing another activation.
- `[IMPLEMENTED]` The idle owner surface exposes **Start Open House** using the same matched Event Pass QR/NFC pair. Activation still requires a verified `open_houses` row. The confirmation now makes the relationship explicit: the operator is either the listing agent or a same-company/same-brokerage substitute for the absent listing agent. Existing server authorization continues to reject unrelated-company agents and manual/unverified listings.
- `[IMPLEMENTED]` Reusable Rel8tionChip access is gated by an active `pricing_entitlements` REL8TION Agent record containing both `agent_dashboard` and `digital_card`. An unpaid Event Pass owner sees the catalog-controlled membership checkout handoff and public digital card, not private event history. No Open House Kit or separate Rel8tionChip purchase is required.
- `[IMPLEMENTED]` Event Pass membership checkout binds `agent_slug` and NFC UID to the Stripe Checkout metadata after server validation. The signed webhook and the server-side Checkout return both idempotently provision the entitlement; subscription updates, deletion, paid invoices, and failed invoices update ongoing access state. Event Pass reuse does not add a first-claim SMS challenge; its owner surface relies on the tapped claimed NFC plus the existing local phone screen-lock/passkey step.
- `[VERIFIED]` Local syntax checks, route-map verification, pricing verification, Event Pass authorization/reuse tests, the new nine-case Rel8tionChip membership suite, and the mobile viewport suite pass. Application commit `35ef43ec` is live through final Vercel production deployment `dpl_3R7kikS8aXycpCDxS4ed6nsnGcVU`, rebuilt after the webhook-secret rotation. The live owner, activation, router, membership API, webhook signature guard, and full production route suite were verified on `app.rel8tion.me`; the release-window log scan found no 5xx responses. A real Stripe checkout, signed webhook delivery, and a physical Event Pass tap remain `[NEEDS VERIFICATION]`.

## 2026-08-16: Event Pass mobile activation viewport

- `[IMPLEMENTED]` Event Pass activation screens now put the next required action before instructional imagery, metadata, optional listing details, and success details. Short-phone layouts compact the shell, listing cards, form spacing, and agent confirmation cards while retaining 50px-or-larger primary tap targets.
- `[IMPLEMENTED]` Sponsored Event Pass activation keeps the consent checkbox and final Activate button together in a mobile action dock, so both controls remain visible without scrolling. Optional property, email, brokerage, photo, and bio fields are collapsed below the required path.
- `[VERIFIED]` Focused source regressions, the existing Event Pass activation suite, module syntax checks, and the route-map guard passed locally. Browser measurements confirmed every tested primary action inside the viewport at 320x568, 360x640, 390x844, and 430x932, including the sponsored-pass consent/action dock at 320x568.
- `[VERIFIED]` Production release `204a1660` is live through Vercel deployment `dpl_4BiQeKXQwvC7fXwTxBqLX5BYJDCE` on `app.rel8tion.me`. Clean-route and browser checks confirmed the updated `/pass` resolver, claim module cache chain, sponsored consent/action dock source, and a fully visible location action at 320x568. The production route suite passed; browser inspection found no application errors (only the existing Tailwind CDN warning).

## 2026-08-16: Open-house inventory link-collision repair

- `[IMPLEMENTED]` The protected listing-inventory cron now resolves every discovered OneKey URL against all canonical `open_houses` rows, including historical events, before promotion. When another row already owns the URL, the sync preserves that canonical row ID and source instead of violating `open_houses.unique_link`; duplicate discoveries sharing one URL in the same run also collapse to one upsert.
- `[IMPLEMENTED]` Fractional OneKey living-area values retain their precision in `agent_listing_inventory` but are rounded only for the integer-backed canonical `open_houses.sqft` field.
- `[VERIFIED]` Focused regression coverage passes for historical-link ownership, same-run duplicate links, canonical row/source preservation, and fractional square-foot normalization.
- `[VERIFIED]` Production release `2701cd1a` is live through Vercel deployment `dpl_3TLNVoYUUQ65hRQ5Dx4rUFsBsxLX`. A manual production cron run completed with HTTP 200 in 12.3 seconds: 500 profiles scanned, 426 matched, 2,969 listings examined, 65 open houses written, 18 agents attached, 3 events inserted, and the rotation cursor advanced to 432. The prior PostgreSQL `23505` link collision did not recur, and the bounded post-run error scan found no runtime errors.

## 2026-08-16: Signed NY disclosure form repair

- `[IMPLEMENTED]` `api/compliance/ny-disclosure.js` now writes the captured electronic signature, signing date, host-agent name, brokerage, and seller-representation selections onto the signature pages of both official New York disclosure forms. The REL8TION cover and courtesy pages remain part of the same six-page packet.
- `[IMPLEMENTED]` The packet generator now downloads the current official Department of State forms with an explicit PDF request identity, retries transient failures, and rejects HTML or other non-PDF responses instead of storing an incomplete packet.
- `[IMPLEMENTED]` Corrected packets use version `2026-08-13-official-forms-v2` and a versioned storage filename. When a legacy packet is regenerated, its original object and descriptor are retained in `signed_pdf_history`; the corrected packet records what it supersedes rather than overwriting the historical PDF.
- `[VERIFIED]` Seven focused regression tests pass for form decoration, source-request headers, invalid-source rejection, version selection, immutable packet history, date handling, and legacy check-in recovery. Both current Department of State signature pages were rendered before release and showed the typed signature and related fields aligned and legible.
- `[VERIFIED]` Production release `8f3c25ba` is live through Vercel deployment `dpl_HPdyb3uUE1rLaVekD2byqgGVGjbr` on `app.rel8tion.me`. One previously affected v1 packet was regenerated through the live route and visually verified on both official signature pages. Supabase retained the original and corrected PDFs as two distinct objects, recorded one v1 history entry, and linked the v2 supersession metadata correctly. Production route verification passed; the bounded log scan found no functional HTTP/runtime errors, only the existing Node `DEP0169` deprecation warning.

## 2026-08-12: Open-house agent identity recovery

- `[IMPLEMENTED]` HomeKey and COMMAND agent-performance assembly no longer treat generic values such as `Listing Agent`, `Agent`, or `Unknown` as a real person. Open-house identity now resolves through exact listing ID plus matching phone/email across `listing_agents`, `agent_outreach_queue`, `agent_listing_inventory`, and canonical `agents` records while preserving the durable HomeKey attribution row. URL-opened production profiles also replace the temporary `Loading agent profile` stub with the loaded ranking name before rendering the profile or marketing report.
- `[IMPLEMENTED]` The OneKey freshness worker now fills `open_houses.agent` when the current OneKey record provides a name and preserves an existing real name when the refreshed source omits it.
- `[VERIFIED]` Production migration `20260812143000` repaired 3,085 previously blank/placeholder `open_houses.agent` values only where all exact queue and inventory sources agreed on one real name. Conflicting or unresolved rows were skipped. The reported 165 Meister Blvd row now resolves to Ruth Chalco from its exact open-house queue/inventory identity.
- `[VERIFIED]` Production release `9b1d25e5` is live through Vercel deployment `dpl_EnZq4cKhJDHvLEBVCa5UXHCCh48G` on `app.rel8tion.me`. The reported HomeKey returns HTTP 200, renders Ruth Chalco with Compass Greater NY LLC, and no longer renders the generic `Listing agent` heading. The production route suite passed; the bounded deployment log scan found no HTTP 5xx failures (only existing Node `DEP0169` deprecation warnings).

## 2026-08-10: Outreach opt-out threshold and reply footer

- `[IMPLEMENTED]` The owner-approved rolling seven-day opt-out health threshold is 5%. The COMMAND control API and `send-agent-outreach` use 5% as the code fallback, and production stores the same value in `rel8tion_runtime_settings.key='outreach_guardrails'` without changing the pause, release window, or volume ceilings.
- `[IMPLEMENTED]` `send-agent-manual-reply` marks operator-composed SMS/MMS replies to omit the repeated `Reply STOP to opt out.` footer. Initial outreach still retains its Y/N/STOP disclosure, and the shared provider layer still fails closed on suppression lookup, blocks opted-out recipients, and honors inbound STOP-family keywords.
- `[VERIFIED]` The pre-change provider-health review found 130 logged outreach sends and 11 opt-outs in the prior seven days (8.46%), with zero outreach provider failures in the prior 24 hours. A 5% threshold therefore remains health-blocking at the current rolling rate; this change does not authorize a health override or send a batch.
- `[IMPLEMENTED]` Automatic initial outreach is limited to future open houses inside a rolling seven-day horizon and remains ordered by `open_start ASC`, then due send time. COMMAND exposes the horizon as an editable 1-21 day guardrail; increasing it is treated as a less-restrictive change that requires typed confirmation.
- `[VERIFIED]` The pre-change queue review found 65 otherwise eligible rows inside the next seven days and 5 rows 8-21 days away. The sender already prioritized the soonest date/time, but the new upper bound prevents farther events from filling a thin near-term batch.
- `[IMPLEMENTED]` Generic automatic follow-up/drip sending remains disabled. An inbound Y/N can receive the existing immediate confirmation, and operators can send a direct manual reply; no unattended second-touch sequence is enabled by the weekly priority change.

## 2026-08-08: Event Pass reuse correction

- `[IMPLEMENTED]` Normal Event Passes no longer have a one-time-use activation gate. An inactive pass can create or join a new open-house event even when preserved historical events exist; only a currently active event on another open house blocks reassignment.
- `[IMPLEMENTED]` `/k` now evaluates whether an Event Pass is currently active instead of treating any historical event as proof that the pass was already used. Legacy `pass_model=single_event`, `reuse_allowed=false`, and `reuse_status=not_reusable` values remain storage-era metadata and do not control normal Event Pass activation.
- `[IMPLEMENTED]` Focused regression coverage protects both activation paths and the NFC router from restoring the retired one-time-use rule. Production deployment and a physical scan/tap retry remain `[NEEDS VERIFICATION]`.

## 2026-08-08: Event Pass duplicate-key recovery

- `[IMPLEMENTED]` Event Pass activation now recovers an existing backing `smart_signs` row when an inventory reset or interrupted activation left `smart_sign_inventory.smart_sign_id` blank. Recovery requires the printed Event Pass public code and its NFC UID to match the same backing row, then relinks the inventory instead of attempting a duplicate insert that returns PostgreSQL `23505`.
- `[IMPLEMENTED]` Crossed QR/NFC pairs now stop with a plain-language mismatch message. A concurrent duplicate insert is re-read and reused only after the same code/UID validation. Focused regression coverage parses the activation page and verifies matching, mismatch, and duplicate-race contracts.
- `[IMPLEMENTED]` Explicit COMMAND scanner Freshen may safely replace an older stale backing-sign UID with the currently tapped physical Event Pass UID only when Freshen audit metadata exists, inventory is unlinked/unclaimed, the old sign is inactive and unowned with no active event, and the tapped UID belongs to no other sign. This preserves historical event rows while restoring the same physical pass after Freshen.
- `[VERIFIED]` Repair commit `ec3981df` is live on `app.rel8tion.me` through production deployment `dpl_4QPFVAfL4Y7ZmLVgfnmY1FnzREJE`. The canonical activation wrapper redirects to the app file, and the live app file contains the matching QR/NFC recovery and `23505` race handling. Focused tests, production route verification, and the post-deploy Vercel error scan passed.
- `[NEEDS VERIFICATION]` Rescan and tap the affected physical Event Pass to verify its exact QR/NFC pair relinks successfully; no production pass row was reset, deleted, or changed during diagnosis.

## 2026-08-08: HomeKey / Property Keepsake QR

- `[IMPLEMENTED]` REL8TION COMMAND open-house, accepted-visit, and confirmed-report rows expose **Create HomeKey QR**. The admin-authenticated generator returns the property, durable listing-agent and loan-officer attribution, a permanent `/h/:public_code` URL, QR preview, Copy Link, Preview Page, and a 1600 px high-error-correction PNG download. A unique attribution key makes repeat generation for the same assignment duplicate-safe.
- `[IMPLEMENTED]` HomeKey is separate from Event Pass, Smart Sign, Rel8tionChip, NFC, activation, and check-in inventory. Property facts remain in `open_houses` and `open_house_property_profiles`; `property_keepsakes` stores only the durable code and source/attribution IDs.
- `[IMPLEMENTED]` The public page asks for identity only after the buyer chooses Save, agent relationship, similar homes, off-market opportunities, price alert, different area, or financing help and explicitly consents. Matching phone or email submissions update one existing `leads` row instead of creating duplicates. The feature sends no SMS, email, alert, or campaign automatically.
- `[VERIFIED]` Production migration `20260808085230` is applied and recorded. Both new tables have RLS enabled, no anon/authenticated grants, least-privilege service-role access, and indexed foreign keys. Focused local generation, rendering, lead, analytics, route, syntax, and COMMAND regression tests pass against a real linked-property fixture.
- `[VERIFIED]` Production release `28c0c418` is live through Vercel deployment `dpl_5yFvmFShWa1zaEABQ1xfUw2Wb8Bd` on `app.rel8tion.me`. The first real HomeKey for 238 Laclede Ave created code `OMmWbe-VlyZzFGR1` with Katia Santesteban and Jared Feder attribution; repeating the COMMAND action reused the same code and production contains exactly one matching row. A live Chrome pass verified the public property/contact page, action-gated consent form, and zero fresh console errors. No test buyer lead was submitted, and the final deployment produced no HTTP 5xx responses.

## 2026-08-06: non-sending general agent prospect lane

- `[IMPLEMENTED]` Agent Ranking / Agent Performance now separates general REL8TION prospects from open-house outreach. **Create REL8TION Prospect** checks canonical `agents`, `agent_websites`, and `agent_relationships`; it identifies and links an existing member or relationship before creating a new durable `agent_relationships` prospect.
- `[IMPLEMENTED]` A new general prospect stores reusable invitation drafts and `invitation_lane=general_agent_invitation` in relationship metadata. It explicitly records `automatic_sending=false` and `outreach_queue_created=false`, writes a relationship event, and does not insert into `agent_outreach_queue` or send a message. The profile shows whether the agent is already on REL8TION before the operator acts.
- `[VERIFIED]` The prior button failure was caused by attempting to insert a non-open-house agent into `agent_outreach_queue`, whose production `open_house_id` column is required and linked to `open_houses`. Local regression coverage verifies new, existing-member, and existing-prospect paths are duplicate-safe and never call the outreach queue.
- `[VERIFIED]` Production release `af6ff628` is live through Vercel deployment `dpl_35vPjdxBnv5zY6QVavmLfFQdq9Yo`. The served Agent Ranking artifact contains the dedicated prospect action and explicit no-queue/no-send copy, the protected API rejects unauthenticated writes, and the production route suite passes.
- `[VERIFIED]` Christina Sanchez resolves as an existing canonical claimed agent by exact phone. Agent Ranking shows **Already on REL8TION** instead of creating a duplicate, while COMMAND's full database search now finds her and opens the focused Agent Performance profile with her listing and upcoming open house.
- `[VERIFIED]` Production outreach stayed paused through deployment and live verification. No `agent_outreach_queue` row recorded an initial send, follow-up send, or outreach timestamp after the pause began; the pause remains enabled until the owner explicitly resumes it.

## 2026-08-06: source-agnostic outreach queue staging

- `[IMPLEMENTED]` The protected 15-minute `/api/cron/generate-agent-outreach` route now runs the existing `queue_recent_outreach_candidates()` RPC before invoking the outreach-copy generator. Newly enriched eligible open houses therefore enter `agent_outreach_queue` regardless of whether Estately, Trulia, or another source supplied the completed agent fields.
- `[IMPLEMENTED]` Queue staging remains server-only behind `CRON_SECRET` and the Supabase service role. The live RPC preserves its existing eligibility checks and idempotent `(open_house_id, agent_phone)` upsert, while the generation route fails visibly instead of silently skipping staging when the RPC fails.
- `[VERIFIED]` The linked production project is `nicanqrfqlbnlmnoernb`; read-only catalog inspection verified `queue_recent_outreach_candidates()` and `queue_outreach_candidate(text)`, their `void` signatures, service-role execution, eligibility filter, and duplicate-safe upsert. The targeted cron regression test and route verification pass locally.
- `[NEEDS VERIFICATION]` This repair is not live until the app/API change is deployed and the next protected generation run is observed. Deployment can create fresh automatic outreach rows that later sender crons may deliver under the existing health, suppression, quiet-hour, and rate-limit controls; do not deploy casually.

## 2026-08-05: COMMAND exact-agent profile hydration

- `[IMPLEMENTED]` Agent links no longer depend only on the capped initial Agent Performance slices. Opening an agent now calls the admin-authenticated `/api/admin/agent-profile` endpoint, resolves the exact saved phone, email, name, slug, or ID across the relevant agent, ranking, outreach, inbox, listing, visit, lead, keychain, open-house, and event sources, and merges the focused profile into COMMAND without increasing the global dashboard limits.
- `[IMPLEMENTED]` Missing focused profiles show a loading state while the exact lookup runs instead of incorrectly reporting zero matches. Direct focused URLs and browser Back/Forward use the same hydration path, and a failed or genuinely unmatched identity remains visible as an explicit error.
- `[VERIFIED]` The regression fixture reproducing Marsha Welikson outside the 1,000-row outreach and 3,000-row ranking/listing slices passes, along with the existing Agent Performance, photo, COMMAND performance, route, and architecture checks. All production columns used by the focused lookup were verified read-only against the linked Supabase schema.
- `[VERIFIED]` Production release `ed09af9c` is live through promoted Vercel deployment `dpl_4jXkdbt3YkuHWkTNSurLM1t86wDr`. The build contains the new `api/admin/agent-profile` function, `app.rel8tion.me/command` serves the hydration/merge/loading code with HTTP 200, the endpoint rejects unauthenticated reads with HTTP 401, the complete production route suite passed, and deployment events contain no build error.
- `[NEEDS VERIFICATION]` Marsha Welikson's final click-through still needs one check inside an operator-unlocked COMMAND session. The protected historical beta UID is not authorized in current production, so verification stopped at the correct 401 boundary without reading browser credentials or changing any agent data.

## 2026-08-05: COMMAND manual agent headshots

- `[IMPLEMENTED]` Agent Performance cards with no resolved portrait now show a small plus control on the avatar placeholder. The admin can choose a JPG, PNG, or WebP file; COMMAND center-crops it to the established 4:5, 1200x1500 headshot contract before upload.
- `[IMPLEMENTED]` `/api/admin/agent-photo` requires the same server-verified COMMAND credential as other privileged admin actions, validates the image bytes and agent identity, stores the photo in the public `agent-images` bucket, and records the upload as a manually verified primary `agent_photos` row.
- `[IMPLEMENTED]` A saved manual headshot is propagated by verified agent identity to canonical `agents`, outreach history, listing-agent records, agent websites, relationship records, and linked rankings so COMMAND, Agent Ranking, public profiles/sites, event agent selection, reports, and Rel8tionOS resolve the same portrait. Exact IDs, slugs, email, or compatible phone/name identity win; name-only matching requires the same brokerage to avoid crossing agents who share an office phone.
- `[VERIFIED]` Production release `94009e2d` is live through Vercel deployment `dpl_aAG3yU9VheoDbdTHRn5AE4jphVUY`. The served COMMAND artifact contains the plus picker, protected upload route, and 1200x1500 crop contract; the new serverless function is present, rejects unauthenticated writes with HTTP 401, and production route verification passed with no HTTP 5xx responses. Browser verification showed meaningful lock-screen content with no error overlay; an intentional real-agent upload remains for the operator because verification did not create a fake photo or alter production agent data.

## 2026-08-05: COMMAND outreach-photo merge repair

- `[IMPLEMENTED]` REL8TION COMMAND's focused open-house SMS composer now preserves a rendered property outreach image when the same event is subsequently merged from listing inventory, listing-agent, and canonical open-house feeds. A source record without rendered media can no longer replace the existing rendered URL, status, source, media ID, or linked outreach queue row and leave the control stuck on **Photo generating**.
- `[NEEDS VERIFICATION]` Production deployment and Sarah Fox's focused 48 Route 25A workflow still need verification before this fix is called live.

## 2026-08-04: WordPress pricing connection and public catalog CORS

- `[IMPLEMENTED]` The public pricing catalog now returns `Access-Control-Allow-Origin: *` on every response. The catalog contains no private data, and the stable wildcard prevents Vercel from caching an origin-less response that later breaks the WordPress pricing page.
- `[IMPLEMENTED]` The live WordPress homepage links Pricing from its header and footer and shows the current Complete System monthly offer: $199 due today, followed by $29/month after 31 days. The WordPress page remains manually managed and must still be verified separately from the tracked `wordpress/` source after future edits.

## 2026-08-04: Booking calendar route shadow fixed

- `[IMPLEMENTED]` Corrected the legacy root `book-a-call.html` wrapper. With Vercel `cleanUrls` enabled, that root file takes precedence over the `/book-a-call` rewrite; it had redirected the browser back to itself. It now forwards to the actual `apps/rel8tion-app/book-a-call.html` calendar while preserving the query string and fragment.
- `[IMPLEMENTED]` `scripts/verify-booking-calendar.cjs` now rejects a self-targeting clean-URL wrapper and requires the real calendar target, protecting the canonical `https://app.rel8tion.me/book-a-call` entry route from the same loop.
- `[VERIFIED]` Production commit `c284a9be` deployed as `dpl_HxrqmnhqYSvbDjxJkcUwVVhUhnGC`. The canonical entry no longer self-loops, the real booking form returns HTTP 200, both loan-officer and broker/team availability return live slots, and an empty create request is rejected with HTTP 400 without creating a booking.

## 2026-08-04: Protected MelissaSellsNY.com domain-sale page

- `[VERIFIED]` `melissasellsny.com` and `www.melissasellsny.com` serve the dedicated domain-for-sale landing page from agent-builder production deployment `dpl_HgwmR2ia2aYQmGF81QdV9Z2JgeoE` at commit `49b6cc9` on `main`.
- `[IMPLEMENTED]` The domain is reserved directly in agent-builder middleware and rewrites to the `nymelissa` sale route without depending on the mutable `agent_websites` mapping. Non-root public paths redirect to the canonical sale homepage, while system routes such as `/api/contact` remain available.
- `[IMPLEMENTED]` `npm run build` now runs `verify:melissa-domain-sale` first. The production build fails if the sale component, route override, reserved-domain middleware mapping, canonical metadata, or sale-only sitemap protection is removed.
- `[VERIFIED]` Both apex and `www` return HTTP 200 with the sale title and offer content, the former Melissa Unger agent-template title is absent, `/about` redirects to `/`, and the domain sitemap contains only the canonical sale URL.

## 2026-08-04: Agent-first reverse open-house discovery

- `[IMPLEMENTED]` The relationship-listing worker now treats every verifiably sent historical outreach row as a reverse-discovery candidate, in addition to claimed/worked-with and positive-interest agents. Unsent prepared queue rows and placeholder names remain excluded.
- `[IMPLEMENTED]` Targeted OneKey discovery is incremental. Positive relationships run first, prior-outreach agents run next, and other known agents follow; a service-role-only cursor in `rel8tion_runtime_settings.key='agent_listing_inventory_onekey_agent_cursor'` advances after each successful cron so the two-hour job rotates across the full population instead of repeating the first configured batch.
- `[IMPLEMENTED]` Previously verified OneKey member and office keys are reused from protected `agent_listing_inventory.source_payload` after exact-name and phone-conflict checks. Cache hits skip the agent-directory API call while Sale and Rent inventory are still refreshed, reducing repeat-request volume from three requests to two per known identity.
- `[IMPLEMENTED]` Upcoming OneKey open houses can be reconciled into canonical `open_houses` when `AGENT_LISTING_INVENTORY_PROMOTE_OPEN_HOUSES=true`. Exact source ID is preferred; otherwise normalized address plus a start-time tolerance attaches the known agent to an existing event while preserving that event's ID and source. Events with no canonical match are inserted with their OneKey listing ID. This path does not queue or send outreach.
- `[IMPLEMENTED]` The scheduled endpoint now emits a PII-free completion summary with duration, profiles scanned/matched, identity-cache hits, listings found, canonical events attached/inserted, and the next cursor.
- `[VERIFIED]` Production commit `7b156d26` is live through environment-refreshed deployment `dpl_AK6eUskt4uqdJgZeES4XLRX7aEWb`, with `AGENT_LISTING_INVENTORY_ENABLED=true`, targeted OneKey discovery enabled, and `AGENT_LISTING_INVENTORY_PROMOTE_OPEN_HOUSES=true`. The first expanded run completed in 7.2 seconds: 2,097 targeted profiles were eligible, 250 were scanned, 223 matched, zero failed, 55 reused cached identity, and 1,249 OneKey listings were examined. Canonical reconciliation wrote 60 upcoming rows: 48 matched by source ID, 9 existing events gained agent data, and 12 missing events were inserted. Future canonical inventory rose from 462 to 474 rows; agent-scraped rows rose from 122 to 143 and agent-enriched rows from 88 to 109. The cursor persisted at 250, so subsequent two-hour runs continue through the remaining population. No outreach row or SMS was created by this sync.
- `[VERIFIED]` Production now sets `AGENT_LISTING_INVENTORY_ONEKEY_AGENT_LIMIT=500`, doubling each scheduled batch from 250 agents. Environment-refreshed deployment `dpl_6UkLCrEGCpzQhrNDq4JS8ot3RYrH` completed a 500-agent proof run in 14.3 seconds: 463 identities matched, zero failed, 2,261 listings were scanned, 21 existing events gained agent data, 19 missing events were inserted, and the cursor advanced from 250 to 750. No HTTP 500 response occurred. At the two-hour schedule, the remaining initial population should be covered by the 2026-08-04 08:23 ET run.

## 2026-08-02: Payment-first public checkout

- `[IMPLEMENTED]` Public REL8TION Agent and Complete Open House System calls to action now create Stripe Checkout immediately after the buyer selects monthly or annual pricing. The former public Complete System path no longer requires the long kit-intake form before payment.
- `[IMPLEMENTED]` Stripe Checkout no longer explicitly requests phone, billing address, or shipping address for these public plans. Stripe still collects the customer email and payment information required for Checkout; the secured post-payment kit dashboard handles company branding, delivery details, and onboarding afterward.
- `[IMPLEMENTED]` Event Pass/keychain prefill remains available for field-linked setup, while public WordPress and Open House Kit marketing links use the payment-first handoff.
- `[IMPLEMENTED]` Previously published WordPress Complete System links that still point to `/kit-intake?source=wordpress` are compatibility-redirected into the payment-first flow unless they carry field/keychain setup context. This makes the already-published block fast immediately while preserving specialized setup paths.
- `[IMPLEMENTED]` The previously published WordPress Agent link is also recognized by its `rel8tion.me` referrer plus explicit agent/billing selection and opens the selected Stripe Checkout automatically. Direct visits to the app pricing page still render plan comparison normally.

## 2026-08-02: Canonical pricing and private sales calendar live

- `[VERIFIED]` Production release `57a3623` is live through Vercel deployment `dpl_5i1Gxvn9Ym5aGrxUQsZQsvCHaoJ7` on `app.rel8tion.me`. `/api/public/pricing`, `/pricing`, `/book-a-call`, and the broker/team availability API returned the approved 2026-08-02 catalog and calendar; the repository production-route suite passed against the release.
- `[VERIFIED]` The production pricing API exposes only the approved agent, kit, Digital You, and custom-domain products. A direct public Checkout request for the private loan-officer consultation is rejected with HTTP 400, so booking cannot become a self-service loan-officer purchase.
- `[VERIFIED]` Website-builder release `e59b333` is live through Vercel deployment `dpl_5PYcMcRjHCrWdHnV7KwsPfq4YaQC` on `my.rel8tion.me`. Its same-origin pricing API and `/get-started` page return the canonical catalog, including Digital You at $199/year and optional custom-domain service at $49/year.
- `[NEEDS VERIFICATION]` A fake reservation was not created in production. The first designated real booking should confirm end-to-end SMTP delivery and the attached `.ics` invitation to both the visitor and `jared@rel8tion.me`.

## 2026-08-02: Smart Sign inventory generation in REL8TION COMMAND

- `[IMPLEMENTED]` REL8TION COMMAND's QR Batch Printing dropdown now includes **Smart Sign QR** alongside Agent Rel8tionChip and Event Pass.
- `[IMPLEMENTED]` A Smart Sign batch creates 1-100 brand-new `smart_sign_inventory` rows with `inventory_type=smart_sign`, cryptographically random 12-character public codes, canonical `/s?code=...` destinations, printed batch metadata, and an immediate fulfillment ZIP containing the CSV, matching 1024px PNG files, and README.
- `[IMPLEMENTED]` Smart Sign generation does not reserve, convert, assign, reset, or edit existing Smart Signs, Event Passes, agent-chip inventory, agents, or events. `smart_sign_inventory.public_code` remains the printable QR source of truth.
- `[VERIFIED]` Production release `a09f5a0` is live through Vercel deployment `dpl_8qtH3R77KEbQJq6j9z77oG2JtUjn`. The served admin artifact contains the Smart Sign option and safety confirmation, the batch endpoint remains admin-protected, mocked Agent/Smart Sign/Event Pass ZIP verification and production route checks pass, and the deployment produced no HTTP 500 responses during verification. No production inventory row was created by the verification.

## 2026-08-01: COMMAND focused-profile speed and visible cancellation

- `[IMPLEMENTED]` Focused Agent Performance profiles initially render at most 20 conversations, upcoming open houses, and listings per section, with incremental **Show 20 more** controls. This prevents high-volume agents from constructing their complete history on the click that opens the profile.
- `[IMPLEMENTED]` Initial COMMAND loading no longer waits for the 1,000-agent relationship board. Relationship hydration runs after first paint through a summary projection, and recurring live refresh updates only the Outreach inbox and health data instead of reloading relationships or repainting Agent Performance/Open Houses.
- `[VERIFIED]` The production `agent_board_v1` schema supports the summary projection. Across 1,000 current rows its database JSON size is about 450 KB versus 885 KB for the full projection before the summary path also skips follow-up conversation expansion.
- `[IMPLEMENTED]` A linked active `field_demo_visits` appointment now exposes **Cancel accepted open house** from the focused agent page, the agent's upcoming-open-house list, the outreach workflow, and the future-opportunity card, while the authoritative Accepted Open Houses row keeps its existing control. Accepted/confirmed outreach rows that predate or lack a field visit can use the same control to return the outreach relationship to interested without deleting the MLS listing, conversation history, or sending a message. Unaccepted source-feed listings remain non-destructive.
- `[VERIFIED]` Production release `298c29f` is live through deployment `dpl_173RcLPKmibBusMrC2vsAP7Vk1Ug`. The served COMMAND artifact contains focused/opportunity cancellation, bounded detail rendering, and summary relationship hydration; the recurring live-refresh function contains no relationship-board request. Production route verification passed, and the summary API remains admin-protected (HTTP 401 without credentials).
- `[VERIFIED]` Accepted-outreach cancellation fallback release `787674b` is live through deployment `dpl_3x2T78eTDUE48CcY3ytMY2XzqS1b`. The production artifact contains both scheduled-visit and accepted-outreach cancellation paths, including confirmation copy that preserves the listing/conversation history and sends no message.

## 2026-08-01: REL8TION COMMAND navigation performance repair

- `[IMPLEMENTED]` COMMAND area changes, Agent Performance drill-down, Open House agent links, and **Back to all agents** now update only the active workspace instead of rebuilding the full dashboard shell or requesting `/admin` again.
- `[IMPLEMENTED]` Browser history is synchronized with in-place navigation, so Back/Forward restores the selected COMMAND area and focused agent without a page reload.
- `[IMPLEMENTED]` Agent ordering and future-open-house projections are indexed when data arrives rather than rebuilt on every click. The recurring foreground refresh updates outreach, health, and relationship data only; the multi-source dashboard snapshot is reserved for initial load, explicit Refresh, and completed mutations.
- `[IMPLEMENTED]` Hidden COMMAND tabs no longer poll. This prevents several open tabs from multiplying the expensive dashboard requests and DOM work.
- `[VERIFIED]` Production release `8e05d3c` is live through deployment `dpl_EJpLA289FYfz5SZQiFLL5hFtSnTU`. The served 307 KB COMMAND page contains the lightweight refresh, cached indexes, and Back/Forward handler; the former 45-second full-dashboard polling call is absent. Production route verification passed.

## 2026-08-01: Property-specific outreach photos in COMMAND

- `[IMPLEMENTED]` Future `agent_listing_inventory` rows now carry their own generated outreach-image URL and render state. The existing mockup cron spends most of each batch on missing future-listing images while preserving capacity for the original outreach queue renderer.
- `[IMPLEMENTED]` Listing photo, address, or open-house time changes reset that listing's image to pending so a prior property's graphic cannot be reused for a newer event. Failed renders are visible as failed instead of falling back to a generic or unrelated image.
- `[IMPLEMENTED]` The focused Agent Performance SMS composer shows an opt-in **Include photo** control beside **Review + send SMS**. It is off by default, displays the selected property image before sending, and still requires the existing confirmation.
- `[IMPLEMENTED]` Manual photo messages use the registered Twilio outreach route because Android Gateway is text-only. The server resolves the stored image by its source row, verifies that it belongs to the conversation agent, restricts media to REL8TION's public `agent-mockups` storage bucket, and retains suppression, STOP, and quiet-hour enforcement. Generating an image never queues, approves, or sends outreach.
- `[VERIFIED]` Production main release `06129f7`, renderer deployment `dpl_FP4x2mYQGSUx5nFR2X8NwTjEJBU2`, and `send-agent-manual-reply` version 57 are live. The first two scheduled passes rendered 55 future-listing JPGs with zero failures; Lovelee M. Vetri's 806 Mount Ave listing received its own 200/`image/jpeg` asset. COMMAND loaded without a browser error overlay or console errors and contained the deployed photo-control/payload code. No SMS was sent during verification.

## 2026-08-01: Unified open-house agent workflow and performance repair

- `[IMPLEMENTED]` REL8TION COMMAND now places authoritative upcoming accepted/confirmed field visits directly below Live Events, ahead of general future opportunities.
- `[IMPLEMENTED]` Clicking an agent or **Agent + message** from a future open house stays inside one focused Agent Performance profile with the selected property context, direct call/text/email actions, stored outreach context, and an in-profile REL8TION SMS composer when a queue thread exists.
- `[IMPLEMENTED]` The unified profile includes complete confirmed outreach history in addition to the newest general outreach slice, restoring older verified agent photos and reply-capable queue rows such as Lovelee M. Vetri's.
- `[IMPLEMENTED]` Open-house opportunities and the unfocused Agent Board render in bounded 60-row increments, and the full website editor is deferred until an individual agent is open. This avoids building hundreds or thousands of heavy cards in one browser frame.

## 2026-08-01: Relationship-prioritized future open houses

- `[IMPLEMENTED]` REL8TION COMMAND's future Agent Board open houses can be searched by agent, brokerage, phone, email, or property address and filtered by relationship, date range, and local start-time range.
- `[IMPLEMENTED]` Future events and Agent Performance profiles rank relationship history in this order: accepted/worked with, interested, prior sent outreach, then new agents; event date breaks ties within a relationship group.
- `[IMPLEMENTED]` Accepted/confirmed field visits and hosted REL8TION events count as real relationship history. Unsent prepared outreach rows do not count as prior outreach.

## 2026-08-01: Durable buyer property experience

- `[VERIFIED]` Buyer property media and the post-check-in **Explore This Property** action open `/l/:open_house_id` with the current event id preserved for return navigation.
- `[VERIFIED]` The property page renders an expandable gallery plus stored description, property facts, features, host context, and verified listing access when available.
- `[VERIFIED]` Production table `open_house_property_profiles` stores the durable sanitized property profile and private source snapshot. RLS is enabled; `anon` and `authenticated` have no direct table privileges, while the server-side service role manages refreshes.
- `[VERIFIED]` Missing or stale OneKey-backed profiles are refreshed and upserted server-side, with safe fallback to `open_houses`. Production deployment `dpl_DjjJbPvob8vkJsyDh7SZZqPCnhaf` was verified against 23 3rd Ave, Farmingdale on 2026-08-01.
- `[IMPLEMENTED]` `/api/cron/enrich-property-profiles` proactively refreshes active events and confirmed/scheduled REL8TION open houses every three hours. It prioritizes missing and single-photo galleries, checks alternate OneKey listing identifiers plus nested record media, deduplicates up to 50 public property images, and requires Vercel's `CRON_SECRET` bearer authorization.

## 2026-07-31: Unified Agent Performance board

- `[IMPLEMENTED]` REL8TION COMMAND Agent Performance now builds one additive agent-level read model across canonical agents, claimed keychains, rankings, outreach, inbound replies, leads, listing inventory, listing contacts, and upcoming open houses. Agents remain visible even when they have no messages or listings.
- `[IMPLEMENTED]` Each Agent Board profile retains full expandable outreach/conversation, upcoming-open-house, and known-listing detail while preserving the existing Outreach, Open Houses, Agent Ranking, and Agent Websites workspaces.
- `[IMPLEMENTED]` Agent links throughout COMMAND open a focused in-dashboard profile instead of looping through the `/admin` launcher. The focused profile opens its source-detail sections and provides a Back to all agents control.
- `[IMPLEMENTED]` Open Houses includes the Agent Board's future events sorted soonest first. Past open houses remain excluded from the upcoming list.
- `[IMPLEMENTED]` This release adds read queries and UI only. It does not apply a migration, enable a scraper/cron, alter production records, or send outreach.

## 2026-07-30: Agent Ranking current-listing inventory

- `[IMPLEMENTED]` Agent Ranking profile portraits now resolve through one identity-verified fallback chain: the canonical `agents.image_url`, agent-website `photo_url`, enriched `agent_outreach_queue.agent_photo_url`, then listing-agent directory photos. Exact phone or email wins; contact-less fallback requires exact normalized name plus compatible brokerage. The selected portrait is returned on the profile ranking so the profile and Marketing Report use the same image.
- `[IMPLEMENTED]` `agent_rankings.active_listing_count` is now presented as an **Imported listing signal**, not as verified live inventory. Table, profile, area-comparison, pitch, and report wording direct the operator to the separate REL8TION current-listing and upcoming-open-house counts. Relationship inventory still refreshes every two hours for ranked agents, claimed agents, prior-work agents, and positive-interest agents.
- `[IMPLEMENTED]` The searchable Agent Ranking population is the union of trusted ListReports rankings and real REL8TION relationship-only agents. A completed/ended REL8TION open house, past confirmed/live/completed field visit, or positive `interested` / `confirmed_open_house` / `accepted_open_house` / `drip_scheduled` relationship can create a clearly labeled relationship-only dashboard row even when the agent has no `agent_rankings` record. These rows show `ListReports: Not imported`, never invent production metrics, deduplicate against trusted rankings, and still support real history, current inventory, upcoming open houses, and the manual reminder workflow.
- `[IMPLEMENTED]` Agent Ranking now marks **Worked together** only from real production history: ended `open_house_events` or past confirmed/live/completed `field_demo_visits`. The list supports a Worked together filter and history count/date, while the agent profile shows the deduplicated REL8TION Open House History joined back to the real `open_houses` address, time, listing link, photo, and property facts when available. Imported ListReports estimates and preview rows do not establish this relationship.
- `[IMPLEMENTED]` A relationship-qualified future listing can create a **Draft "have me there" reminder** using that inventory row's real address and Eastern-time date. The server verifies the event is still upcoming and that the agent either has prior REL8TION history or an approved positive relationship status. The queue row is forced to `send_mode=manual`, `approved_for_send=false`, `initial_send_status=not_queued`, `initial_block_reason=manual_review_required`, and follow-ups disabled; creating the draft sends no SMS.
- `[IMPLEMENTED]` Agent Ranking labels imported `active_listing_count` as an unverified ListReports listing signal and shows a separate REL8TION-verified database-current count. Clicking an agent separates active/pending listing inventory from upcoming open houses.
- `[IMPLEMENTED]` The protected `agent_listing_inventory` source and a two-hour `sync-agent-listing-inventory` cron reuse verified current `agent_website_listings` plus future `open_houses`, matching them to ranked agents, claimed agents, and outreach rows marked `interested`, `confirmed_open_house`, `accepted_open_house`, or `drip_scheduled` using contact identity or exact name plus brokerage. Website and open-house rows for the same agent/address are merged so one property is not shown twice. Ranked-only agents are included for visibility, while future listing marketing remains server-limited to claimed/worked-with or positive-interest relationships.
- `[IMPLEMENTED]` Production is configured with `AGENT_LISTING_INVENTORY_ENABLED=true` for inventory-only sync and `AGENT_LISTING_INVENTORY_OUTREACH_ENABLED=true` for manual, relationship-qualified open-house queue staging, while `AGENT_LISTING_INVENTORY_PROMOTE_OPEN_HOUSES=false` preserves the existing source tables. No automatic sending is introduced. An admin-only **Sync Listings** action can run the same inventory refresh on demand.
- `[IMPLEMENTED]` Broad geographic OneKey discovery remains disabled because the unfiltered search response omits listing-agent identity and its 10,000-result window is not a safe agent matcher. A separate gated `AGENT_LISTING_INVENTORY_ONEKEY_AGENT_DISCOVERY_ENABLED` path resolves only worked-with or positive-interest relationship agents through OneKey's agent directory, requires exact full name plus exact phone/email or compatible brokerage, rejects conflicting phone numbers, and queries active Sale and Rent inventory by the stable OneKey member key. It writes only protected `agent_listing_inventory`; open-house promotion and outbound messaging remain independently disabled.
- `[VERIFIED 2026-07-30]` The additive production migration was applied individually because the broader migration ledger is drifted. Production verification found RLS enabled, no anon/authenticated SELECT grant, service-role CRUD access, 38 columns, 5 indexes, and no advisor finding for the new table. Live commit `0aa2c3b` synced 176 deduplicated current records: 12 website-sourced listings and 164 upcoming open-house records, with zero canonical agent/address duplicates. Of those, 29 are tied to worked-with or positive-interest relationships and are eligible for manual queue staging. Ruth Chalco correctly displays the difference between 3 ListReports-reported listings and 0 current database listings; a populated profile was verified with its current property details, and a relationship-qualified upcoming open house displayed the manual queue control without sending a message.
- `[VERIFIED 2026-07-30]` Production release `a1f5b39` identifies 75 ranked agents with prior REL8TION open-house history. Ruth Chalco shows 3 real completed events with the source addresses/property facts and the actual event dates (most recent July 19), while retaining 0 current database listings versus 3 ListReports-reported listings. Barbi Schwartzberg shows 2 real upcoming July 31 inventory open houses with the manual **Draft "have me there" reminder** control. Browser verification found no console errors; no reminder row was created and no SMS was sent during verification.
- `[VERIFIED 2026-07-30]` Production release `d9d85a1` adds 18 relationship-only agents to the 12,524 trusted ListReports rankings and raises the searchable prior-REL8TION-history population from 75 to 90 without changing imported production totals. Delilah Obee, who has no `agent_rankings` row, now appears as an `accepted_open_house` relationship with `ListReports: Not imported`; her profile shows the real July 22 completed event and the August 8 open house at 2978 Grand Blvd with the manual reminder control. Browser verification found no console errors and created no reminder or SMS.
- `[VERIFIED 2026-07-30]` Production release `8edfe31` resolves Nina Sabag's existing enriched outreach headshot into Agent Ranking by exact normalized phone and displays the same portrait in the live profile. Her `23` value is labeled only as an unverified imported listing signal, separate from the real May 10 completed REL8TION open house and the independently verified current inventory. The loaded portrait was visible at its natural 240×240 dimensions, and browser verification found no console errors.
- `[VERIFIED 2026-07-30]` Production release `2aec8c6` enabled relationship-scoped OneKey member discovery and completed an immediate live sync with HTTP 200: 137 worked-with/positive-interest agents checked, 82 exact identities matched, zero identity lookups failed, 409 OneKey listings scanned, and 557 protected inventory records written or refreshed across all enabled sources. Nina Sabag matched by exact phone to OneKey member key `326232401`; her live profile now shows 22 verified current listings (21 sale and 1 rental), 22 unique OneKey listing links, 3 upcoming open-house entries, and 1 this-weekend entry. The imported ListReports signal remains separately labeled `23`. The sync did not promote rows into `open_houses`, create reminder rows, or send SMS.
- `[IMPLEMENTED]` Agent Ranking display deduplication treats rows with the same exact linked `agent_id` and normalized phone as one agent even when separate ListReports exports use brokerage aliases. The newest source snapshot supplies the visible identity while duplicate ranking IDs and upload IDs remain in display metadata, preserving raw import history. This changes only the Agent Ranking read model; it does not delete or alter the canonical agent, agent website, current listings, or REL8TION open-house history.
- `[VERIFIED 2026-07-30]` Production release `869610e` consolidates Elena Galluzzo's `Compass` and `Compass Greater NY LLC` ranking aliases into one visible `Compass Greater NY LLC` profile using her shared canonical agent ID and exact phone. Live verification returned one search result while preserving both ranking IDs and both upload IDs in display metadata; her 24 verified listings, 1 upcoming open house, and 1 completed REL8TION event remained attached. No agent-website code or data was changed.

## 2026-07-29: Admin open-house controls

- `[IMPLEMENTED]` REL8TION COMMAND now separates Open Houses from Signs. The Open Houses summary cards and workspace no longer route through or render sign inventory.
- `[IMPLEMENTED]` The Open Houses workspace shows live events first, provides direct event-dashboard links, keeps recent ended events in a separate history section, and lists scheduled/confirmed coverage appointments with loan-officer assignment controls.
- `[IMPLEMENTED]` Admins can cancel a scheduled open house after typing `CANCEL`. Cancellation preserves buyer, event, and outreach history; releases visit participants and linked availability blocks; returns accepted outreach to interested status; and ends any matching live event through the existing sign and loan-officer cleanup path.
## 2026-07-28: Read-only REL8TION Agent Ranking API token

- `[IMPLEMENTED]` The Agent Ranking GET endpoint accepts a dedicated server-only `REL8TION_RANKING_TOKEN` through `x-rel8tion-ranking-token`, allowing REL8TION OS to read ranking records without receiving the broad reset/admin credential.
- `[IMPLEMENTED]` The dedicated token is read-only. Agent Ranking POST actions still require the existing admin authorization path, and invalid ranking tokens return HTTP 401.
- `[IMPLEMENTED]` Authenticated list reads accept a bounded page size of up to 1,000 records so REL8TION OS can load the complete ranking population without silently stopping at the first 5,000 agents.
- `[PARTIAL]` The same generated `REL8TION_RANKING_TOKEN` is configured as a Sensitive, Production-only Vercel variable and in the REL8TION OS backend. The initial token deployment is live; complete-population deployment and final ranking-card verification remain outstanding.

## 2026-07-27: Event Pass QR batch printing in REL8TION COMMAND

- `[IMPLEMENTED]` REL8TION COMMAND's QR Batch Printing control now offers an Agent Rel8tionChip / Event Pass dropdown and exports 1-100 selected codes as a fulfillment ZIP with a CSV, matching 1024px PNG files, and a README.
- `[IMPLEMENTED]` Agent export keeps its existing inventory and ZIP format. Event Pass export reserves only fresh, unprinted, unclaimed, unassigned, non-sponsored `single_event` rows from `smart_sign_inventory`, records the print batch and timestamp in row metadata, and uses `/pass?code=...` as the encoded destination.
- `[IMPLEMENTED]` `smart_sign_inventory.public_code` remains the Event Pass QR source of truth; Event Pass export never converts agent inventory or reserves an active, claimed, sponsored, reusable, or historical pass.

## 2026-07-27: Follow-up agent conversation context for REL8TION OS

- `[IMPLEMENTED]` The authenticated agent relationship projection now includes chronological sent/received outreach context only for agents whose latest relationship state is marked Follow Up.
- `[IMPLEMENTED]` Conversation matching uses exact normalized phone, exact email, or the canonical outreach source-row id. It does not use fuzzy name matching.
- `[IMPLEMENTED]` The projection is read-only: message bodies remain in the existing `agent_outreach_queue` and `agent_outreach_replies` records; no message, relationship, open house, or agent record is copied, edited, or sent.
- `[VERIFIED]` Production commit `c5551f0` deployed READY on 2026-07-27. The authenticated projection returned all ten currently marked follow-up agents with linked history: 63 messages total, including 43 outbound and 20 inbound messages.

## 2026-07-27: Complete confirmed open-house history in REL8TION COMMAND

- `[IMPLEMENTED]` REL8TION COMMAND Reports now opens to **All confirmed** instead of hiding past events behind the Upcoming confirmed filter. The combined view uses newest-first smart sorting so recent follow-up opportunities appear first.
- `[IMPLEMENTED]` The admin dashboard loads all field visits and visit participants in bounded pages and separately loads every confirmed/accepted outreach row, rather than depending on the newest 1,000 outreach rows or the first 250 visits to reconstruct history.
- `[IMPLEMENTED]` Confirmed report cards no longer stop rendering after 120 rows. Upcoming and Previous filters remain available when the operator wants a narrower view.
- `[IMPLEMENTED]` Reports includes a **Replies awaiting confirmation** recovery lane. REL8TION COMMAND loads up to 600 historical reply threads with chunked queue/message enrichment so older affirmative replies can be reviewed and promoted with the correct event date instead of being silently omitted or automatically misclassified.
- `[IMPLEMENTED]` The recovery lane inspects saved inbound messages, not only the thread's latest direction, so a later outbound follow-up cannot hide an older agent reply that still needs confirmation review.

## 2026-07-26: Printed agent QR to Event Pass conversion

- `[IMPLEMENTED]` The printed agent QR resolver may hand a deliberately converted code from `/c/:code` to `/pass?code=...` only when the original `rel8tion_chip_inventory` row is retired and a matching `smart_sign_inventory` Event Pass row carries the original inventory id in explicit conversion metadata.
- `[IMPLEMENTED]` This narrow compatibility path preserves `smart_sign_inventory.public_code` as the Event Pass source of truth and does not change normal linked or unassigned agent QR behavior.
- `[VERIFIED]` Production codes `ra0034c0` and `ra00cff8` were converted by owner request on 2026-07-26. Their original printed-agent rows are retired, their matching Event Pass inventory rows are unclaimed single-event passes, each printed `/c/:code` URL redirects to its matching `/pass?code=...` route, and both live pass pages return HTTP 200.

## 2026-07-26: REL8TION COMMAND phone-unlock recovery

- `[IMPLEMENTED]` REL8TION COMMAND now defines the phone-number normalization helper used by agent relationship matching. The missing helper no longer interrupts dashboard rendering after a successful phone/PIN unlock or sends the owner back to the fallback admin-credential screen.

## 2026-07-26: REL8TION OS schedule feed deduplication

- `[IMPLEMENTED]` The authenticated relationship schedule view collapses repeated `field_demo_visits` that have the same open-house identity, scheduled window, and agent identity before sending them to REL8TION OS.
- `[IMPLEMENTED]` Deduplication is read-only: every original production visit remains intact, while the response reports `source_record_count` and `source_field_visit_ids` for traceability.
- `[VERIFIED]` The private production token connection returned the scheduled feed successfully. Local acceptance found two distinct July 26 open houses from three source rows because the Pablo Geymayr visit existed twice with the same open-house ID and time.

## 2026-07-26: Agent Ranking canonical identity consolidation

- `[IMPLEMENTED]` Production `agent_rankings` was consolidated from 42,149 derived rows to 12,524 canonical agent rows. The 16,386 location-variant duplicates plus 13,239 hidden legacy/untrusted derived rows were removed from the current ranking table; all 114,153 normalized raw import-history rows remain in `agent_production_import_rows`.
- `[IMPLEMENTED]` Ranking identity is now `import:{normalized_agent_name}|{normalized_brokerage}|{normalized_phone}`. County, market, city, and state no longer create a second ranking for the same agent, while agent name and brokerage remain in the key so shared office phone numbers do not collapse different agents.
- `[IMPLEMENTED]` A production database trigger canonicalizes ranking identity before every insert or identity-relevant update, and the unique `identity_key` index rejects location variants even if an older caller supplies a location-based key. The admin import code uses the same canonical identity before batch dedupe and PostgREST upsert.
- `[VERIFIED]` Production has 12,524 ranking rows, 12,524 distinct identity keys, zero missing identities, and zero duplicate identity rows. A rolled-back production insert test using a different county and a stale location-based key inserted zero rows.

## 2026-07-26: Loan-officer desktop access

- `[IMPLEMENTED]` A signed-in loan officer without a browser-local device lock now opens the dashboard directly. Device lock is optional and its UI now correctly names supported device security such as Windows Hello, Face ID, fingerprint, or a device screen lock.
- `[IMPLEMENTED]` The loan-officer desktop sidebar labels the account section `Profile`; only the houses section is labeled `Open Houses + Buyers`.

## 2026-07-20: Three-device shared open-house coverage

- `[IMPLEMENTED]` One live open house may have up to three connected coverage devices: one Event Pass carried by the host agent, one Event Pass carried by the assigned loan officer, and one stationary Smart Sign or Loan Officer Coverage Sign.
- `[IMPLEMENTED]` Activating another supported device for the same host agent and `open_house_source_id` joins the existing active event instead of creating a duplicate event. All devices resolve to the same buyer flow, check-ins, disclosures, financing requests, loan-officer session, and dashboard.
- `[IMPLEMENTED]` A fourth device is rejected until one of the three connected devices is ended or replaced.
- `[IMPLEMENTED]` Ending the shared event clears every `smart_signs.active_event_id` link plus connected Loan Officer Coverage Sign state, rather than clearing only the event's primary sign.
- `[NEEDS VERIFICATION]` Field-test the complete sequence on physical hardware: agent Event Pass first, loan-officer Event Pass second, then Smart Sign or LO Coverage Sign third; scan all three buyer QR/NFC routes and confirm one event/check-in list.

## 2026-07-20: OneKey outreach headshot enrichment

- `[IMPLEMENTED]` `npm run enrich:headshots` previews upcoming outreach headshots by matching compatible exact agent names and requiring the matching 10-digit phone on the OneKey profile before accepting its member image. Brokerage is retained as a secondary consistency signal so a legitimate company change does not reject the correct person.
- `[IMPLEMENTED]` The local command is preview-only unless `--write` is supplied. The production `/api/cron/enrich-agent-headshots` route requires Vercel's `CRON_SECRET`, runs every six hours at minute 17, checks at most eight agents per run, observes a 24-hour unsuccessful-match cooldown, copies accepted images into `enriched-photos`, does not overwrite existing photos, and propagates accepted photos to matching `listing_agents` and `agent_outreach_queue` rows.
- `[IMPLEMENTED]` Seven verified agents were enriched in production on 2026-07-20, updating eight of this week's missing outreach rows. This week's coverage is now 11 of 23 rows; the remaining 12 rows were left blank because no verified OneKey image was available.
- `[PARTIAL]` The initial live update uses OneKey's historical member-image CDN URLs. New cron-enriched images are copied into the REL8TION `enriched-photos` bucket for independent storage.

## 2026-07-16: New York agent-website compliance controls

- `[IMPLEMENTED]` `agent_websites` now stores the exact NY license type, brokerage address/phone, brokerage website, and employing broker Standardized Operating Procedures URL.
- `[IMPLEMENTED]` Generated agent sites display the NY Housing and Anti-Discrimination Disclosure link, brokerage/license identity, brokerage contact information, optional broker site/SOP links, and listing-broker attribution.
- `[IMPLEMENTED]` The website builder collects these fields and saves new incomplete NY sites as drafts. REL8TION COMMAND can edit the same compliance fields.
- `[NEEDS VERIFICATION]` Each employing broker must supply its own current, dated SOP URL. REL8TION must not invent broker policies. Fidel Lloyd's license type and Home Affordable Realty Corp office address/phone are populated, but the brokerage SOP URL remains outstanding.

## 2026-08-05: Outreach release and event-time priority

- `[IMPLEMENTED]` The automatic outreach sender now prioritizes eligible future open houses by `open_start` ascending, so the earliest event date and time is dispatched first.
- `[IMPLEMENTED]` Owner-approved production ceilings are active at 7 sends per run, 20 per rolling hour, and 150 per rolling 24 hours. STOP/opt-out suppression, duplicate-phone cooldown, provider-health gating, future-event eligibility, and listing/render readiness remain enforced.
- `[IMPLEMENTED]` Direct `send-agent-outreach` invocation now requires the service-role credential. A service-role-only, explicit `override_health_gate=true` request can authorize an owner-directed batch after provider-health review without clearing recipient opt-outs or duplicate suppression.
- `[IMPLEMENTED]` `rel8tion_runtime_settings.key='outreach_release_window'` can temporarily authorize cron-driven health-gate bypass for a bounded `through_open_start` and `expires_at`. An optional `from_open_start` adds an inclusive lower date bound. The sender applies the configured date range to its query, so a release cannot spill into earlier or later open-house dates; all recipient suppression and volume ceilings remain enforced.
- `[IMPLEMENTED]` On 2026-08-05, the owner directed every eligible August 8 row to go out the same day. The date-scoped release first reached zero at 4:53 PM ET, reopened for late-generated rows, then completed again at 5:38 PM ET and was disabled for overnight safety. Final August 8 queue statuses were 72 sent, 17 duplicate blocks, 3 manual-SMS skips, and 1 expired row, with zero pending. For the 64 August 8 messages sent during the scoped releases, final checkpoint callbacks were 59 delivered, 3 sent, and 2 failed with Twilio 21614 because the destinations were not valid mobile numbers; neither failure was retried. August 9 and later were excluded throughout the August 5 release.
- `[IMPLEMENTED]` At 8:08 PM ET on 2026-08-05, 13 additional eligible August 8 rows appeared after the earlier completion. The first retry used the legacy upper-bound-only window and immediate verification found that it sent 3 earlier August 6 rows plus 4 August 8 rows before the new lower-bound safeguard was applied. All 7 delivered and none failed; one other earlier-date candidate was suppressed. The window was immediately corrected to the exact inclusive/exclusive range `2026-08-08T04:00:00Z` through `2026-08-09T04:00:00Z`. Across the corrected completion, 6 August 8 rows sent and delivered and 7 duplicate-phone candidates were blocked, returning eligible August 8 pending to zero before the window was disabled. The 3 already-sent August 6 messages cannot be recalled. At 8:23 PM, 8 more eligible August 8 rows appeared; the exact-date scope sent and delivered 4 within the remaining hourly slots, blocked 2 additional duplicate-phone candidates, and left 2 pending. The rolling-hour count reached its ceiling of 20, so the window was disabled before quiet hours rather than bypassing the cap.
- `[IMPLEMENTED]` The owner initially added August 9 rows with sending to begin on 2026-08-06, then directed one immediate August 9 batch on the evening of August 5. A strict `from_open_start='2026-08-09T04:00:00Z'` / `through_open_start='2026-08-10T04:00:00Z'` release sent 7 rows, safely skipped 2 duplicate-phone candidates, and was disabled immediately; all 7 received delivered callbacks and 33 eligible August 9 rows remained. The heartbeat stays inert overnight and resumes the August 8-first, then August 9 release at 8:00 AM ET on August 6; August 10 and later remain excluded.
- `[IMPLEMENTED]` On 2026-08-05, an owner-directed provider review found 34 accepted/queued outreach messages, 0 provider failures/undelivered messages, and 3 opt-outs in the prior seven days. The owner-directed immediate batches used the service-role-only override; the persistent production opt-out threshold remains unchanged.
- `[IMPLEMENTED]` The immediate release used 17 rolling-hour slots: 15 delivered, 1 remained sent at final verification, and 1 failed with Twilio 21614 because the destination was not a valid mobile number. No retry was attempted. All due eligible rows for open houses on August 5-7 were exhausted; the next pending queue begins August 8.

## 2026-07-17: Outreach future-event and brokerage enforcement

- `[IMPLEMENTED]` `send-agent-outreach` now selects only queue rows whose `open_start` is still in the future.
- `[IMPLEMENTED]` Brokerage-specific Twilio restrictions were retired by owner direction on 2026-07-17. When the operator is away, future eligible rows from any brokerage may use the configured automatic outreach provider.
- `[IMPLEMENTED]` On 2026-08-10, the remaining Douglas Elliman provider exception was removed from COMMAND counts/badges and `send-agent-outreach`. Live mode now holds every brokerage for manual sending; Away mode sends every eligible brokerage through the configured automatic provider.
- `[IMPLEMENTED]` COMMAND now separates master sender status, the active delivery route (`Twilio toll-free` or `Android SMS Gateway fallback`), and operator handling (`At desk / manual` or `Away / automatic`). The sender diagnostic supplies the actual configured route so the UI does not infer provider behavior from brokerage or operator mode.
- `[IMPLEMENTED]` Existing opt-out health gates and hard caps remain unchanged; this correction does not override sender-health suppression.
- `[IMPLEMENTED]` Initial outreach now asks agents to reply `Y` to book support or `N` for another time while retaining the required `STOP to unsubscribe` instruction.
- `[IMPLEMENTED]` Twilio inbound outreach replies recognize exact `Y`/`YES` and `N`/`NO` responses. Y marks the thread interested and confirms a follow-up call; N marks it `not_now` and sends the NMB Hard Loans contact positioning. Both automatic responses are mirrored into the outreach thread and may omit the repeated STOP footer because the initial outreach already carried the disclosure; suppression remains enforced.
- `[IMPLEMENTED]` Outreach sender hard ceilings now support the owner-approved 20/hour and 150/day production values; they were activated on 2026-08-05.

This file tracks what is currently implemented, partial, intended, risky, or still needs verification. It should be updated after production-flow changes. `AGENTS.md` is the Codex operating guide; `REL8TION_SYSTEM_OVERVIEW.md` is the human architecture/product overview.

Status labels used in this file:

- `[IMPLEMENTED]` means code exists in the repo. It does not guarantee that the feature is deployed, live, passing RLS, or working with current Supabase production data.
- `[PARTIAL]` means some code exists, but the complete product behavior is not built or not fully wired.
- `[INTENDED]` means this is a REL8TION business/product rule or target architecture, not proof of current implementation.
- `[NEEDS VERIFICATION]` means the repo is not enough to prove live behavior, deployment, schema, RLS, or external service state.
- `[RISK]` means this can break demos, production data, security, SMS, or user trust if handled casually.

## DO THIS NEXT

- `[NEEDS VERIFICATION]` Verify production routes after deploy.
- `[NEEDS VERIFICATION]` Test `/k` NFC routing priorities.
- `[NEEDS VERIFICATION]` Test Event Pass activation and Sponsored Event Pass consent.
- `[NEEDS VERIFICATION]` Test LO Coverage Sign setup/activation.
- `[NEEDS VERIFICATION]` Test `/event` buyer check-in, disclosures, SMS, and financing-help opt-in.
- `[NEEDS VERIFICATION]` Test Agent Dashboard and Loan Officer Dashboard visibility.
- `[NEEDS VERIFICATION]` Test `/admin/agent-ranking` after Vercel deploy.
- `[NEEDS VERIFICATION]` Verify Supabase migrations, RLS, and env vars.

## Current Code Anchor

- `[IMPLEMENTED]` Production is configured to deploy from `main` through Vercel Git production branch automation.
- `[NEEDS VERIFICATION]` Exact live SHA and aliases should be verified with Vercel inspection before making live claims.
- `[IMPLEMENTED]` `staging` exists as the preview/staging branch.
- `[IMPLEMENTED]` The older direct deploy from `modular-claim-test` commit `51d2d1a` is historical only and preserved as tag `production-51d2d1a-2026-05-08`.
- `[IMPLEMENTED]` Root `vercel.json` currently contains app rewrites, API rewrites, and cron entries including refresh/open-house data, outreach generation, mockup rendering, outreach sending, and Android inbox replay.
- `[NEEDS VERIFICATION]` Root cron entries in code do not prove Vercel Cron execution, env vars, or production data effects.
- `[IMPLEMENTED]` Route guard scripts exist: run `npm run verify:routes` before route/API changes and `npm run verify:production-routes` after deployment.

## Current Product Rules

- `[INTENDED]` Event Pass is B2B open-house technology, not lead selling or referral purchasing.
- `[IMPLEMENTED]` Sponsored Event Pass requires per-event host-agent consent before sponsor visibility.
- `[IMPLEMENTED]` Loan Officer Coverage Signs stay with the loan officer and are separate from Sponsored Event Passes.
- `[INTENDED]` Buyer financing help is opt-in only when the buyer explicitly requests it.
- `[INTENDED]` Rel8tion does not collect borrower application data, SSN, income, assets, credit, borrower documents, or loan documents.
- `[IMPLEMENTED]` `/k` is the universal NFC router and its routing priority is critical.
- `[IMPLEMENTED]` Printed Event Pass QR source of truth is `smart_sign_inventory.public_code`.
- `[IMPLEMENTED]` `open_house_events.host_agent_slug` is the current event host field.
- `[IMPLEMENTED 2026-08-16]` Normal Event Pass activation now calls `/api/event-pass/action`; the server derives the host from the claimed keychain, requires a verified `open_houses` row, and authorizes only the listing agent or an existing same-brokerage agent who explicitly confirms they are substituting for the absent listing agent. Sponsored Event Pass activation applies the same listing/company rule before event creation. The pass sign and inventory are locked to the authorized host agent, and the event records the authorization basis.
- `[IMPLEMENTED 2026-08-16]` Every newly registered Event Pass open house attempts an event-idempotent owner email to `OPEN_HOUSE_REGISTRATION_NOTIFICATION_EMAIL` or the existing booking-calendar notification recipient using the configured REL8TION SMTP account, with Resend fallback. Sent/failed delivery state is retained in `open_house_events.setup_context`; notification failure does not delete the valid event.
- `[IMPLEMENTED 2026-08-16]` `20260816235025_enforce_event_pass_host_authorization.sql` was applied to the linked production project. The trigger and hardened function permissions were read back; the security advisor reports no warning for the new functions. The pre-existing project-wide advisor still reports that `open_house_events` does not have RLS enabled.
- `[NEEDS VERIFICATION]` Confirm the first real Event Pass registration email reaches `jared@rel8tion.me`; no fake registration was created for an email smoke test.
- `[RISK]` Root wrapper files and app files are not identical.

## Active Route State

- `[IMPLEMENTED]` `/k` routes NFC scans for keychains, front sign chips, rear sign chips, reset scans, pending sign activation, Event Pass flows, Loan Officer Coverage Sign flows, loan officer tags, backup keychains, and normal claimed agent keychains.
- `[IMPLEMENTED]` `/claim` claims a Rel8tionChip/keychain into an agent identity. Event Pass profile completion must not show or process the public-profile keychain QR field.
- `[IMPLEMENTED]` `/onboarding` is the post-claim agent setup page and includes smart sign activation entry points plus backup-keychain setup.
- `[IMPLEMENTED]` `/agent-home` is the permanent owner dashboard for claimed normal agent NFC scans and paid, idle Event Pass Rel8tionChips. Public/share profile behavior stays on `/b?agent=<slug>`.
- `[IMPLEMENTED]` `/sign-demo-activate` is the smart sign setup and listing binding flow.
- `[IMPLEMENTED]` `/s` and `/sign` resolve smart sign public codes and route to activation or live event state.
- `[IMPLEMENTED]` `/pass` resolves printed Event Pass QR inventory from `smart_sign_inventory.public_code`.
- `[IMPLEMENTED]` `/sponsored-pass-activate` activates reusable Sponsored Event Passes and records per-event agent consent before sponsor visibility.
- `[IMPLEMENTED 2026-08-16]` Event Pass confirmation controls remain fixed at the bottom of small mobile viewports while the agent confirms same-brokerage substitute status when applicable. Normal and Sponsored Event Pass controls were browser-verified at 320×568 with the checkboxes and activation buttons fully visible and no page errors.
- `[IMPLEMENTED]` `/lo-sign`, `/lo-sign-setup`, and `/lo-sign-activate` support Loan Officer Coverage Sign setup, activation, and live routing.
- `[IMPLEMENTED]` `/event` is the buyer smart sign check-in page with guided disclosures, optional financing-help routing, and SMS after local validation.
- `[IMPLEMENTED]` `/event-chat` is the buyer return chat page for dashboard-triggered SMS links.
- `[IMPLEMENTED]` `/agent-dashboard` is the live event dashboard for the host agent.
- `[PARTIAL]` `/loan-officer-dashboard` is the clean LO operations alias; `/lo-field-dashboard` remains a backward-compatible alias.
- `[IMPLEMENTED 2026-07-26]` The loan-officer dashboard's mobile section menu appears at the top of the dashboard and remains sticky while scrolling instead of occupying the bottom of the viewport.
- `[PARTIAL]` `/nmb-activate` and `/nmb-verified` are loan officer tag/profile pages. Formal remote LO coverage management is not built.
- `[IMPLEMENTED]` `/c/:code` and `/chip/:code` resolve printed Rel8tionChip QR inventory.
- `[IMPLEMENTED]` `/a` redirects legacy/public profile traffic to `/b`.
- `[IMPLEMENTED]` `/b` is the public agent profile and lead capture path.
- `[IMPLEMENTED]` `/get-open-house-kit`, `/kit-confirm`, and `/kit-intake` support the Complete REL8TION Open House System landing, NFC/keychain prefill, company-branding intake, shipping intake, and Stripe Checkout handoff. Event Pass checkout arming still canonicalizes to the programmed NFC origin (`irel8.me`) before setting browser state. Pricing, trials, renewals, features, entitlements, and Stripe lookup keys now come from `config/pricing-catalog.json` through `/api/public/pricing`; public pages do not fall back to embedded amounts.
- `[IMPLEMENTED]` Public plan selection is payment-first: the pricing page and WordPress handoff create Stripe Checkout before asking for profile, company-branding, shipping, or setup details. Those details move to secured post-payment onboarding; keychain-prefill remains available for field-linked flows.
- `[PARTIAL]` Catalog-coded Stripe Checkout sessions are wired to upsert `pricing_entitlements` through the existing signed Stripe webhook. Paying-agent Event Pass checkout also performs an idempotent, server-verified browser-return upsert so access is immediate when the customer returns; the webhook remains required for reliable fulfillment and subscription lifecycle changes. On 2026-08-02, `20260802100949_pricing_entitlements.sql` was applied to the linked production project and verified with forced RLS, the expected indexes, and no `anon`/`authenticated` table grants. The canonical live Stripe Products, default Prices, and seven lookup keys were synchronized and amount/interval verified; the replaced $249.99 kit Price was deactivated. On 2026-08-17, the live Stripe webhook endpoint was created for the seven supported checkout/subscription/invoice events and its rotated signing secret was installed in Vercel Production; designated signed event delivery remains `[NEEDS VERIFICATION]`.
- `[IMPLEMENTED]` `/book-a-call` is the REL8TION-owned private consultation calendar for loan officers and for real estate brokers/teams seeking volume discounts. It publishes 30-minute weekday appointments from 10:00 AM–5:00 PM Eastern with 24-hour notice, collects contact/company context, and sends `.ics` invitations to the visitor and `jared@rel8tion.me` through the existing REL8TION SMTP account, with Resend retained as a fallback provider.
- `[IMPLEMENTED]` Booking reservations use the service-only `rel8tion_call_bookings` ledger defined by `supabase/migrations/20260802140923_rel8tion_call_bookings.sql`. On 2026-08-02, the migration was applied to the linked production project and verified with forced RLS, the confirmed-slot unique index, and no `anon`/`authenticated` table grants. Production Vercel SMTP variables and a sensitive booking IP-hash secret are configured. The production calendar and availability route are verified; a designated real-delivery smoke test remains `[NEEDS VERIFICATION]`.
- `[PARTIAL]` `/loan-officer-support` is the public loan-officer registration application and stores submissions for review in REL8TION COMMAND. Admins can approve a new application into an active verified profile; approval sends the applicant an activation SMS and attempts an idempotent Resend email. Missing email configuration is non-fatal and displayed in the admin result. Authenticated account ownership remains to be built.
- `[PARTIAL]` `/key-reset` is a token-protected admin/beta reset utility, not a full admin dashboard.
- `[PARTIAL]` `/admin` is REL8TION COMMAND. It supports important operational workflows, including a Buyer Finder area that calls `/api/admin/buyer-home-finder` with admin credentials to filter, sort, search, and generate printable buyer reports from upcoming `open_houses`, `agent_outreach_queue`, and matched `listing_agents` records. Broader CRM edits, sign inventory edits, LO calendar/availability edits, billing automation, and full project controls are not complete.
- `[IMPLEMENTED]` Confirmed outreach open houses stored as scheduled `field_demo_visits` can be assigned or reassigned to an active loan officer directly from REL8TION COMMAND's Accepted Open Houses table, even before an active `open_house_events` row exists.
- `[IMPLEMENTED]` The Confirm Open House date picker includes an optional LO dropdown, and the confirmed Reports card keeps an Assign LO/Change LO control so coverage can be added or corrected later.
- `[IMPLEMENTED]` Source for the private Rel8tionOS server API is under `/api/rel8tionos/*`. It provides authenticated health, linked outreach threads/message history, manual reply, Open House acceptance, active loan-officer listing, and live loan-officer assignment endpoints. Thread projections include `agent.photo_url` from `agent_outreach_queue.agent_photo_url` for Rel8tionOS portraits. It reuses REL8TION's existing send and assignment workflows so opt-out, suppression, provider routing, and quiet-hour enforcement remain centralized. See `docs/rel8tionos-api.md`.
- `[NEEDS VERIFICATION]` Rel8tionOS is not connected until the correct Rel8tionOS Vercel project is identified, the same sensitive server credential is installed on both applications, both applications are redeployed, and authenticated production reads are verified.
- `[PARTIAL]` `/admin/agent-ranking` is an admin-only Agent Ranking / Production Intelligence module for permitted ListReports-style CSV imports, opportunity scoring, county/location tagging, open-house matching, server-side sorting/filtering/pagination, clickable agent profile drill-down, printable/copyable agent-facing marketing reports, and manual outreach staging. It supports ListReports fields including `agent_name`, `agent_company`, `agent_phone`, `listings_active_total`, `listings_days_since_last`, `listings_active_last_12_months`, `buyside_last_90_days`, and `buyside_last_12_months`, plus location columns such as county, market, city, state, and ZIP. The dashboard view gates displayed rows to trusted ListReports mappings with `identity_key` and phone present and retains a defensive display-dedupe pass. Ranking uniqueness is `identity_key = import:{normalized_agent_name}|{normalized_brokerage}|{normalized_phone}` so county/market reports update one current ranking while different agents sharing an office phone remain separate. On 2026-07-03, blank server-side numeric filter values were fixed to mean "no limit" instead of `0`, market filters were canonicalized so `Lng Island`/encoded geometry values cannot split campaign buckets, stale browser filter responses are ignored, admin ranking reads now page through Supabase in 1,000-row chunks instead of trusting a single capped REST response, and filter edits now stay in a local draft until the admin clicks Apply/Search so typing in search fields does not query the database per keystroke. Area comparison now returns peer rank context, including opportunity-score rank and metric ranks, so the Marketing Report modal can show where an agent ranks in their county/market and can be copied or printed/saved as PDF for outreach or in-person marketing. Pitch copy now uses safe county/market labels and actual profile metrics such as active listings, listing-side 12m, buyside 90d/12m, days since last listing, and matched open-house counts; encoded geometry strings are blocked from pitch text. The profile modal now loads matched `open_houses`/`listing_agents` records, the best available listing-agent photo, a large Rel8tion grade, image-backed prestige/status badges for Rising Star, Shooting Star, All-Star, and Rock Star based on active-listing/listing-side/buyer-side peer multiples, and a plain-English county/market opportunity story. The profile modal is a full-width single-column profile view, while recommended pitch copy and generated pitch variants live only in the separate Pitch Studio modal. Confirm import uses the fast ListReports scoring/upsert path and defers deep open-house matching to profile drill-down or explicit refresh so large uploads do not time out. XLS/XLSX parsing, manual low-confidence match review, and authenticated end-to-end upload testing remain `[NEEDS VERIFICATION]`.

## NFC, Sign, Event Pass, And QR State

- `[IMPLEMENTED]` Front smart sign NFC is the buyer/check-in side and is stored as `uid_primary` with `primary_device_type = front_buyer_chip`.
- `[IMPLEMENTED]` Rear smart sign NFC is the agent/dashboard challenge side and is stored as `uid_secondary` with `secondary_device_type = rear_agent_chip`.
- `[IMPLEMENTED]` Rear sign scan requires an agent keychain challenge before dashboard access.
- `[IMPLEMENTED]` Agent sign activation requires the keychain handshake.
- `[IMPLEMENTED]` A live smart sign is designed to attach to one active `open_house_events` row at a time.
- `[IMPLEMENTED]` Smart Sign and Event Pass may both be active for the same listing/open-house context because routing is device/sign-aware rather than listing-blocked.
- `[IMPLEMENTED]` Sponsored Event Pass activation GPS search includes the `20260531-eventpass-gps-search` focused near-me/today fallback.
- `[IMPLEMENTED]` Normal Event Passes are reusable. Only a currently active event blocks reassignment; historical ended events are preserved without creating a one-time-use lock. Paid idle passes return to Rel8tionChip mode between events.
- `[IMPLEMENTED]` Loan Officer Coverage Sign activation uses a QR-only backing `smart_signs` row with a deterministic synthetic `uid_primary` so the current schema does not require a buyer NFC chip.
- `[IMPLEMENTED]` Printed agent Rel8tionChip QR rows redirect to `/b?agent=<slug>` when linked. NFC remains private owner access.
- `[IMPLEMENTED]` Printed loan-officer QR rows redirect to `/nmb-verified?slug=<lo_slug>` when linked. NFC remains private LO dashboard access.
- `[RISK]` Do not use `smart_signs.public_code` for new QR printing. It may exist only as a legacy smart-sign fallback.

## Buyer Check-In, Disclosures, And Financing

- `[IMPLEMENTED]` `/event` stores buyer check-ins in `event_checkins`.
- `[IMPLEMENTED]` `/event` requires guided NYS/Rel8tion disclosure completion before check-in completion and SMS side effects.
- `[IMPLEMENTED]` Signed disclosure packet generation exists through `api/compliance/ny-disclosure.js`.
- `[NEEDS VERIFICATION]` Signed disclosure PDF storage requires live Supabase Storage bucket and service-role env verification.
- `[IMPLEMENTED]` Buyer financing help is only routed when the buyer explicitly requests it. `pre_approved=false` alone is not enough to send financing outreach.
- `[IMPLEMENTED]` Buyer affordability/property-fit scenarios include annual property taxes and annual homeowners insurance as property expense fields, not borrower application data.
- `[PARTIAL]` `/b` saves buyer profile leads into `leads`; `/event` saves event attendance/check-ins into `event_checkins`. Treat `leads` as the global CRM/person path and `event_checkins` as event-specific attendance/action records until fully unified.

## Open House Kit And Website Promo

- `[PARTIAL]` `/get-open-house-kit`, `/kit-confirm`, `/kit-intake`, and `/api/checkout/open-house-kit` support Open House Kit acquisition, Event Pass keychain prefill, manual intake, and Stripe Checkout handoff.
- `[IMPLEMENTED]` Open House System Checkout now reads standard approved pricing, renewal, trial, and entitlement rules from `config/pricing-catalog.json`; expiring Summer promotion claims and checkout-created Website Builder promotion codes have been retired.
- `[IMPLEMENTED]` `/api/checkout/stripe-webhook` verifies signed Stripe Checkout webhooks and upserts eligible Open House Kit Checkout Sessions into `open_house_kit_orders` for fulfillment review.
- `[IMPLEMENTED]` Successful Open House Kit Stripe returns request `/api/checkout/website-promo` with a Checkout Session id to show a deterministic website-builder promo code for `https://my.rel8tion.me`, verify the paid Stripe session, upsert `open_house_kit_orders`, create a secure `/kit-dashboard` access token, and redirect the buyer into the Open House Kit dashboard as a browser-return fallback before the webhook is configured.
- `[IMPLEMENTED]` `/kit-dashboard` is the post-payment Open House Kit workspace. It loads through `/api/kit/dashboard`, lets the buyer choose from seeded company logos or upload a custom logo into the `open-house-kit-logos` Supabase Storage bucket, records logo status on `open_house_kit_orders`, and supports password setup plus browser/device-lock registration state. Eligible catalog-based orders expose their included Digital You entitlement and onboarding link from persisted Stripe metadata.
- `[IMPLEMENTED]` Post-payment welcome email/SMS orchestration exists in `lib/open-house-kit.js` and is called from both the Stripe webhook and paid browser-return path. Sends are logged in `open_house_kit_notifications`; dashboard links use hashed rows in `open_house_kit_access_tokens`. SMS uses the existing `send-lead-sms` Edge Function and route-scoped SMS provider secrets.
- `[NEEDS VERIFICATION]` Live Stripe webhook endpoint configuration, `STRIPE_WEBHOOK_SECRET` or `STRIPE_OPEN_HOUSE_KIT_WEBHOOK_SECRET`, `RESEND_API_KEY`/verified from-address, product pricing, and real provider delivery need verification before treating checkout messaging as fully automated.

## Agent Website Builder

### 2026-07-21 agent Auth and route unification

- `[IMPLEMENTED]` The agent website builder now has one canonical Auth contract: portal `https://my.rel8tion.me`, login `/agent/login`, one-time callback `/auth/callback`, dashboard `/agent/dashboard`, and recovery API `/api/agent/access-link`.
- `[IMPLEMENTED]` Browser, server, proxy/middleware, admin, storage, promo, and cron clients now resolve agent-builder data/Auth through Supabase project `nicanqrfqlbnlmnoernb` using the project-specific `REL8TION_SUPABASE_*` namespace. Generic Vercel Supabase integration variables no longer override those clients.
- `[IMPLEMENTED]` SMS account setup/recovery uses the saved `agent_websites.phone`, returns a generic anti-enumeration response, rate-limits repeat sends, generates invite or recovery tokens server-side, and sends only a REL8TION-owned `https://my.rel8tion.me/auth/callback?token_hash=...` URL. It does not send Supabase's generated `action_link`.
- `[IMPLEMENTED]` The callback accepts PKCE `code` links plus hashed `invite`, `recovery`, `magiclink`, and `email` OTP links, establishes the Supabase session, and canonicalizes success/error navigation to `my.rel8tion.me` outside localhost development.
- `[IMPLEMENTED]` Supabase Edge Function `send-lead-sms` was deployed to `nicanqrfqlbnlmnoernb`. Vercel production variables `REL8TION_SUPABASE_URL`, `REL8TION_SUPABASE_ANON_KEY`, and sensitive production-only `REL8TION_SUPABASE_SERVICE_ROLE_KEY` were aligned to that project; the audit branch preview has branch-scoped equivalents.
- `[IMPLEMENTED]` Vercel preview and production checks passed on 2026-07-21: login 200; unauthenticated dashboard 307 to `/agent/login`; incomplete callback 307 to `https://my.rel8tion.me/agent/login?...`; fake-email recovery 200 with generic response.
- `[IMPLEMENTED]` Lisa Luttinger's replacement recovery SMS was queued through Twilio at 2026-07-21 15:50 Eastern. The logged URL host is `my.rel8tion.me`, path `/auth/callback`, and contains no `localhost`; the one-time token was not printed or documented.
- `[IMPLEMENTED]` Website-builder Git branch `codex/agent-auth-route-audit` contains code commit `0998c82` and explicit environment rebuild commit `0a24d41`. The verified `0a24d41` artifact was promoted to production and then fast-forwarded to the website-builder `main` branch. Pre-existing uncommitted site-design files were not included in either commit.

### 2026-07-21 guided agent image cropping

- `[IMPLEMENTED]` Agent dashboard image selection now opens a visual crop dialog before uploading to Supabase Storage. Agents can reposition horizontally and vertically, zoom, preview the exact output, and then upload the generated JPEG.
- `[IMPLEMENTED]` Upload guidance and output dimensions match the live template: headshot 4:5 at 1200×1500, homepage hero 16:9 at 1920×1080, About image 4:5 at 1200×1500, and gallery image 4:3 at 1600×1200.
- `[IMPLEMENTED]` Website-builder commit `1293366` contains only the reusable crop component and the shared site editor integration; unrelated uncommitted design and rate-consultation work remains outside the commit.
- `[NEEDS VERIFICATION]` Full local production build remains blocked by pre-existing missing local `nodemailer`/`sharp` installations and unavailable Google Font downloads. The changed crop files produced no focused TypeScript errors.

### 2026-07-21 public site visual and rate-lead restoration

- `[IMPLEMENTED]` Website-builder commit `97b418c` restored the preserved public-site refresh: branded calculator gradient, reduced section spacing, non-invented fallback trust band when an agent has no testimonials, and a visually alternating transition into Contact instead of a continuous white region.
- `[IMPLEMENTED]` The calculator again displays `Check today's rate` at the section heading and beside the interest-rate input. Its private request dialog requires name, phone, and email and submits through `/api/contact` as `rate_consultation`.
- `[IMPLEMENTED]` Rate-consultation email delivery selects `RATE_LEAD_NOTIFICATION_EMAIL` before the general lead fallback; the production variable was verified as configured for Jared's masked `jf***@nmbnow.com` recipient.
- `[IMPLEMENTED]` Commit `97b418c` was pushed to the website-builder audit branch and fast-forwarded to `main`; Vercel production deployment `dpl_GsdJP9j4Z6CZuGzWrcumAdvNNVYD` reached Ready and owns `my.rel8tion.me`, `llsellsny.com`, and the other agent-domain aliases.
- `[NEEDS VERIFICATION]` This workstation resolves `llsellsny.com` and `www.llsellsny.com` to `0.0.0.0`, preventing a direct custom-domain capture. The public canonical production route `/ll` returned 200 and included the rate control; custom-domain DNS should be checked from a normal external resolver/device.

### 2026-07-21 Lisa Luttinger Neptune listing correction

- `[IMPLEMENTED]` Lisa's `703 Neptune Blvd, Long Beach, NY 11561` record (OneKey MLS `971018`, website-listing id `1e34f054-d25b-480e-b4ed-5a9138fbd81a`) now displays Pending, $1,350,000, 5 beds, 3.5 baths, 3,128 sqft, 5,000 sqft lot, built 2006, $18,321 annual taxes, $432/sqft, $0 HOA, and Single Family Residence.
- `[IMPLEMENTED]` Current status and price were cross-checked on 2026-07-21 against OneKey-derived Redfin and Realtor.com pages; both report Pending effective 2026-06-26 at $1,350,000.
- `[RISK]` The source scraper snapshot attached to this row is from 2026-05-09 and still reports Active/$1,399,998. It reverted the first manual correction during this audit, proving that a database-only fix was not durable.
- `[IMPLEMENTED]` Website-builder commits `fc35ad4` and `54cbcf9` add an explicit allowlisted `metadata.manual_listing_override` merge path for verified stale-feed exceptions, including top-level listing fields plus `price_per_sqft` and `hoa_monthly`. The override is installed only on Neptune.
- `[IMPLEMENTED]` A real production sync was run after deployment: it wrote both Lisa listings with no errors, and Neptune remained Pending at $1,350,000 afterward through both direct Supabase readback and the live `/api/agent-listings` response.

- `[PARTIAL]` `apps/agent-website-builder` contains the separate Next.js website-builder app formerly known as `v0-real-estate-agent-template`.
- `[IMPLEMENTED]` Vercel project `v0-real-estate-agent-template` has been used for `https://my.rel8tion.me` and custom agent domains.
- `[IMPLEMENTED]` Website records live in `agent_websites`; site-owned listing records live in `agent_website_listings`.
- `[IMPLEMENTED]` REL8TION COMMAND Agent CRM loads `agent_websites` and provides an admin-authorized website editor for core profile, contact, biography, imagery, and social fields through `/api/admin/website-action`.
- `[INTENDED]` Public agent sites should use `agent_website_listings` for agent-owned listings and should not republish broader `open_houses` inventory as MLS listing display.
- `[IMPLEMENTED]` Public agent sites include hero/headshot/about/gallery slots, agent-owned listings, listing details, contact forms, testimonials, mortgage calculator, and AI Studio surfaces.
- `[PARTIAL]` AI Studio includes preset-only headshot, listing staging, and AutoReel-style social video tooling.
- `[NEEDS VERIFICATION]` AutoReel quality, readable branding, voiceover pacing, and OpenAI/Sora job visibility should be verified against current production logs and generated outputs.
- `[NEEDS VERIFICATION]` Current git tracking state for the website-builder folder must be checked before assuming all builder changes are committed.

## Listing, Enrichment, And Freshness

- `[PARTIAL]` Estately/Cheerio enrichment source exists in `estately-enrichment-worker.cjs` and `api/cron/enrich-agents.js`.
- `[PARTIAL]` OneKey listing freshness source exists in `onekey-freshness-worker.cjs` and `api/cron/refresh-open-house-data.js`.
- `[NEEDS VERIFICATION]` Browserless/Trulia enrichment source was not found in tracked source during the repo audit. If that source is intended, it needs implementation or source recovery.
- `[NEEDS VERIFICATION]` Live cron execution, RLS/write access, and data quality need verification before relying on automatic enrichment in production.
- `[RISK]` Enrichment can populate bad office numbers, stale listing facts, or wrong agent associations if parsing/validation is loose.

## Outreach And SMS

- `[PARTIAL]` `send-lead-sms` local source exists at `supabase/functions/send-lead-sms/index.ts` and uses the shared server-side SMS provider layer.
- `[NEEDS VERIFICATION]` Deployed `send-lead-sms` source/version, provider env, and live delivery behavior still need Supabase/provider verification.
- `[IMPLEMENTED]` Outreach delivery-status storage exists through `agent_outreach_queue` delivery fields, `agent_outreach_delivery_events`, and the `twilio-message-status` callback function.
- `[PARTIAL]` Android SMS Gateway is used as a temporary outreach-volume fallback while preserving Twilio paths.
- `[IMPLEMENTED]` The shared SMS layer supports route-scoped provider env vars: `SMS_OUTREACH_PROVIDER` for outreach/manual outreach and `SMS_EVENTS_PROVIDER` for buyer/event/owner operational traffic. Both fall back to `SMS_PROVIDER`.
- `[IMPLEMENTED]` Production outreach is split by route: outreach uses toll-free Twilio `+18448211802` through Messaging Service `MG8d7ec49cf1d6d231080b7f870a10eb0b`; event/check-in/owner/system traffic stays on regular Twilio `+15168885461`. Android Gateway is retained as a fallback.
- `[IMPLEMENTED]` Runtime outreach operator mode is stored in `rel8tion_runtime_settings`; `live` holds eligible non-override rows for manual sending and `away` uses the configured automatic provider. REL8TION COMMAND labels the control `Away: auto` rather than assuming Android.
- `[IMPLEMENTED]` Root cron code includes outreach generation and send endpoints. The Vercel cron and `send-agent-outreach` Edge Function enforce the owner-approved ceilings of 7 per run, 20 per rolling hour, and 150 per rolling 24 hours. Automatic initial sends do not require `approved_for_send=true`; eligible rows are `send_mode=automatic`, generated, rendered, due, with a listing photo and pending initial SMS copy.
- `[IMPLEMENTED]` `send-agent-outreach` supports a global runtime pause through `rel8tion_runtime_settings.key='outreach_send_paused'` or `OUTREACH_SEND_PAUSED=true`. When enabled, live runs return `paused=true` and send no outreach messages, even if cron fires and rows are due; authenticated dry runs can still inspect candidate routing and copy.
- `[IMPLEMENTED]` `generate-agent-outreach` reads the same outreach send pause and stages newly generated outreach as `send_mode=manual`, `review_status=manual_ready` while pause/recovery mode is active, so new rows land in the cell-send queue instead of automatic.
- `[IMPLEMENTED]` As of 2026-06-28, outreach follow-up/drip scheduling is disabled while opt-out health is recovered. Pending live follow-ups were marked `followup_send_status=not_scheduled`, `followup_send_at=null`, `followup_sms=null`, `followup_sms_link=null`, and `followup_block_reason=followups_disabled`; the generator and sender keep future follow-ups unscheduled until this is intentionally re-enabled.
- `[IMPLEMENTED]` REL8TION COMMAND surfaces generated/rendered due outreach rows as Twilio ready, Manual ready, or Auto ready and can explicitly Pause cron/Resume cron by changing `send_mode`. Do not reintroduce a hidden approval gate for normal cron sends without owner confirmation.
- `[IMPLEMENTED]` `/manual-sms-outreach` is a protected static phone-send backup backed by `/api/manual-sms-outreach`. It opens the local SMS composer only, never sends through Twilio/Android itself, and manual-ready rows can include any brokerage, including Douglas Elliman.
- `[IMPLEMENTED]` `send-agent-manual-reply` supports a service-role/admin `provider_override` for owner-approved manual outreach, including Twilio one-off campaigns, while preserving initial-outreach STOP disclosure, suppression checks, delivery logging, and reply threading. Operator-composed replies omit the repeated STOP footer.
- `[IMPLEMENTED]` Rel8tionOS outbound replies require a stable idempotency key and pass through `send-agent-manual-reply`; the integration API does not bypass the global suppression list or outreach quiet-hour policy.
- `[IMPLEMENTED]` REL8TION COMMAND outreach health treats an empty inbound window as quiet/normal instead of a broken inbox; it still warns on unlinked raw rows and fails only when linked replies are missing from the inbox view.
- `[PARTIAL]` Agent Ranking / Production Intelligence can stage ranked agents into `agent_outreach_queue` with `source=agent_ranking`, `send_mode=manual`, `initial_send_status=not_queued`, and follow-ups disabled. This is a review queue action, not an automatic sender.
- `[IMPLEMENTED]` `docs/twilio-outreach-sms-runbook.md` is the durable Twilio outreach recovery/runbook document. Keep it in source control and update it whenever provider settings change.
- `[IMPLEMENTED]` On 2026-06-23, Twilio SMS was restored with `SMS_PROVIDER=twilio` and `TWILIO_PHONE=+15168885461` in live Supabase secrets. Outbound smoke test queued from `+15168885461`, inbound reply to that number saved into `agent_outreach_replies`, owner alert queued, and the matched outreach queue row moved to `review_status=replied`.
- `[IMPLEMENTED]` The shared SMS layer supports a dedicated Twilio outreach sender through `TWILIO_OUTREACH_MESSAGING_SERVICE_SID` or `TWILIO_OUTREACH_FROM_NUMBER`, with `TWILIO_EVENTS_FROM_NUMBER` for the regular operational number. When `SMS_OUTREACH_PROVIDER=twilio`, it requires the dedicated outreach sender and will not silently fall back to the regular event number.
- `[IMPLEMENTED]` SMS suppression is global across Android and Twilio and fails closed when suppression status cannot be verified. Twilio and Android inbound handlers recognize STOP-family keywords, exact START/UNSTOP removes application suppression, and a STOP updates matching outreach rows across the phone number.
- `[IMPLEMENTED]` Outreach safety recovery adds a default 30-day same-phone cooldown, a rolling 7-day opt-out health gate (minimum 20 sends, owner-approved 5% maximum as of 2026-08-10), a 7-day maximum age for missed-open-house outreach, and shorter permission-oriented initial copy. Initial MMS remains disabled by code default, but production `OUTREACH_INITIAL_MMS_ENABLED=true` was explicitly owner-approved on 2026-07-14 after the toll-free MMS route was verified. Each staged initial MMS attaches the generated outreach image first and the NMB business card second. Android remains text-SMS-only.
- `[IMPLEMENTED]` On 2026-07-14, Twilio Console showed toll-free registration complete for `+18448211802`; an owner-only MMS was delivered with SID `MM395033030537bb1de5b4b0b6489d7cdd`. Messaging Service `MG8d7ec49cf1d6d231080b7f870a10eb0b` was changed from the old ElevenLabs sender webhook to `Send a webhook` with the Rel8tion `twilio-inbound-router` URL for both primary and fallback POST handling.
- `[IMPLEMENTED]` The post-cutover inbound test was stored in `agent_outreach_replies` with SID `SM5bd0275785326ce95cfd9c4970070647`, linked to queue row `b674dd8f-99f1-40f7-9ec2-403634b3571c`, and produced an event-route owner alert with SID `SMc284b6659cb7b25c8c61e724b31231d8`. Runtime `outreach_send_paused` is now false with reason `toll_free_outreach_verified`; recovery caps are 5/run, 10/hour, and 25/day, with the rolling health gate still able to pause automatically.
- `[IMPLEMENTED]` Twilio inbound outreach numbers should use the public `twilio-inbound-router` Edge Function as the incoming-message webhook. The router is deployed without JWT verification for Twilio, then forwards inbound replies into the protected `twilio-inbound-reply` handler with service-role auth. Matched replies link to outreach queue rows using tolerant 10/11-digit phone matching; unmatched replies are still stored with `queue_row_id=null` instead of being dropped.
- `[RISK]` In Twilio Messaging Service inbound settings, choose `Send a webhook`; `Receive the message` does not call REL8TION and makes replies disappear from Supabase even though Twilio stores them.
- `[RISK]` Delivery status callback URLs must use `twilio-message-status?token=<TWILIO_STATUS_CALLBACK_TOKEN>` with `POST`; do not use the inbound router for delivery status, and do not commit the token value.
- `[RISK]` Outreach sends real messages and can spend money. Verify filters, quiet hours, opt-outs, provider state, and owner approval before changing send behavior.
- `[RISK]` Android SMS Gateway/Tracfone outreach can be carrier-flagged if messages are sent in bursts. Do not raise outreach send caps without explicit owner approval and a provider health check.
- `[RISK]` Twilio/A2P campaign state has previously been reported as suspended. Treat Twilio delivery as unreliable until provider status is verified.

## Supabase, Schema, And RLS

- `[IMPLEMENTED]` Repository migration `20260726193000_agent_relationship_stream.sql` defines canonical `agent_relationships`, append-only `agent_relationship_events`, source-table ingestion triggers, historical backfill, and the service-role-only `agent_board_v1` view.
- `[IMPLEMENTED]` `/api/admin/agent-relationships` provides authenticated board reads plus pin, unpin, note, and relationship-evidence synchronization actions without exposing the service-role key to the browser.
- `[IMPLEMENTED]` REL8TION COMMAND outreach and confirmed-open-house surfaces include `Pin to top` controls backed by the shared relationship API.
- `[IMPLEMENTED]` On 2026-07-26, migration `20260726193000_agent_relationship_stream.sql` was applied successfully to live Supabase project `nicanqrfqlbnlmnoernb`. A read-only audit found 2,651 relationship rows with 2,651 unique canonical keys, zero duplicate canonical-key groups, zero duplicate phone groups, and 5,444 relationship events with zero duplicate source-event groups.
- `[IMPLEMENTED]` One email is shared by two distinct phone identities in the source data. Pin matching therefore prioritizes canonical key and phone before email so the shared email cannot redirect a pin to the wrong agent.
- `[IMPLEMENTED]` Commit `0817386` deployed the relationship stream as `dpl_ChxWLDkbdytfdEap8vCSpFo6Gcfh`; commit `b7cdfce` then deployed dedicated REL8TION OS authentication as production deployment `dpl_F7K3Nkzt18iuxjwWQ1D7XoyfnKua`. Both deployments reached `READY`.
- `[IMPLEMENTED]` The dedicated authenticated production read returned 2,652 agents. The one-time REL8TION OS sync completed for 404 worked-with agents and one saved note with zero failures. A reversible live pin/read/unpin test synchronized in both directions, finished with zero pinned agents, and the saved note read back successfully.
- `[IMPLEMENTED]` Browser code uses the public anon key in app config and standalone pages.
- `[IMPLEMENTED]` Service-role serverless routes exist for Sponsored Event Pass, Loan Officer Coverage Sign, admin reset, admin actions, checkout, and selected privileged flows.
- `[NEEDS VERIFICATION]` Live RLS policy state is not fully confirmed.
- `[NEEDS VERIFICATION]` Live schema and repo migrations must be checked before frontend assumptions are changed.
- `[NEEDS VERIFICATION]` RPC definitions used by app code but not proven from checked-in SQL include `find_nearest_open_house`, `queue_recent_outreach_candidates`, `verified_profiles_lookup`, and `verified_profiles_activate_or_create`.
- `[PARTIAL]` Agent Ranking / Production Intelligence migration source exists for `agent_production_uploads`, `agent_production_import_rows`, and `agent_rankings`. On 2026-06-28, the linked Supabase schema was applied with RLS enabled, service-role-only policies, ListReports activity columns, catalog verification, and filtered advisor verification for the new objects. On 2026-06-30, the location/source/confidence and matched open-house counts/ids/timestamps migration was applied to linked Supabase and column verification passed. The 2026-07-26 canonical-identity migration consolidated the production current-ranking table to 12,524 unique rows, removed hidden legacy/bad-mapping derived rankings, preserved 114,153 raw import-history rows, added database-level identity canonicalization, and retained unique `agent_rankings.identity_key` enforcement.
- `[RISK]` `event_loan_officer_sessions` grants and policies should be verified before broad public use.

## Current High-Risk Areas

- `[RISK]` `/k` routing order.
- `[RISK]` Smart sign activation sessions, especially stale rows.
- `[RISK]` Real field signs, including historically protected Elena/Galluzzo sign data, must not be detached or reset without explicit approval.
- `[RISK]` The historical beta lane identifiers in `AGENTS.md` should be verified against live rows before demo/reset use.
- `[RISK]` `open_house_events.host_agent_slug` versus stale `agent_slug` assumptions.
- `[RISK]` Smart sign QR inventory linking through `smart_sign_inventory`.
- `[RISK]` Rel8tionChip QR inventory linking through `rel8tion_chip_inventory`.
- `[RISK]` Buyer check-in SMS side effects and financing opt-in.
- `[RISK]` Outreach queue filters, quiet hours, opt-outs, and provider fallback.
- `[RISK]` Signed disclosure PDF storage and legal/form-version review.
- `[RISK]` WordPress files are local tracking only and not synced to production.

## Verification Commands

General:

```powershell
git status --short
rg "pattern"
rg --files
```

Routes:

```powershell
npm run verify:routes
npm run verify:production-routes
npm run verify:agent-relationships
```

Static app:

```powershell
Set-Location apps/rel8tion-app
npm run dev
```

Mockup renderer:

```powershell
Set-Location apps/mockup-renderer
npm test
```

OneKey freshness dry-run:

```powershell
npm run refresh:onekey:dry-run -- --id=M00000489-971018
```

There is no confirmed full automated suite for the main static app. NFC/sign/Event Pass checks usually need manual route/state testing plus targeted Supabase row inspection.
### 2026-07-17 - Loan officer password accounts

- `[IMPLEMENTED]` Admin approval now sends a Supabase Auth invitation (or recovery email for an existing Auth user) to the approved loan officer email.
- `[IMPLEMENTED]` `/loan-officer` is the canonical loan officer account URL for password creation, password login, password reset, and authenticated dashboard access. The older `/loan-officer-account` URL remains compatible.
- `[NEEDS VERIFICATION]` Supabase Auth must allow `https://app.rel8tion.me/loan-officer` as an email redirect URL and its production email provider must deliver Auth invitations.
- `[IMPLEMENTED]` Loan officer registration requires a headshot, compresses it in the browser, stores it in the existing public `verified-assets` bucket through a server route, and carries the image into the approved verified profile.
- `[IMPLEMENTED]` After the first secure password setup, a loan officer can create a four-digit quick-unlock PIN stored as a salted hash on that phone. It is a device convenience lock, while the Supabase password remains the actual account credential and recovery path.
- `[IMPLEMENTED]` The loan officer dashboard is phone-first with a fixed thumb navigation bar, compact mobile cards/header, larger touch targets, 16px form controls, safe-area spacing, and horizontal overflow protection.

### 2026-07-26 - Loan officer dashboard duplicate and return-access fix

- `[IMPLEMENTED]` Loan-officer dashboard visits are collapsed by live event, outreach queue row, or exact listing/time identity before rendering. Separate historical visit rows for the same assigned open house no longer produce duplicate overview or Open Houses + Buyers cards.
- `[IMPLEMENTED]` The general field-visit create route reuses an existing non-cancelled visit with the same event, outreach queue row, or exact listing/time and reuses the same participant responsibility assignment. Repeated scheduling requests no longer create another active copy.
- `[IMPLEMENTED]` Returning loan-officer dashboard access requires a current browser-tab unlock marker created only after the account API validates a password, device-lock, or device-PIN unlock. A remembered Supabase session without a configured quick lock returns to password login instead of opening automatically.
- `[IMPLEMENTED]` Direct loan-officer-mode field-dashboard URLs no longer fall back to a public profile UID when signed identity validation fails. The dashboard also exposes an explicit local Sign Out action.
### 2026-07-17 - Editable loan officer identity and complete visit cards

- `[IMPLEMENTED]` Authenticated loan officers can edit name, login email, phone, company, title, and headshot from the dashboard Account section. Email changes synchronize the Supabase Auth login and verified profile.
- `[IMPLEMENTED]` REL8TION COMMAND shows loan officer photos and provides an Edit LO action for identity/contact/company changes. Admin email changes also send a fresh password setup/recovery email when an Auth user exists.
- `[IMPLEMENTED]` Loan officer dashboard headers show the profile image immediately left of the name and link to the separate public NMB verified profile so private assignments and buyer messages are not exposed.
- `[IMPLEMENTED]` Assigned open-house cards hydrate the stored outreach listing photo/address and display hosting-agent call, text, and email actions.
### 2026-07-17 - Loan officer password-reset API-key fix

- `[IMPLEMENTED]` `/loan-officer` now imports the shared public Supabase configuration instead of maintaining a shortened duplicate anon key that caused `Invalid API key` during password-reset requests.
### 2026-07-17 - Existing loan officer Auth bootstrap

- `[IMPLEMENTED]` `/loan-officer` no longer claims a password-reset email was sent for profiles that have no Supabase Auth user. The secure setup action matches an approved verified profile, creates the missing Auth identity or recovery link, and sends the one-time link through the saved mobile number.
- `[IMPLEMENTED]` Public account-access requests return generic results for unknown emails and suppress repeat SMS sends for five minutes.
- `[NEEDS VERIFICATION]` Custom SMTP/Resend is not configured in production, so account setup currently uses the verified mobile number instead of email delivery.

### 2026-07-17 - Do not repeat STOP disclosure after Y/N reply

- `[IMPLEMENTED]` Initial automated outreach still requires the Y/N/STOP disclosure. Automatic confirmation messages sent in direct response to an inbound Y or N no longer repeat the STOP sentence.
- `[IMPLEMENTED]` The shared SMS provider only allows this omission when the caller explicitly marks a recent-inbound reply with `omit_repeated_stop_disclosure`; suppression checks and STOP keyword handling remain unchanged.
### 2026-07-17 - Production-safe loan officer verification links

- `[IMPLEMENTED]` Account-access SMS no longer forwards Supabase's generated action URL or depends on the project's current Auth Site URL. The server extracts the one-time token hash and creates an `https://app.rel8tion.me/loan-officer` link.
- `[IMPLEMENTED]` The account page verifies invite/recovery token hashes directly with Supabase Auth, removes the token from browser history, and opens password creation.
- `[IMPLEMENTED]` A recent erroneous localhost account link does not trigger the normal five-minute duplicate suppression, allowing an immediate corrected replacement.
- `[IMPLEMENTED]` Loan officer password/setup links and registration approval notices are transactional account messages and do not append outreach opt-out copy. Initial cold agent outreach retains its required Y/N/STOP disclosure.
### 2026-07-17 loan-officer duplicate identity dashboard hotfix

- The signed-in loan-officer dashboard now treats active verified profiles sharing the authenticated email as one account identity for assigned open-house history. This preserves older assignments when an existing loan officer registers again and a second profile row is created.
- The canonical field-dashboard wrapper now preserves query parameters and hashes without a competing zero-second meta refresh, so mobile Open Houses, Buyers, Profile, Availability, and My Agents navigation opens the selected section.
- Existing listing-photo URLs continue to resolve from the assigned outreach queue; the identity fix makes those assigned cards visible to the correct signed-in account.
- Password-link resend throttling now runs before Supabase generates a replacement token. A suppressed retry can no longer invalidate the usable link that was already texted; after 30 seconds, an explicit retry generates and sends a fresh link.
- Loan-officer overview cards now display the resolved listing photo and street address, matching the full Open Houses + Buyers cards. Jared's active legacy profile was relinked to the valid headshot retained by his duplicate registration record.
- `[IMPLEMENTED 2026-07-17]` The loan-officer Profile section includes a mobile-friendly Event Pass activation guide with a three-step field summary and a full-size copy of the supplied `Scan. Tap. Activate.` guide. The guide asset lives with the app so it is available to every signed-in loan officer.
- `[IMPLEMENTED 2026-07-18]` Event Pass activation uses a dedicated mobile `Find My Open House` screen before agent confirmation. Location permission is requested only after the user taps the single locate button, and the screen explains how to enable Safari location access on iPhone when the prompt does not appear. After the user confirms the open house, selects themselves, verifies their information, and submits, the selected listing is carried forward and the Event Pass activates immediately without a second GPS or listing-confirmation step.
- `[IMPLEMENTED 2026-07-17]` `/loan-officer-event-pass-guide` is the verified Event Pass training document. It replaces the outdated 15-second check-in claim with the actual disclosure sequence and states that financing alerts require buyer opt-in.
- `[IMPLEMENTED 2026-07-17]` The loan-officer profile header exposes the Event Pass instructions directly. The guide explains the live buyer-request response workflow, and the LO dashboard counts and highlights financing follow-up only for explicit `metadata.financing_requested=true` opt-ins rather than treating every non-pre-approved buyer as a request.
- `[IMPLEMENTED 2026-07-18]` Upcoming loan-officer open-house cards include a mobile Directions action that opens Apple Maps on Apple devices and Google Maps elsewhere with the listing address as the driving destination.
- `[IMPLEMENTED 2026-07-18]` The Event Pass QR-to-NFC handoff replaces technical code/chip status boxes with an animated phone-tap illustration and plain instructions: iPhone at the top edge, Android at the upper-middle back, then tap the phone notification.
- `[IMPLEMENTED 2026-07-17]` Assigning an active loan officer to a confirmed outreach visit sends transactional SMS confirmations to the loan officer and hosting agent, attempts Resend email when configured, returns an Add to Google Calendar link, and exposes the same calendar action on the loan-officer visit card. Notification failures are returned as warnings without rolling back the assignment.
- `[IMPLEMENTED 2026-07-17]` The agent event dashboard no longer substitutes Jared Feder as default coverage. It renders the event's actual live `event_loan_officer_sessions` assignment or an explicit unassigned state, preventing placeholder identity from appearing as real coverage.
- `[IMPLEMENTED 2026-07-17]` Confirming or assigning an open house automatically creates an overlapping `unavailable` availability block linked to that visit. Reassignment cancels only prior auto-generated blocks for the visit, preserving manually entered availability while preventing double booking.
## 2026-07-18 Assigned Loan Officer Coverage Linking

- Admin confirmation and confirmed-visit assignment now create live `event_loan_officer_sessions` coverage whenever the open-house event already exists.
- Smart Sign/Event Pass activation now reconciles a pre-existing primary financing-support assignment by open-house source id and links that loan officer to the live event.
- Sponsored Event Pass activation remains excluded from this automatic reconciliation so its host-agent consent workflow stays authoritative.

## 2026-07-18 Agent Phone-Lock Gate

- `/agent-home` now validates that the NFC UID is currently claimed by the requested agent before loading private dashboard data.
- New-phone enrollment requires a six-digit SMS code sent only to the agent phone already stored on the claimed profile. Codes expire after ten minutes, are attempt-limited, and cannot be resent more than once per minute.
- Successful SMS verification creates a signed, secure, HttpOnly 30-day device session. On supported mobile browsers, the phone then enrolls a platform credential and later browser sessions require Face ID, fingerprint, or the phone's screen lock before leads and event details load.
- The platform credential remains a device-local gate; the signed server session and SMS challenge prevent an arbitrary first scanner from enrolling a new phone. Full server-side WebAuthn signature persistence and recovery remain future hardening work.

## 2026-07-19 Agent QR Print Batches

- REL8TION COMMAND's Signs area can reserve 1-100 next-available unprinted agent `rel8tion_chip_inventory` rows and download a single fulfillment ZIP.
- Every export contains `agent-qr-batch.csv`, a matching `images/<chip_code>.png` for each row, and a README. QR images are 1024x1024 black-on-white PNGs with high error correction.
- Exported rows are filtered on `is_printed=false`, then marked printed with `print_batch_id` and `printed_at` so later batches do not duplicate physical QR production.
## 2026-07-19 Agent Selection Photos And Loan-Officer Phone Lock

- `[IMPLEMENTED]` Sign and Event Pass agent selection now merges an existing `agents` profile into each `listing_agents` result by phone, email, or exact name. This preserves the agent's saved profile image when the listing snapshot is still awaiting photo enrichment.
- `[IMPLEMENTED]` Agent selection cards now show a branded initials avatar if no usable image exists or an image URL fails to load, rather than a broken/blank photo area.
- `[IMPLEMENTED]` `/loan-officer-account` now supports a platform phone lock (Face ID, fingerprint, or device screen lock) after Supabase account authentication. Existing four-digit phone PINs remain available as a fallback and password remains the recovery path.
## 2026-07-20 Event Pass And Agent-Keychain Access Separation (superseded 2026-08-17)

- `[SUPERSEDED]` The former separation kept Event Pass NFC out of `/agent-home` and reopened historical results after completion. As of 2026-08-17, an active pass still opens its live event dashboard, while an ended/idle pass opens the paid owner's Rel8tionChip home with a Start Open House action.
# Weekly production closeout and report (2026-07-20)

- `[IMPLEMENTED]` `/api/cron/weekly-production-report` runs from Vercel's Monday cron lane and uses an America/New_York 9 AM guard so daylight-saving changes do not shift the business-time schedule.
- `[IMPLEMENTED]` The job closes active events from before the current Monday, releases linked Smart Signs and Loan Officer Coverage Signs, and ends live loan-officer sessions while preserving event/check-in records.
- `[IMPLEMENTED]` The prior Monday-through-Sunday report includes event totals, buyer check-ins, financing-help requests, disclosures, messages, LO guidance, the host agent, assigned loan officer, and device count.
- `[NEEDS CONFIGURATION]` Automatic email delivery requires `RESEND_API_KEY` and `PRODUCTION_REPORT_EMAILS` in Vercel production. `REL8TION_FROM_EMAIL` is optional but recommended for a verified sender domain.
# WordPress Event Pass requests (2026-07-20)

- `[IMPLEMENTED]` The one-block Elementor home-page source now opens an agent Event Pass request form and submits to `/api/event-pass-request`.
- `[IMPLEMENTED]` Agents can optionally identify their current loan specialist and request that professional for coverage. When that option is not completed, the request is saved with the `nmb_default` sponsorship route.
- `[IMPLEMENTED]` Requests are stored server-side in `event_pass_requests` and appear in REL8TION COMMAND under LO assignments with contact buttons for both the agent and, when supplied, the requested loan specialist.
- `[NEEDS VERIFICATION]` WordPress source tracked outside the Vercel app must still be pasted/published through the live Elementor HTML block before the home-page button is live.
# WordPress offer alignment (2026-07-20)

- `[IMPLEMENTED]` The tracked home-page pricing source now fetches `/api/public/pricing`, shows the standard Complete System monthly/annual choices, and displays a pricing-unavailable state instead of embedded fallback amounts.
- `[IMPLEMENTED]` Home-page offer copy now includes the expanded buyer/event capture, financing-interest, SMS follow-up, reporting, website, and AI marketing-tool positioning. Its price labels refresh from the public pricing API and fail closed without embedded price fallbacks.
- `[IMPLEMENTED]` The public pricing API permits read access from the REL8TION WordPress origins so the one-block home page can stay synchronized with the tracked catalog.
# Annual bundle savings and Website Builder handoff (2026-07-20)

- `[IMPLEMENTED]` Expiring promotion and obsolete first-year comparison copy have been removed. Approved savings labels are derived from the catalog only.
- `[IMPLEMENTED]` The Open House Kit image is restored above the WordPress pricing cards. Eligible catalog-based orders persist the included Digital You entitlement and the secured kit dashboard links to its onboarding flow without creating a separate builder-side bundle payment.
- `[IMPLEMENTED]` The Website Builder get-started page reads the `promo` query parameter, populates the promo field, and automatically verifies it instead of requiring the buyer to retype it.

## 2026-07-26 REL8TION OS Scheduled Open-House Feed

- `[IMPLEMENTED]` The existing token-protected `/api/admin/agent-relationships` integration now exposes a read-only `view=schedule` mode for a caller-supplied time window.
- `[IMPLEMENTED]` Scheduled, non-cancelled `field_demo_visits` are returned with their canonical coverage times, agent identity, and property address enriched from the linked outreach queue and open-house listing.
- `[SECURITY]` The schedule view uses the existing dedicated `REL8TION_RELATIONSHIP_TOKEN`; it does not expose the general admin dashboard or allow schedule mutations.
- `[IMPLEMENTED]` Older open houses that predate `field_demo_visits` can be preserved as append-only `historical_open_house_confirmed` relationship events. A later removal is also append-only, so the audit history is retained.

## 2026-07-27: Shared agent follow-up marker

- `[IMPLEMENTED]` REL8TION COMMAND can mark or clear an agent for follow-up from outreach and confirmed-open-house agent controls.
- `[IMPLEMENTED]` Follow-up state is appended to the existing `agent_relationship_events` stream as `follow_up_marked` or `follow_up_cleared`; no agent, note, pin, or open-house rows are replaced.
- `[IMPLEMENTED]` `/api/admin/agent-relationships` projects the latest follow-up state and its optional title, due time, note, and marked time for REL8TION OS.
- `[IMPLEMENTED]` Commit `a06e90b` deployed as production deployment `dpl_9eR485yAHrv3bYyrHBRHTgcyXX11` and reached `READY`. The live dashboard asset contains the follow-up control, and an authenticated REL8TION OS read returned the new follow-up fields without mutating an agent.

## 2026-07-28 Universal Role-Aware Application Feature Branch

- `[IMPLEMENTED]` `feature/role-aware-dashboard` is isolated in a linked worktree created from verified `origin/main` commit `4db129ed5f2790394df9b2ace2057fdff5ec60c1`. The original dirty `codex/confirmed-lo-hotfix` checkout was not switched, reset, stashed, or modified by this work.
- `[IMPLEMENTED]` The root application route now maps to one mobile-first application gateway and shared authenticated shell on this feature branch. The unauthenticated gateway provides Sign In, device activation, invitation, and event/activation-code entry without exposing dashboard data.
- `[IMPLEMENTED]` `/api/app/auth/login`, `/api/app/auth/logout`, and `/api/app/session` manage a server-side Supabase Auth session in secure SameSite cookies. Every session load verifies the user through Supabase Auth and disables shared caching.
- `[IMPLEMENTED]` Workspace selection is server verified. A client can request only a workspace id already returned by the authenticated membership lookup; a forged role or workspace id falls back to the user's authorized primary workspace.
- `[IMPLEMENTED]` Role configuration covers real-estate agent, loan officer, broker/team leader, buyer, internal staff, founder, platform administrator, and unassigned onboarding experiences. Navigation, next actions, metrics, relationships, activity, and quick actions are permission filtered.
- `[IMPLEMENTED]` Existing authenticated loan officers have a strict compatibility path only when `auth.users.id` matches `verified_profiles.uid`. Other users without the new membership records receive an unassigned onboarding workspace with no customer-data scope.
- `[IMPLEMENTED]` `/admin` and `/admin.html` now enter through a server-side authorization route on this branch. Platform administrators require `platform.admin`; legacy COMMAND NFC UID/token access is preserved and redirects deliberately to `/command`. A request without an application session also continues to same-origin `/command?entry=admin` so the existing browser-stored admin UID/token remains usable; COMMAND's privileged APIs still verify that UID/token server-side before returning data.
- `[IMPLEMENTED]` `/api/app/admin-summary` checks `platform.admin` before loading any platform metric. The static `/platform-admin` shell contains no embedded administrative data and renders an unauthorized state when the protected API rejects the caller.
- `[IMPLEMENTED]` `supabase/migrations/20260728073613_universal_app_rbac.sql` proposes additive organization, workspace, membership, permission-override, domain-assignment, task, activity, and audit-log tables with RLS. The migration does not drop, rename, truncate, delete, or disable RLS.
- `[NEEDS VERIFICATION]` The universal RBAC migration has not been applied to local, branch, staging, or production Supabase. Until it is reviewed and applied to an isolated environment, only the verified legacy loan-officer fallback and unassigned workspace are expected to resolve.
- `[RISK]` Vercel Preview for `rel8tion-me` receives the production-connected Supabase URL and server-only credential. Preview verification for this feature must remain read-only and must not create test memberships, assignments, tasks, activity, or audit rows in production.
- `[IMPLEMENTED]` Existing `/k`, `/s`, `/s.html`, `/sign`, `/event`, `/claim`, `/a`, `/b`, `/c/:code`, `/chip/:code`, Event Pass, Sponsored Event Pass, Loan Officer Coverage Sign, onboarding, disclosure, and check-in routes remain mapped to their existing production files.
- `[IMPLEMENTED]` `npm run lint`, `npm run typecheck`, `npm test`, `npm run verify:routes`, and `npm run verify:app` provide repository-appropriate static syntax, authorization, RBAC, route-contract, and architecture checks for the universal application. The frameworkless Vercel project intentionally has no conventional `build` script so Vercel keeps its existing zero-config static/serverless packaging behavior.
- `[IMPLEMENTED]` The protected Vercel Preview for `feature/role-aware-dashboard` was generated through the existing Git integration and verified read-only on 2026-07-28. Desktop and 390×844 mobile gateway layouts rendered without horizontal overflow; `/api/app/session` returned an unauthenticated state; `/api/app/admin-summary` returned 401; and `/event`, `/claim`, `/s.html`, `/a`, `/b`, `/nmb-verified`, and the `/k` missing-UID fallback retained their expected public behavior. Before production rollout, direct `/admin` compatibility was tightened to preserve same-origin COMMAND credentials while retaining server authorization on every privileged API. The owner approved production rollout on 2026-07-28 subject to preserving admin dashboard access; production source remains `main`, and the exact live SHA must be verified through Vercel before making a live claim.
- `[IMPLEMENTED]` `docs/universal-app-and-platform-admin-guide.md` explains in plain language what the universal app and Platform Admin foundation do, how they differ from REL8TION COMMAND, what is live, and what remains before role-based administration is operational. The universal shell uses the established REL8TION hand-and-wordmark logo instead of the placeholder `R8` tile.
