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
- `[IMPLEMENTED]` After check-in, buyers can open a dedicated `/l/:open_house_id` property experience with an expandable stored photo gallery, richer property facts and features, host context, and a return link to the same event. Server-managed `open_house_property_profiles` rows preserve the experience between upstream listing requests without exposing raw source payloads directly to buyers.
- `[IMPLEMENTED]` A secured production cron refreshes active events and confirmed/scheduled upcoming property profiles every three hours, prioritizing missing/single-photo galleries and trying the OneKey unique listing id, listing key, BUPI, and embedded public media before preserving the existing gallery fallback.
- `[IMPLEMENTED]` Shared open-house coverage supports two carried Event Passes plus one stationary Smart Sign or Loan Officer Coverage Sign, all pointing to one event and dashboard with a three-device cap.
- `[PARTIAL]` REL8TION COMMAND admin operations.
- `[IMPLEMENTED]` REL8TION COMMAND's additive Agent Performance board centralizes each agent's identity, outreach/conversation history, upcoming open houses, known listings, leads, keychains, and ranking link without removing the original source workspaces. Its future-open-house view supports agent/property search plus relationship, date-range, and local start-time filters, ranking accepted/worked-with agents first, then interested agents, agents with prior sent outreach, and new agents. An open-house agent click opens one focused property/agent workflow with contact actions and a linked REL8TION SMS composer instead of redirecting to a generic conversation list; unfocused agent and opportunity lists render in bounded increments for browser performance.
- `[PARTIAL]` Agent Ranking / Production Intelligence for admin-only production-report imports, opportunity scoring, and manual outreach staging.
- `[PARTIAL]` Agent outreach, enrichment, and SMS follow-up.
- `[IMPLEMENTED]` OneKey headshot enrichment uses compatible exact-name candidates plus exact phone verification, copies accepted photos into REL8TION storage, previews locally by default, never replaces an existing agent photo, and runs in bounded six-hour cron batches for upcoming outreach.
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
- `[IMPLEMENTED]` Root static wrappers and public pages such as `a.html` and `b.html`. On the role-aware feature branch, the obsolete root `index.html` smoke test and `admin.html` forwarding alias are removed so Vercel's static filesystem cannot shadow the universal `/` rewrite or bypass the server-authorized `/admin` entry.
- `[IMPLEMENTED]` Root Vercel serverless API routes under `api/`.
- `[IMPLEMENTED]` The admin dashboard API exposes a unified, read-only Agent Performance projection assembled from existing Supabase sources. It labels relationship priority from accepted/confirmed visits, hosted REL8TION events, positive outreach status, and verifiably sent outreach; unsent queue preparation does not establish prior outreach. Missing optional listing inventory degrades to warnings instead of blocking the rest of COMMAND.
- `[IMPLEMENTED]` COMMAND loads that full multi-source dashboard projection once, then keeps normal area/agent/open-house navigation inside the existing browser shell. Cached agent/open-house indexes serve drill-downs, browser Back/Forward restores dashboard state, and a visible-tab-only lightweight refresh updates outreach/relationship data without repeatedly downloading the full dashboard snapshot.
- `[IMPLEMENTED]` COMMAND defers relationship hydration until after first paint and uses a summary-only relationship projection without follow-up conversation expansion. Focused agent detail sections render in 20-row increments. Active REL8TION field visits expose the same cancellation action from Accepted Open Houses, the focused agent/open-house workflow, and matched future-opportunity cards. Accepted/confirmed outreach without a field visit can be returned to interested without deleting its source listing or conversation history; unaccepted source-feed listings remain non-destructive.
- `[IMPLEMENTED]` Future relationship-listing inventory has a property-specific outreach-image lifecycle. The existing protected mockup renderer stores generated JPGs under `agent-mockups/open-house-outreach`, and listing photo/address/time changes reset only that listing to pending. COMMAND exposes the resulting image in the focused agent composer as an operator-selected attachment; image preparation alone never changes outreach send state.
- `[IMPLEMENTED]` A private server-to-server Rel8tionOS API under `api/rel8tionos/` exposes scoped outreach conversation, reply, Open House acceptance, and loan-officer assignment operations. Outreach thread projections include `agent.photo_url` from the queue's current enriched agent photo. It authenticates with a dedicated server-only shared key and returns no-store, versioned JSON responses.
- `[IMPLEMENTED]` The private relationship schedule feed reads confirmed field visits for a requested time range and collapses duplicate visit rows by open-house identity, scheduled window, and agent identity without altering source records.
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

