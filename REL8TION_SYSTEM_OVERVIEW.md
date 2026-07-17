# REL8TION System Overview

Human architecture and product overview for REL8TION.

Last cleaned: 2026-06-04.

This document explains how the product fits together. Use `CURRENT_STATE.md` for daily status and verification needs. Use `AGENTS.md` for Codex operating rules and dangerous-file guidance.

Status labels used in this file:

- `[IMPLEMENTED]` means code exists in the repo. It does not guarantee that the feature is deployed, live, passing RLS, or working with current Supabase production data.
- `[PARTIAL]` means some code exists, but the complete product behavior is not built or not fully wired.
- `[INTENDED]` means this is a REL8TION business/product rule or target architecture, not proof of current implementation.
- `[NEEDS VERIFICATION]` means the repo is not enough to prove live behavior, deployment, schema, RLS, or external service state.
- `[RISK]` means this can break demos, production data, security, SMS, or user trust if handled casually.

## Product Purpose

REL8TION is a low-friction real estate open-house engagement system built around physical NFC tags, printed QR codes, smart signs, Event Passes, loan-officer coverage, buyer check-ins, disclosures, SMS, and agent follow-up.

The current product connects:

- `[IMPLEMENTED]` Agent Rel8tionChip/keychain identity.
- `[IMPLEMENTED]` Loan officer Rel8tionChip/keychain identity.
- `[IMPLEMENTED]` Smart signs with front buyer NFC, rear agent NFC, and printed QR inventory.
- `[IMPLEMENTED]` Event Pass printed QR codes that resolve through `smart_sign_inventory.public_code`.
- `[IMPLEMENTED]` Sponsored Event Passes issued by verified loan officers and activated by agents per open house with consent.
- `[IMPLEMENTED]` Loan Officer Coverage Signs that stay with the loan officer and route through `/lo-sign`.
- `[IMPLEMENTED]` Live open house event records, buyer check-ins, disclosures, and optional financing-help routing.
- `[PARTIAL]` REL8TION COMMAND admin operations.
- `[PARTIAL]` Agent Ranking / Production Intelligence for admin-only production-report imports, opportunity scoring, and manual outreach staging.
- `[PARTIAL]` Agent outreach, enrichment, and SMS follow-up.
- `[PARTIAL]` Agent website builder and AI Studio tooling.

## Core Business Rules

- `[INTENDED]` Event Pass is B2B open-house technology, not lead selling or referral purchasing.
- `[IMPLEMENTED]` Sponsored Event Pass requires per-event agent consent before sponsor visibility.
- `[IMPLEMENTED]` Loan Officer Coverage Signs stay with the loan officer.
- `[INTENDED]` Buyer financing help is opt-in only when the buyer explicitly requests it.
- `[INTENDED]` Rel8tion does not collect borrower application data, SSN, income, assets, credit, borrower documents, or loan documents.
- `[IMPLEMENTED]` `/k` is the universal NFC router and routing priority is critical.
- `[IMPLEMENTED]` Printed Event Pass QR source of truth is `smart_sign_inventory.public_code`.
- `[IMPLEMENTED]` `host_agent_slug` is the current event host field on `open_house_events`.
- `[RISK]` Root wrapper files and app files are not identical.

## Runtime Architecture

REL8TION is deliberately lightweight:

- `[IMPLEMENTED]` Static Vercel pages in `apps/rel8tion-app`.
- `[IMPLEMENTED]` Root static wrappers and public pages such as `index.html`, `a.html`, and `b.html`.
- `[IMPLEMENTED]` Root Vercel serverless API routes under `api/`.
- `[IMPLEMENTED]` A private server-to-server Rel8tionOS API under `api/rel8tionos/` exposes scoped outreach conversation, reply, Open House acceptance, and loan-officer assignment operations. It authenticates with a dedicated server-only shared key and returns no-store, versioned JSON responses.
- `[IMPLEMENTED]` Supabase REST/RPC calls from browser code where allowed by anon policies.
- `[IMPLEMENTED]` Supabase Edge Functions under `supabase/functions`.
- `[PARTIAL]` Android SMS Gateway as a temporary outreach-volume provider fallback while Twilio paths remain intact.
- `[PARTIAL]` A separate website-builder app under `apps/agent-website-builder`.
- `[PARTIAL]` WordPress-side local tracking files under `wordpress/`, not automatically synced to production.