The agent owner dashboard validates the claimed NFC UID/agent pairing before loading private data. A new phone must pass a rate-limited six-digit SMS challenge sent to the saved agent number before it can enroll a local platform credential. Successful verification creates a signed secure device session; supported phones then require Face ID, fingerprint, or screen lock for later browser sessions. Full server-side WebAuthn signature persistence and account recovery remain future hardening work.

### Smart Signs

- `[IMPLEMENTED]` `/sign-demo-activate` handles smart sign setup and listing binding.
- `[IMPLEMENTED]` `/s` and `/sign` resolve smart sign public codes and route to setup or live event state.
- `[IMPLEMENTED]` Front smart sign NFC is buyer-facing and routes to check-in.
- `[IMPLEMENTED]` Rear smart sign NFC is operator-facing and requires an agent keychain challenge before dashboard access.
- `[IMPLEMENTED]` A smart sign attaches to one active live open house event at a time.

### Event Pass And Sponsored Event Pass

- `[IMPLEMENTED]` `/pass` resolves Event Pass printed QR rows from `smart_sign_inventory.public_code`.
- `[IMPLEMENTED]` A deliberately converted printed agent QR may route from `/c/:code` to `/pass?code=...` only when the original agent inventory row is retired and the matching Event Pass row contains explicit conversion metadata tied to that original row id. `smart_sign_inventory.public_code` remains the Event Pass source of truth.
- `[IMPLEMENTED]` A fresh Event Pass QR scan presents a visual NFC handoff showing the physical pass approaching the correct iPhone and Android NFC areas; public codes and chip-status jargon are hidden from the normal field instruction.
- `[IMPLEMENTED]` `/sponsored-pass-activate` activates reusable Sponsored Event Passes.
- `[IMPLEMENTED]` Sponsored Event Pass activation records `event_pass_coverage_consents` before sponsor visibility.
- `[IMPLEMENTED]` Event Pass and Smart Sign may both be active for the same listing/open-house context because routing is device/sign-aware.
- `[IMPLEMENTED]` Event Pass is gated as one included event unless renewed/reset by LO/admin.

### Loan Officer Coverage

- `[IMPLEMENTED]` `/lo-sign` resolves Loan Officer Coverage Signs.
- `[IMPLEMENTED]` `/lo-sign-setup` assigns pooled LO sign hardware to a loan officer.
- `[IMPLEMENTED]` `/lo-sign-activate` activates coverage for an open house and can issue Sponsored Event Pass context.
- `[PARTIAL]` `/loan-officer-dashboard` and `/lo-field-dashboard` expose loan-officer operations.
- `[IMPLEMENTED]` On mobile, the loan-officer dashboard section menu is positioned at the top of the dashboard and stays sticky while the user scrolls.
- `[PARTIAL]` `/nmb-activate` and `/nmb-verified` are loan officer tag/profile pages.
- `[INTENDED]` Formal remote LO coverage management is not built: no invite/request/accept workflow, no remote availability queue, no scheduled coverage assignment, and no persistent agent-LO relationship management.
- `[IMPLEMENTED]` REL8TION COMMAND can assign an active loan officer to a confirmed scheduled field visit before the live event shell exists; this creates the primary financing-support participant without falsely creating a live coverage session.
- `[IMPLEMENTED]` Scheduled LO assignment can be selected during confirmation and changed later from either the confirmed Reports card or Accepted Open Houses controls.

### Buyer Check-In And Dashboards