Production is intended to deploy from `main` through Vercel Git automation. Exact live SHA, aliases, cron execution, env vars, and Supabase deployment state should be verified before relying on them.

## Route Families

### Identity And NFC

- `[IMPLEMENTED]` `/k` is the universal NFC router.
- `[IMPLEMENTED]` `/claim` claims an unclaimed Rel8tionChip/keychain into an agent identity.
- `[IMPLEMENTED]` `/onboarding` handles post-claim setup and smart sign activation entry points.
- `[PARTIAL]` `/agent-home` is the private owner dashboard for normal claimed agent NFC scans.
- `[IMPLEMENTED]` `/c/:code` and `/chip/:code` resolve printed Rel8tionChip QR inventory.
- `[IMPLEMENTED]` `/a` and `/b` are public/legacy profile and lead-capture routes, not normal claimed NFC owner access.

Agent and loan officer Rel8tionChip behavior is intentionally split: printed QR is public/profile oriented, while NFC is private owner/operator access.

### Smart Signs

- `[IMPLEMENTED]` `/sign-demo-activate` handles smart sign setup and listing binding.
- `[IMPLEMENTED]` `/s` and `/sign` resolve smart sign public codes and route to setup or live event state.
- `[IMPLEMENTED]` Front smart sign NFC is buyer-facing and routes to check-in.
- `[IMPLEMENTED]` Rear smart sign NFC is operator-facing and requires an agent keychain challenge before dashboard access.
- `[IMPLEMENTED]` A smart sign attaches to one active live open house event at a time.

### Event Pass And Sponsored Event Pass

- `[IMPLEMENTED]` `/pass` resolves Event Pass printed QR rows from `smart_sign_inventory.public_code`.
- `[IMPLEMENTED]` `/sponsored-pass-activate` activates reusable Sponsored Event Passes.
- `[IMPLEMENTED]` Sponsored Event Pass activation records `event_pass_coverage_consents` before sponsor visibility.
- `[IMPLEMENTED]` Event Pass and Smart Sign may both be active for the same listing/open-house context because routing is device/sign-aware.
- `[IMPLEMENTED]` Event Pass is gated as one included event unless renewed/reset by LO/admin.

### Loan Officer Coverage

- `[IMPLEMENTED]` `/lo-sign` resolves Loan Officer Coverage Signs.
- `[IMPLEMENTED]` `/lo-sign-setup` assigns pooled LO sign hardware to a loan officer.
- `[IMPLEMENTED]` `/lo-sign-activate` activates coverage for an open house and can issue Sponsored Event Pass context.
- `[PARTIAL]` `/loan-officer-dashboard` and `/lo-field-dashboard` expose loan-officer operations.
- `[PARTIAL]` `/nmb-activate` and `/nmb-verified` are loan officer tag/profile pages.
- `[INTENDED]` Formal remote LO coverage management is not built: no invite/request/accept workflow, no remote availability queue, no scheduled coverage assignment, and no persistent agent-LO relationship management.
- `[IMPLEMENTED]` REL8TION COMMAND can assign an active loan officer to a confirmed scheduled field visit before the live event shell exists; this creates the primary financing-support participant without falsely creating a live coverage session.
- `[IMPLEMENTED]` Scheduled LO assignment can be selected during confirmation and changed later from either the confirmed Reports card or Accepted Open Houses controls.

### Buyer Check-In And Dashboards