- `[IMPLEMENTED]` `/event` is the buyer check-in page.
- `[IMPLEMENTED]` `/event-chat` is the buyer return chat page for dashboard-triggered SMS links.
- `[IMPLEMENTED]` `/agent-dashboard` is the host-agent live event dashboard.
- `[PARTIAL]` REL8TION COMMAND at `/admin` is the operational admin dashboard. It includes a Buyer Finder workspace backed by `/api/admin/buyer-home-finder` for admin-only searching, filtering, sorting, and printable buyer-report generation across upcoming open-house/listing records.
- `[IMPLEMENTED]` REL8TION COMMAND has a dedicated Open Houses workspace. Live events render before scheduled coverage and recent history, link directly to the event dashboard, and no longer sit below sign inventory. An admin can cancel a scheduled or confirmed open house with explicit confirmation; the service-role event action preserves history, releases field participants and availability blocks, restores accepted outreach to interested status, and ends any matching live event through the shared sign and loan-officer cleanup path.
- `[IMPLEMENTED]` REL8TION COMMAND Reports defaults to the complete confirmed/accepted open-house history, newest first. Historical report data is loaded independently of the recent outreach feed, field visits and participants are paged, all matching cards render, and Upcoming/Previous filters remain available.
- `[IMPLEMENTED]` Reports also surfaces historical inbound outreach threads that still need an explicit open-house confirmation. Operators can review the saved reply and choose the correct coverage date; REL8TION does not automatically treat ambiguous replies as confirmed visits.
- `[IMPLEMENTED]` Recovery eligibility is based on the saved inbound message history rather than the latest thread direction, preserving review visibility after later outbound follow-ups.
- `[PARTIAL]` `/admin/agent-ranking` is the Agent Ranking / Production Intelligence module. It accepts ListReports-style CSV exports, normalizes agent/contact/listing/buyside/location activity fields, infers county/source/confidence, scores opportunity fit, supports server-side sorting/filtering/pagination, provides a clickable full-width agent profile modal with matched current listing/open-house records and real prior REL8TION open-house history, and can stage reviewed prospects into outreach manually. Profile portraits use a shared identity-verified fallback chain across the canonical agent, agent website, enriched outreach, and listing-agent records; exact phone/email matching takes precedence and contact-less fallback requires exact name plus compatible brokerage. The profile and Marketing Report receive the same resolved portrait. **Worked together** is established only by ended REL8TION events or past confirmed/live/completed field visits, deduplicated by source open house and joined to the real source address/date when available; imported activity estimates and preview data are excluded. The ListReports `active_listing_count` field is presented as an unverified imported listing signal across the table, profile, area comparison, pitch, and report—not as verified current inventory. Actual current listings and upcoming open houses come from the separate REL8TION inventory sync. The dashboard view is gated to trusted ListReports mappings with identity and phone present, retains defensive display deduplication, and does not present production volume, average price, or transaction count as ListReports-imported data. Ranking upsert identity combines normalized agent name, brokerage, and phone; location is excluded so repeated county/market reports update one current ranking, while name and brokerage keep different agents on a shared office phone separate. Blank numeric filters are treated as no limit, not zero, market filter values are canonicalized so typos or encoded geometry values do not split campaign-ready counts, admin ranking reads page through Supabase instead of relying on a single capped REST response, and filter edits stay local until Apply/Search is clicked so typing in search fields does not query the database per keystroke. Area comparison returns peer rank context, including opportunity-score rank and metric ranks, for profile/report marketing use. Raw uploaded rows remain in `agent_production_import_rows`; `agent_rankings` holds only the canonical current row for each identity. Large confirm imports defer deep open-house matching to profile drill-down or explicit refresh so uploads stay within function time limits. XLS/XLSX import and manual low-confidence match review are not complete.
- `[PARTIAL]` Agent Ranking distinguishes the imported ListReports listing signal from actual current database listings. Its searchable population unions trusted ListReports rankings with relationship-only agents proven by prior REL8TION history or positive outreach state, so enrichment is not required before a worked-with/interested/confirmed/accepted agent can be found. Relationship-only rows are explicitly labeled `ListReports: Not imported`, use no fabricated production metrics, and deduplicate against trusted rankings. Protected `agent_listing_inventory` rows reuse verified current agent-website listings and future open-house rows for ranked agents, claimed agents, prior-work agents, and positive-interest outreach relationships, deduplicating the same agent/address across sources. Current inventory is visible in the admin profile; future listing marketing eligibility is limited server-side to claimed/worked-with or positive-interest relationships. For an eligible real future inventory record, the admin can draft a "have me there" reminder containing its actual address/date. The queue record is manual, unapproved, blocked for review, and has follow-ups disabled, so drafting does not send an SMS. Broad geographic OneKey discovery remains disabled. The separately gated targeted OneKey path resolves worked-with and positive-interest agents through the public agent directory, requires exact full name plus exact phone/email or compatible brokerage, rejects conflicting phones, and queries current Sale and Rent listings by stable member key. The two-hour scheduled sync writes only protected inventory unless separate open-house promotion and manual outreach flags are explicitly enabled, and it introduces no automatic sending.
- `[IMPLEMENTED]` Agent Ranking collapses separate ListReports ranking rows into one display identity when they share the same canonical `agent_id` and exact normalized phone, even if brokerage labels differ between exports. The newest source snapshot provides the visible identity, while duplicate ranking/upload identifiers remain preserved in display metadata and the raw import tables remain unchanged. This read-model consolidation does not alter public agent websites or their listing records.