- `[IMPLEMENTED]` `/event` is the buyer check-in page.
- `[IMPLEMENTED]` `/event-chat` is the buyer return chat page for dashboard-triggered SMS links.
- `[IMPLEMENTED]` `/agent-dashboard` is the host-agent live event dashboard.
- `[PARTIAL]` REL8TION COMMAND at `/admin` is the operational admin dashboard. It includes a Buyer Finder workspace backed by `/api/admin/buyer-home-finder` for admin-only searching, filtering, sorting, and printable buyer-report generation across upcoming open-house/listing records.
- `[PARTIAL]` `/admin/agent-ranking` is the Agent Ranking / Production Intelligence module. It accepts ListReports-style CSV exports, normalizes agent/contact/listing/buyside/location activity fields, infers county/source/confidence, scores opportunity fit, supports server-side sorting/filtering/pagination, provides a clickable full-width agent profile modal with matched current listing/open-house records, the best available listing-agent photo, a large Rel8tion grade, image-backed ListReports-native prestige/status badges for Rising Star, Shooting Star, All-Star, and Rock Star based on active-listing/listing-side/buyer-side peer multiples, a plain-English county/market opportunity story, preserved duplicate-row context, and a printable/copyable Marketing Report modal for showing agents where they rank in their county/market, and can stage reviewed prospects into outreach manually. Recommended pitch copy and generated pitch variants live only in the separate Pitch Studio modal, not in the profile modal, and pitch text uses safe location labels plus actual profile metrics such as active listings, listing-side 12m, buyside 90d/12m, days since last listing, and matched open-house counts. The dashboard view is gated to trusted ListReports mappings with identity and phone present, hides old bad-mapping rows without deleting them, collapses same-agent duplicate stored rows for display when normalized agent name + brokerage + phone match, and does not present production volume, average price, or transaction count as ListReports-imported data. Ranking upsert identity is intended to be `identity_key`, combining normalized agent name, brokerage, phone, and county/market so phone alone never collapses shared-office-phone agents. Blank numeric filters are treated as no limit, not zero, market filter values are canonicalized so typos or encoded geometry values do not split campaign-ready counts, admin ranking reads page through Supabase instead of relying on a single capped REST response, and filter edits stay local until Apply/Search is clicked so typing in search fields does not query the database per keystroke. Area comparison returns peer rank context, including opportunity-score rank and metric ranks, for profile/report marketing use. Duplicate display rollups preserve raw/imported rows in Supabase while keeping dashboard campaign counts from double-counting the same agent. Large confirm imports defer deep `open_houses`/`listing_agents` matching to profile drill-down or explicit refresh so upload requests stay within function time limits. XLS/XLSX import and manual low-confidence match review are not complete.

### Open House Kit And Website Builder

- `[PARTIAL]` `/get-open-house-kit`, `/kit-confirm`, and `/kit-intake` support Open House Kit acquisition, keychain prefill, intake, and Stripe Checkout handoff. The Event Pass handoff arms on `irel8.me` so the physical NFC tap can consume the pending intent. The public pages retrieve current kit/monthly/annual amounts from the checkout API, and the landing pricing table reads the linked Stripe Product names, descriptions, images, and marketing features. The Summer 2026 promotion runs through September 22, 2026 at 11:59 PM Eastern: $199 kit; monthly pays $199 today with a 31-day service trial before $29/month; annual pays $498 today, renews at $299/year, and includes the Website Builder. New checkout automatically returns to standard configured pricing after the deadline.
- `[IMPLEMENTED]` `/api/checkout/stripe-webhook` verifies Stripe signatures and records eligible Open House Kit Checkout Sessions in `open_house_kit_orders` for fulfillment review.
- `[IMPLEMENTED]` `/api/checkout/website-promo` can show deterministic website-builder promo codes after paid kit checkout, stores the paid kit order as a browser-return fallback, creates a hashed dashboard access token, attempts the welcome email/text workflow, and returns the buyer to `/kit-dashboard`. Summer annual Checkout metadata grants the included Website Builder entitlement and makes its onboarding link available in the secured kit dashboard.
- `[IMPLEMENTED]` `/kit-dashboard` is the post-payment Open House Kit dashboard for logo selection/upload, fulfillment timeline, contact/shipping review, and dashboard security setup. It is backed by `/api/kit/dashboard`; chip-linked orders can mint dashboard access through `/api/kit/resolve-chip` and surface from the agent owner dashboard without changing `/k` routing priorities.
- `[PARTIAL]` The separate agent website builder at `my.rel8tion.me` uses `agent_websites` and `agent_website_listings`; public sites show current listings from featured active/pending rows and Past Sales from featured sold rows.
- `[INTENDED]` Public agent sites should display site-owned listings, not broader public `open_houses` inventory as MLS listing display.