### Open House Kit And Website Builder

- `[PARTIAL]` `/get-open-house-kit`, `/kit-confirm`, and `/kit-intake` support Open House Kit acquisition, keychain prefill, intake, and Stripe Checkout handoff. The Event Pass handoff arms on `irel8.me` so the physical NFC tap can consume the pending intent. The public pages retrieve current kit/monthly/annual amounts from the checkout API, and the landing pricing table reads the linked Stripe Product names, descriptions, images, and marketing features. The Summer 2026 promotion runs through September 22, 2026 at 11:59 PM Eastern: $199 kit; monthly pays $199 today with a 31-day service trial before $29/month; annual pays $498 today, renews at $299/year, and includes the Website Builder. New checkout automatically returns to standard configured pricing after the deadline.
- `[IMPLEMENTED]` `/api/checkout/stripe-webhook` verifies Stripe signatures and records eligible Open House Kit Checkout Sessions in `open_house_kit_orders` for fulfillment review.
- `[IMPLEMENTED]` `/api/checkout/website-promo` can show deterministic website-builder promo codes after paid kit checkout, stores the paid kit order as a browser-return fallback, creates a hashed dashboard access token, attempts the welcome email/text workflow, and returns the buyer to `/kit-dashboard`. Summer annual Checkout metadata grants the included Website Builder entitlement and makes its onboarding link available in the secured kit dashboard.
- `[IMPLEMENTED]` `/kit-dashboard` is the post-payment Open House Kit dashboard for logo selection/upload, fulfillment timeline, contact/shipping review, and dashboard security setup. It is backed by `/api/kit/dashboard`; chip-linked orders can mint dashboard access through `/api/kit/resolve-chip` and surface from the agent owner dashboard without changing `/k` routing priorities.
- `[PARTIAL]` The separate agent website builder at `my.rel8tion.me` uses `agent_websites` and `agent_website_listings`; public sites show current listings from featured active/pending rows and Past Sales from featured sold rows.
- `[IMPLEMENTED]` Agent website identity is one REL8TION subsystem even though its Next.js source and Vercel project are separate. The canonical portal origin is `https://my.rel8tion.me`; `/agent/login` starts access, `/auth/callback` consumes one-time PKCE codes or hashed invite/recovery tokens, and `/agent/dashboard` is the authenticated landing page.
- `[IMPLEMENTED]` Agent website browser, server, proxy, admin, storage, promo, and cron clients share Supabase project `nicanqrfqlbnlmnoernb`. Project-specific `REL8TION_SUPABASE_URL`, `REL8TION_SUPABASE_ANON_KEY`, and server-only `REL8TION_SUPABASE_SERVICE_ROLE_KEY` prevent generic Vercel integration variables from splitting Auth and data across projects.
- `[IMPLEMENTED]` `/api/agent/access-link` provides saved-mobile setup/recovery when corporate email filtering blocks Supabase mail. It resolves the approved agent website by email, sends only to the stored phone, suppresses rapid repeats, creates an invite for a missing Auth user or recovery token for an existing user, and returns the same generic response for matched and unmatched email addresses.
- `[IMPLEMENTED]` Agent SMS links are REL8TION-owned callback URLs containing a one-time `token_hash`. Supabase-generated `action_link` URLs are never sent directly because Auth Site URL fallback can redirect to `localhost`. Callback success and errors canonicalize to `my.rel8tion.me`, while localhost remains supported only for local development.
- `[IMPLEMENTED]` The agent dashboard's shared site editor normalizes uploaded imagery before storage with a client-side crop preview. Canonical output contracts are 4:5/1200×1500 for headshots, 16:9/1920×1080 for heroes, 4:5/1200×1500 for About images, and 4:3/1600×1200 for gallery images; this reduces unexpected `object-cover` clipping across the public template.
- `[IMPLEMENTED]` Public agent pages alternate visual surfaces across lower-page sections: Listings/main background → Calculator/branded gradient → testimonials or truthful no-testimonial trust band/tinted secondary → Contact/main background. The no-testimonial path must render a designed transition rather than fake client quotes or return `null` and visually erase the band.
- `[IMPLEMENTED]` Mortgage rate consultation is a platform lead path rather than an agent lead path. Calculator CTAs post `leadType=rate_consultation` to `/api/contact`, which requires a phone number and selects `RATE_LEAD_NOTIFICATION_EMAIL`; ordinary website contact leads continue routing to the site agent.
- `[IMPLEMENTED]` Agent website listing sync normally treats OneKey/current source data as authoritative. For a specifically verified stale upstream snapshot, `agent_website_listings.metadata.manual_listing_override` can preserve an allowlisted set of current public facts through importer upserts. The override is row-scoped, auditable, and must include verification source/date/reason; it is not a global substitute for source freshness.
- `[IMPLEMENTED]` The first production use is Lisa Luttinger's OneKey MLS `971018` at 703 Neptune Blvd: public sources show Pending since 2026-06-26 at $1.35M, while its saved May 9 scraper snapshot still said Active/$1,399,998. A post-deploy production sync confirmed the verified override survives importer writes.
- `[INTENDED]` Public agent sites should display site-owned listings, not broader public `open_houses` inventory as MLS listing display.

## Data Model Highlights

Important tables and fields:

- `[IMPLEMENTED]` `agent_relationships` is the canonical per-agent relationship record for identity, pin state, priority rank, pin reason, and last-contact state.
- `[IMPLEMENTED]` `agent_relationship_events` is the deduplicated chronological relationship stream for outreach, replies, confirmed open houses, field visits, notes, pins, follow-up markers, referrals, and REL8TION OS synchronization. A follow-up is active when the latest follow-up event is `follow_up_marked` and cleared when the latest is `follow_up_cleared`.
- `[IMPLEMENTED]` `agent_board_v1` is the service-role-only, `security_invoker` board projection used by relation.me and REL8TION OS.
- `[IMPLEMENTED]` `/api/admin/agent-relationships` is the privileged read/write boundary for the shared stream. Browser and desktop clients must not receive the Supabase service-role key.
- `[IMPLEMENTED]` REL8TION OS uses a dedicated production credential to read and dual-write the relation.me relationship stream. The one-time local history migration completed on 2026-07-26 for 404 worked-with agents and one saved note; local pin/note storage remains only as an offline fallback.
- `[IMPLEMENTED]` For relationships currently marked Follow Up, the authenticated board projection also reads existing sent outreach from `agent_outreach_queue` and linked inbound/outbound history from `agent_outreach_replies`. Exact phone, email, or source-row identity is required; the projection does not duplicate or mutate message records.
- `[IMPLEMENTED]` `agents.slug` identifies agent profiles.
- `[IMPLEMENTED]` `keys.uid` stores NFC UID rows; `keys.agent_slug` links claimed agent keychains by convention.
- `[IMPLEMENTED]` `rel8tion_chip_inventory` stores printed agent/LO QR inventory.
- `[IMPLEMENTED]` REL8TION COMMAND can export the next 1-100 unprinted Agent Rel8tionChip or Event Pass QR rows from one dropdown as a fulfillment ZIP containing a CSV and identically named high-resolution PNG files. Agent export preserves the existing agent inventory format; Event Pass export reserves only fresh unclaimed `single_event` rows and records the print batch and timestamp in `smart_sign_inventory.metadata`.
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
- `[PARTIAL]` `agent_production_uploads`, `agent_production_import_rows`, and `agent_rankings` support Agent Ranking / Production Intelligence. The linked Supabase schema was applied and catalog/advisor verified for these new objects on 2026-06-28, including ListReports activity columns. On 2026-06-30, location/source/confidence fields and matched open-house counts/ids/timestamps were applied to linked Supabase and column verification passed. On 2026-07-26, production `agent_rankings` was consolidated from 42,149 derived rows to 12,524 canonical rows; the database now canonicalizes identity before writes and enforces uniqueness on normalized agent name + brokerage + phone. The 114,153 raw import-history rows remain separate and intact. Authenticated upload-flow behavior still needs verification.
- `[IMPLEMENTED]` `agent_listing_inventory` is live with RLS enabled, no anon/authenticated access, explicit service-role access, and current-agent/listing/open-house indexes. The admin dashboard can invoke the protected inventory-only refresh on demand. The 2026-07-30 production verification first synced 176 canonical website/open-house records with zero canonical agent/address duplicates, then release `2aec8c6` added relationship-scoped OneKey member inventory. Its live run checked 137 worked-with/positive-interest agents with zero lookup failures and wrote or refreshed 557 protected inventory records across enabled sources. Nina Sabag verified the targeted path end to end with 22 current OneKey listings and 3 upcoming open-house entries in Agent Ranking. Inventory syncing does not automatically send outreach; reminder creation remains an explicit manual-review action.
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
- `[IMPLEMENTED]` COMMAND manual replies can optionally attach the exact selected future listing's generated image. Photo messages are forced through the Twilio outreach sender, while the Edge Function verifies the stored media source, current listing/agent identity, render status, and REL8TION storage origin before sending. The control is off by default and the normal operator confirmation, suppression, opt-out, and quiet-hour rules still apply.
- `[IMPLEMENTED]` Production outreach is split by route: toll-free Twilio `+18448211802`/Messaging Service `MG8d7ec49cf1d6d231080b7f870a10eb0b` handles outreach, while `+15168885461` handles event/check-in/owner/system traffic. Android Gateway remains a fallback.
- `[IMPLEMENTED]` REL8TION COMMAND shows Twilio ready, Manual ready, and Auto ready rows. Live: manual / Away: auto changes `rel8tion_runtime_settings.outreach_operator_mode`, while Pause cron / Resume cron intentionally changes row `send_mode`.
- `[IMPLEMENTED]` `/manual-sms-outreach` is the protected cell-send backup. It uses `/api/manual-sms-outreach`, opens the local SMS composer, marks rows sent/skipped only after operator action, and does not exclude Douglas Elliman manual-ready rows.
- `[IMPLEMENTED]` REL8TION COMMAND outreach health treats an empty inbound window as quiet/normal instead of a broken inbox; actual warnings remain for raw/unlinked inbound rows and linked replies missing from the inbox view.
- `[IMPLEMENTED]` Rel8tionOS uses the same manual reply and assignment workflows as REL8TION COMMAND. Its API requires an idempotency key for outbound SMS and preserves centralized suppression, opt-out, routing, and quiet-hour enforcement.
- `[PARTIAL]` Agent Ranking / Production Intelligence stages ranked agents into `agent_outreach_queue` with manual send mode and follow-ups disabled. Real future open-house reminder drafts additionally require manual review, remain unapproved and not queued, and use the actual inventory address/date. It should not be used to send automatic SMS or to game opt-out-rate metrics.
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
- `[IMPLEMENTED]` Agent website Auth route audit is tracked in the nested website-builder repository on `codex/agent-auth-route-audit`: code commit `0998c82`, environment rebuild commit `0a24d41`. The verified Vercel preview artifact was promoted to production on 2026-07-21, and `main` was fast-forwarded to `0a24d41` so Git production automation and the live artifact share the same lineage.
- `[IMPLEMENTED]` Live `my.rel8tion.me` checks after promotion confirmed login 200, unauthenticated dashboard redirect, canonical incomplete-callback error redirect, and the generic recovery API response. Lisa Luttinger's replacement Twilio log confirmed `my.rel8tion.me/auth/callback` with no localhost reference.
- `[RISK]` Promotion/API success is not sufficient proof by itself. Route verification must query `my.rel8tion.me` after the production deployment reports Ready, and account SMS must be inspected by host/path without exposing its one-time token.

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