## Data Model Highlights

Important tables and fields:

- `[IMPLEMENTED]` `agents.slug` identifies agent profiles.
- `[IMPLEMENTED]` `keys.uid` stores NFC UID rows; `keys.agent_slug` links claimed agent keychains by convention.
- `[IMPLEMENTED]` `rel8tion_chip_inventory` stores printed agent/LO QR inventory.
- `[IMPLEMENTED]` `smart_signs` stores physical smart sign state including `uid_primary`, `uid_secondary`, and `active_event_id`.
- `[IMPLEMENTED]` `smart_sign_inventory.public_code` stores printed Smart Sign and Event Pass QR source-of-truth codes.
- `[IMPLEMENTED]` `loan_officer_coverage_signs` stores LO Coverage Sign public code and NFC assignment.
- `[IMPLEMENTED]` `open_house_events.host_agent_slug` stores the event host. Older `agent_slug` assumptions for this table are stale.
- `[IMPLEMENTED]` `event_checkins` stores event-specific buyer attendance/action records.
- `[PARTIAL]` `leads` stores broader/global buyer lead records.
- `[IMPLEMENTED]` `event_loan_officer_sessions` stores live LO coverage.
- `[IMPLEMENTED]` `event_pass_coverage_consents` stores Sponsored Event Pass per-event consent.
- `[PARTIAL]` `agent_outreach_queue`, `agent_outreach_replies`, and delivery-event tables support outreach.
- `[PARTIAL]` `open_house_kit_orders` stores Stripe Checkout Sessions for Open House Kit fulfillment and onboarding, including dashboard security state, selected/custom logo fields, and welcome email/SMS status. `company_logos` stores seeded approved company-logo choices; `open_house_kit_access_tokens` stores hashed dashboard/magic-link/chip-scan tokens; `open_house_kit_notifications` logs welcome email/SMS attempts. Live Stripe webhook dashboard configuration and email provider env still require verification.
- `[PARTIAL]` `agent_production_uploads`, `agent_production_import_rows`, and `agent_rankings` support Agent Ranking / Production Intelligence. The linked Supabase schema was applied and catalog/advisor verified for these new objects on 2026-06-28, including ListReports activity columns. On 2026-06-30, location/source/confidence fields and matched open-house counts/ids/timestamps were applied to linked Supabase and column verification passed. A later 2026-06-30 migration added `agent_rankings.identity_key` and replaced the old phone-first unique index; column/index verification and backfill sampling passed. Legacy null-identity/bad-mapping rows can still exist in storage, but the trusted dashboard view filters them out. Authenticated upload-flow behavior still needs verification.
- `[PARTIAL]` `agent_websites` and `agent_website_listings` support the website-builder app.

## Messaging, Outreach, And Compliance