The authenticated account page creates a short-lived, tab-scoped dashboard unlock marker only after the server validates the signed-in account against an active loan-officer profile. Loan-officer mode on `/field-dashboard` requires both the Supabase session and that unlock marker, and it redirects to `/loan-officer` if either is missing. A remembered Supabase session without a configured phone/PIN lock requires password login again; a configured quick lock must be completed before the marker is renewed.
### Loan officer identity editing and public sharing

Loan officer identity data remains sourced from `verified_profiles`. Authenticated officers and REL8TION COMMAND admins can update profile/contact/company information, while email changes are synchronized to Supabase Auth server-side. The private dashboard displays the same photo/name/company identity but shares `/nmb-verified?slug=...` publicly; private open-house assignments, buyer requests, and messages are never part of the shared profile.
Existing loan officer profiles may predate Supabase Auth. `/api/loan-officer-access-link` bootstraps or recovers the Auth user from an approved `verified_profiles` email and delivers the one-time link to the profile's saved mobile number. Unknown emails receive a generic response, and repeat SMS requests are suppressed for five minutes. Custom SMTP remains a separate production integration.
Loan officer setup texts use a REL8TION-owned verification URL. The server converts Supabase-generated invite/recovery action links into `/loan-officer?token_hash=...&type=...`; the browser verifies the token with `verifyOtp` and never depends on the Supabase Auth Site URL or redirect allow-list for navigation.
### Loan officer account identity compatibility