- `[PARTIAL]` `send-lead-sms` source is checked in under `supabase/functions/send-lead-sms` and uses the shared SMS provider layer.
- `[NEEDS VERIFICATION]` Deployed function source/version, provider env, and live SMS behavior still need verification.
- `[IMPLEMENTED]` Open House Kit post-payment welcome SMS calls `send-lead-sms` as `event_transactional`; welcome email uses Resend when `RESEND_API_KEY` and a sender address are configured in Vercel. Both channels include the `/kit-dashboard` access link and are logged through `open_house_kit_notifications`.
- `[IMPLEMENTED]` `/event` sends buyer/agent SMS only after local check-in validation and disclosure completion.
- `[IMPLEMENTED]` During opt-out recovery, the Vercel send cron and `send-agent-outreach` Edge Function hard-cap automatic sends at 5 per run, 10 per rolling hour, and 25 per rolling 24 hours, even if older secrets contain higher values. Automatic initial sends do not require `approved_for_send=true`; eligible rows are `send_mode=automatic`, generated, rendered, due, with a listing photo and pending initial SMS copy.
- `[IMPLEMENTED]` Automated outreach has a global runtime pause via `rel8tion_runtime_settings.key='outreach_send_paused'` or `OUTREACH_SEND_PAUSED=true`; when enabled, live runs send nothing and report `paused=true`, while authenticated dry runs can inspect candidates.
- `[IMPLEMENTED]` While outreach send pause/recovery mode is active, `generate-agent-outreach` stages newly generated outreach as `send_mode=manual`, `review_status=manual_ready` so rows flow into the cell-send queue instead of automatic sending.
- `[IMPLEMENTED]` As of 2026-06-28, outreach follow-up/drip scheduling is disabled while opt-out health is recovered. Existing live pending follow-ups were cleared to `followups_disabled`, and the current generator/sender leave future follow-up fields unscheduled unless intentionally re-enabled.
- `[IMPLEMENTED]` SMS provider selection is route-scoped: `SMS_OUTREACH_PROVIDER` controls outreach/manual outreach, `SMS_EVENTS_PROVIDER` controls buyer/event/owner operational traffic, and both fall back to `SMS_PROVIDER`.
- `[IMPLEMENTED]` Twilio sender selection is also route-scoped. Outreach can use `TWILIO_OUTREACH_MESSAGING_SERVICE_SID` or `TWILIO_OUTREACH_FROM_NUMBER`, while operational traffic can use `TWILIO_EVENTS_FROM_NUMBER`; an all-Twilio outreach configuration requires a dedicated outreach sender instead of falling back to the regular number.
- `[IMPLEMENTED]` Opt-out suppression is global across provider routes and fails closed. The inbound handlers process STOP-family keywords and explicit START/UNSTOP, and STOP marks matching queue rows opted out across the phone number.
- `[IMPLEMENTED]` Outreach recovery safety includes a 30-day same-phone cooldown, rolling opt-out health gate, 7-day maximum age for missed-open-house outreach, shorter permission-oriented first contact, and follow-ups disabled. Initial MMS is disabled by code default but explicitly enabled in current production after owner approval and verified toll-free delivery; it attaches the generated outreach image first and the NMB business card second. Android Gateway remains text-only.
- `[IMPLEMENTED]` Production outreach is split by route: toll-free Twilio `+18448211802`/Messaging Service `MG8d7ec49cf1d6d231080b7f870a10eb0b` handles outreach, while `+15168885461` handles event/check-in/owner/system traffic. Android Gateway remains a fallback.
- `[IMPLEMENTED]` REL8TION COMMAND shows Twilio ready, Manual ready, and Auto ready rows. Live: manual / Away: auto changes `rel8tion_runtime_settings.outreach_operator_mode`, while Pause cron / Resume cron intentionally changes row `send_mode`.
- `[IMPLEMENTED]` `/manual-sms-outreach` is the protected cell-send backup. It uses `/api/manual-sms-outreach`, opens the local SMS composer, marks rows sent/skipped only after operator action, and does not exclude Douglas Elliman manual-ready rows.
- `[IMPLEMENTED]` REL8TION COMMAND outreach health treats an empty inbound window as quiet/normal instead of a broken inbox; actual warnings remain for raw/unlinked inbound rows and linked replies missing from the inbox view.
- `[IMPLEMENTED]` Rel8tionOS uses the same manual reply and assignment workflows as REL8TION COMMAND. Its API requires an idempotency key for outbound SMS and preserves centralized suppression, opt-out, routing, and quiet-hour enforcement.
- `[PARTIAL]` Agent Ranking / Production Intelligence stages ranked agents into `agent_outreach_queue` with manual send mode and follow-ups disabled. It should not be used to send automatic SMS or to game opt-out-rate metrics.
- `[IMPLEMENTED]` Durable Twilio outreach recovery settings live in `docs/twilio-outreach-sms-runbook.md`; keep that runbook and the source-of-truth docs aligned.
- `[IMPLEMENTED]` As of 2026-07-14, Twilio route separation is live and verified: operational SMS uses `+15168885461`, and outreach uses registered toll-free `+18448211802` through Messaging Service `MG8d7ec49cf1d6d231080b7f870a10eb0b`. Outbound MMS delivered, the service-level inbound webhook was corrected from ElevenLabs to Rel8tion, an inbound test linked to the outreach queue, and the operational owner alert queued. The global pause is off; recovery remains limited to fresh eligible rows and hard caps of 5/run, 10/hour, and 25/day.
- `[IMPLEMENTED]` Twilio inbound outreach replies enter through the public `twilio-inbound-router` Edge Function, which routes replies into the protected `twilio-inbound-reply` handler. Matched replies link to outreach queue rows using tolerant 10/11-digit phone matching; unmatched replies are still stored with `queue_row_id=null`.
- `[RISK]` Twilio Messaging Service inbound handling must be set to `Send a webhook`, not `Receive the message`, or REL8TION will not see inbound replies. Delivery status callbacks must use `twilio-message-status?token=<TWILIO_STATUS_CALLBACK_TOKEN>`.
- `[IMPLEMENTED]` Buyer financing outreach only happens after explicit buyer opt-in.
- `[IMPLEMENTED]` `api/compliance/ny-disclosure.js` generates disclosure packet previews and signed PDFs.
- `[NEEDS VERIFICATION]` Signed disclosure PDF storage and final legal/form-version review remain unverified.
- `[RISK]` Outreach and auto-reply behavior can spend money and affect real conversations. Queue filters, quiet hours, opt-outs, provider state, and owner approval matter.