Authenticated loan-officer dashboards resolve all active `verified_profiles` rows that share the authenticated email when loading assigned field visits. The most recently updated profile remains the editable/display profile, while legacy profile UIDs remain assignment aliases. This prevents prior open-house coverage from disappearing if an established loan officer later completes the newer registration flow.

Loan-officer account-link throttling is checked before generating a Supabase invite/recovery token. This ordering is required because generating a replacement token invalidates the prior one; REL8TION never generates and then withholds a newer token.

The loan-officer dashboard overview and full Open Houses + Buyers section both render listing photos and street addresses from the assigned outreach queue context. The dashboard header renders the active verified profile's public headshot.
Dashboard visit identity is event-first, then outreach-queue-first, then exact listing-and-time. Multiple active database rows resolving to the same identity render as one assignment card, and the general scheduling API reuses the existing non-cancelled visit and participant assignment for those identities.
The authenticated loan-officer Profile section contains the Event Pass field activation guide. It reinforces the physical activation sequence: scan the printed Event Pass QR, tap the same NFC keychain, choose open-house mode, confirm the listing and agent, and activate the pass for buyer QR check-in and agent alerts.
The authoritative loan-officer Event Pass instructions live at `/loan-officer-event-pass-guide`. They follow the QR-first, same-physical-NFC activation flow and distinguish the general agent check-in alert from financing alerts, which require explicit buyer opt-in.
The guide is linked directly from the loan-officer dashboard header and documents the response workflow: the explicit opt-in triggers the assigned live loan officer alert and buyer introduction automatically; the officer then responds by call, text, or REL8TION event chat. Dashboard financing counts and urgent items use only the explicit `metadata.financing_requested=true` flag, never `pre_approved=false` by itself.
Upcoming loan-officer coverage cards provide one-tap driving directions using Apple Maps on Apple devices and Google Maps on other devices.
Confirmed-open-house loan-officer assignment is an operational notification boundary. The assignment is persisted first, then REL8TION sends transactional SMS introductions to the assigned loan officer and hosting agent, attempts configured email delivery, and supplies an Add to Google Calendar link. Notification failures are reported without removing the valid assignment.
Agent event dashboards never invent loan-officer coverage. The LO card is populated only by the event's active `event_loan_officer_sessions` row; without one, the agent sees an unassigned state and can add a specific loan officer.
Confirmed LO assignments create a linked `field_coverage_availability.status=unavailable` window for the scheduled visit. The availability matcher already excludes profiles with overlapping unavailable windows; reassignment replaces only the system-generated block and does not rewrite manual availability.
## Loan-Officer Device Unlock

The authenticated loan-officer account page can enroll a WebAuthn platform credential on the current phone. Returning access uses the phone's Face ID, fingerprint, or device screen lock before opening the field dashboard. The Supabase password/session remains the account security and recovery layer; the locally stored credential identifier is only the device convenience gate. A four-digit local PIN remains available as a compatibility fallback.
## Event Pass Versus Agent Keychain Access

Event Pass NFC identity is event-scoped. It opens the live or historical dashboard for its own event and cannot authorize `/agent-home` or enroll the agent phone-lock session. A regular claimed agent keychain is required for permanent agent-dashboard access and Smart Sign ownership verification.
# Weekly event closeout

Every Monday at 9 AM America/New_York, the protected weekly production job closes stale open events from before that Monday, releases their linked coverage devices, and ends active loan-officer event sessions. It then builds one prior-week production report covering Monday through Sunday. Delivery uses Resend and is idempotent by reporting week; production requires `RESEND_API_KEY` and `PRODUCTION_REPORT_EMAILS`.
# Agent Event Pass requests

The WordPress home page can submit agent Event Pass requests to the service-role-backed `/api/event-pass-request` route. Agent identity and open-house details are stored in `event_pass_requests`. If the agent requests coverage from an existing loan specialist, that professional's name, company, phone, and email are stored for sponsorship follow-up; otherwise the request routes to NMB by default. Submission does not itself assign coverage or grant buyer visibility.

## REL8TION OS Schedule Projection