## Enrichment And Listing Freshness

- `[PARTIAL]` `estately-enrichment-worker.cjs` and `api/cron/enrich-agents.js` support agent/listing enrichment.
- `[PARTIAL]` `onekey-freshness-worker.cjs` and `api/cron/refresh-open-house-data.js` support listing freshness.
- `[NEEDS VERIFICATION]` Browserless/Trulia enrichment source was not found in tracked source during the repo audit; current tracked enrichment is Estately/Cheerio.
- `[NEEDS VERIFICATION]` Live cron execution, schema/RLS, and data quality need verification before relying on automatic enrichment.

## Deployment And Verification

- `[IMPLEMENTED]` Root `vercel.json` contains current rewrites and cron definitions.
- `[IMPLEMENTED]` `npm run verify:routes` checks route-map hygiene before deploy.
- `[NEEDS VERIFICATION]` `npm run verify:production-routes` and Vercel inspection should be run after deploy before calling routes live.
- `[NEEDS VERIFICATION]` Live Supabase migrations, RLS policies, Storage buckets, Edge Function deployments, RPC definitions, and env vars need explicit verification.
- `[NEEDS VERIFICATION]` Known RPCs used by app code but not proven from checked-in SQL include `find_nearest_open_house`, `queue_recent_outreach_candidates`, `verified_profiles_lookup`, and `verified_profiles_activate_or_create`.

## Legacy And Stale References

- `[IMPLEMENTED]` The old `modular-claim-test` production deploy/tag is historical only. Current production source should be verified from Vercel and `main`.
- `[RISK]` Legacy root test pages and old exported/static folders are present. Do not use them as product source-of-truth without route-map confirmation.
- `[RISK]` `smart_signs.public_code` is not a print source for new QR codes. Use `smart_sign_inventory.public_code`.
- `[RISK]` Older references to `open_house_events.agent_slug` are stale. Use `host_agent_slug`.
- `[RISK]` WordPress files are local tracking only and do not automatically sync to the live WordPress page.
# New York agent-website compliance