`field_demo_visits` remains the source of truth for confirmed open-house coverage. REL8TION OS reads a narrow day-window projection through `/api/admin/agent-relationships?view=schedule&from=...&to=...`, authenticated by the dedicated relationship-stream token. The projection excludes cancelled visits and enriches display-only agent and address fields from `agent_outreach_queue` and `open_houses`; it does not create, update, or delete schedule records.

Historical open houses that were completed before the field-visit workflow are represented by append-only `agent_relationship_events` markers rather than fabricated visit rows. The relationship API projects the latest confirmed/removed marker into `historical_open_house_agent`, keeping automatic visit evidence and user-confirmed legacy history distinct.

## Universal Authenticated Application Architecture

The universal application work is implemented on the isolated `feature/role-aware-dashboard` branch and is not a production claim until its preview and deployment state are separately verified.

### Application and marketing boundaries

- `rel8tion.me` remains the public marketing website.
- `app.rel8tion.me` is designed as the authenticated operating application.
- An unauthenticated application request receives a compact gateway for sign-in, invitation, device activation, or event/activation-code entry.
- Authenticated users share one responsive application shell. Role-specific behavior is configuration and server-authorized data scope, not a collection of unrelated dashboards.
- Physical NFC, QR, Event Pass, Smart Sign, check-in, disclosure, activation, profile, and invitation URLs remain separate permanent public contracts.

### Session boundary

The universal shell does not trust a role, organization, or workspace value supplied by the browser. Password authentication is exchanged with Supabase Auth by a serverless route. The server stores access and refresh tokens in Secure, HttpOnly, SameSite=Lax cookies, verifies the user through Supabase Auth on session requests, refreshes expired access tokens server-side, and marks all authenticated responses `private, no-store`.

The server resolves available workspaces from database membership records. A workspace-switch request contains only an opaque workspace id; the server accepts it only when the authenticated user has an active membership. User-editable Auth `user_metadata` may provide a display name but never grants a role or permission.

### Role, permission, and assignment model

The additive `app_*` schema proposal separates:

- Organizations
- Role-specific workspaces
- User-to-workspace memberships
- Fine-grained permission overrides
- Domain assignments for organizations, teams, territories, agents, buyers, events, accounts, or support cases
- Tasks
- Activity events
- Privileged audit records

Supported role configurations are agent, loan officer, broker/team leader, buyer, internal staff, founder, and platform administrator. A user may belong to multiple role/organization workspaces. Platform administration is a permission in addition to an operating role; it is not the default homepage.

Every proposed table has RLS enabled. Authenticated read policies require the caller's active membership or direct assignment, and no anon access is granted. Privileged writes remain reserved for server APIs using the service role after application authorization and audit checks.

The migration is intentionally unapplied by the feature branch. Because current Vercel previews inherit production-connected Supabase credentials, UI preview testing must be read-only until an isolated Supabase branch or test project is configured.

### Data adapters and honest empty states

Dashboard data is assembled server-side after role, permission, organization, and domain-assignment verification. The home response contains:

- One highest-priority assigned action
- Authorized today counts
- Assigned relationships requiring attention
- Verified workspace activity
- Permission-filtered quick actions
- A non-executing AI command interface

No demonstration metrics are presented as production facts. When the required assignment or source table does not exist, the shell displays a setup or empty state and explicitly reports that the optional source is not provisioned.

For backward compatibility, an authenticated user may receive a loan-officer workspace only when the Supabase Auth user id exactly matches an active `verified_profiles.uid`. This fallback never derives role authority from browser parameters or Auth user metadata. Other unprovisioned accounts receive an onboarding-only workspace with no customer-data access.

### Internal administration

`/admin` is a server-gated entry. An application user needs the server-resolved `platform.admin` permission before entering the platform administration shell, and `/api/app/admin-summary` independently enforces the same permission before returning data. When no universal-application session exists, the entry redirects to same-origin `/command?entry=admin`; this lets the established COMMAND page reuse a browser-stored admin UID/token that cannot be read by the server entry route, without embedding or returning privileged data.

The existing REL8TION COMMAND tool remains separate at `/command` and retains its dedicated token or allowlisted admin NFC UID boundary on every privileged API call. Existing admin NFC scans that include the verified UID continue through `/admin?uid=...` and are redirected to COMMAND only after server verification.

The administration shell itself embeds no platform data. A direct request that does not pass the data API authorization receives no administrative payload.