Agent website records carry separate fields for marketing title and exact license type, plus brokerage identity/contact information and broker-controlled compliance links. Public generated sites surface the NY Housing and Anti-Discrimination Disclosure, the employing broker's Standardized Operating Procedures when supplied, brokerage website when supplied, and the listing brokerage on property advertising. A missing SOP URL is a publish-readiness issue; broker policy content is never inferred by REL8TION.

Automatic agent outreach is restricted to future open houses. When the operator is away, future eligible rows from any brokerage may use the configured automatic outreach provider. Provider health, opt-out, duplicate-phone, hourly, daily, and per-run gates are enforced independently.
### Loan officer registration approval

Public loan officers apply through `/loan-officer-support`; an application alone does not confer verified status. REL8TION COMMAND performs the trust boundary: an admin approval creates or reuses the applicant's verified loan-officer profile, marks the application approved, sends an activation SMS, attempts an activation email, and opens the activation page so profile details can be completed before dashboard use. Email remains dependent on Resend sender configuration.
### Loan officer password account

Approved loan officers receive a Supabase Auth email invitation and create a password at the canonical `/loan-officer` URL. The legacy `/loan-officer-account` route remains compatible. Password login is matched server-side to the active `verified_profiles.email` row before the loan officer dashboard opens. The service-role key remains server-only; the browser uses the public anon key and the signed-in user's access token.
### Loan officer identity editing and public sharing

Loan officer identity data remains sourced from `verified_profiles`. Authenticated officers and REL8TION COMMAND admins can update profile/contact/company information, while email changes are synchronized to Supabase Auth server-side. The private dashboard displays the same photo/name/company identity but shares `/nmb-verified?slug=...` publicly; private open-house assignments, buyer requests, and messages are never part of the shared profile.
Existing loan officer profiles may predate Supabase Auth. `/api/loan-officer-access-link` bootstraps or recovers the Auth user from an approved `verified_profiles` email and delivers the one-time link to the profile's saved mobile number. Unknown emails receive a generic response, and repeat SMS requests are suppressed for five minutes. Custom SMTP remains a separate production integration.
Loan officer setup texts use a REL8TION-owned verification URL. The server converts Supabase-generated invite/recovery action links into `/loan-officer?token_hash=...&type=...`; the browser verifies the token with `verifyOtp` and never depends on the Supabase Auth Site URL or redirect allow-list for navigation.
### Loan officer account identity compatibility

Authenticated loan-officer dashboards resolve all active `verified_profiles` rows that share the authenticated email when loading assigned field visits. The most recently updated profile remains the editable/display profile, while legacy profile UIDs remain assignment aliases. This prevents prior open-house coverage from disappearing if an established loan officer later completes the newer registration flow.

Loan-officer account-link throttling is checked before generating a Supabase invite/recovery token. This ordering is required because generating a replacement token invalidates the prior one; REL8TION never generates and then withholds a newer token.

The loan-officer dashboard overview and full Open Houses + Buyers section both render listing photos and street addresses from the assigned outreach queue context. The dashboard header renders the active verified profile's public headshot.
The authenticated loan-officer Profile section contains the Event Pass field activation guide. It reinforces the physical activation sequence: scan the printed Event Pass QR, tap the same NFC keychain, choose open-house mode, confirm the listing and agent, and activate the pass for buyer QR check-in and agent alerts.
The authoritative loan-officer Event Pass instructions live at `/loan-officer-event-pass-guide`. They follow the QR-first, same-physical-NFC activation flow and distinguish the general agent check-in alert from financing alerts, which require explicit buyer opt-in.
Confirmed-open-house loan-officer assignment is an operational notification boundary. The assignment is persisted first, then REL8TION sends transactional SMS introductions to the assigned loan officer and hosting agent, attempts configured email delivery, and supplies an Add to Google Calendar link. Notification failures are reported without removing the valid assignment.
