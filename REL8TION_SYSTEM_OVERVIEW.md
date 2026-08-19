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
- `[IMPLEMENTED]` HomeKey / Property Keepsake QR is a separate permanent buyer relationship surface for 3D-printed take-home houses. COMMAND creates an idempotent `property_keepsakes` attribution record and printable QR; `/h/:public_code` reuses the `/l` property pipeline while preserving the listing agent and loan officer attached when the physical HomeKey was created. Listing-agent display rejects generic placeholder names and resolves the same open-house/contact identity through exact listing, outreach, inventory, and canonical agent sources. It is not Event Pass, Smart Sign, Rel8tionChip, NFC, activation, admin QR, or mandatory check-in inventory.
- `[IMPLEMENTED]` A secured production cron refreshes active events and confirmed/scheduled upcoming property profiles every three hours, prioritizing missing/single-photo galleries and trying the OneKey unique listing id, listing key, BUPI, and embedded public media before preserving the existing gallery fallback.
- `[IMPLEMENTED]` Shared open-house coverage supports two carried Event Passes plus one stationary Smart Sign or Loan Officer Coverage Sign, all pointing to one event and dashboard with a three-device cap.
- `[PARTIAL]` REL8TION COMMAND admin operations.
- `[IMPLEMENTED]` REL8TION COMMAND's additive Agent Performance board centralizes each agent's identity, outreach/conversation history, upcoming open houses, known listings, leads, keychains, and ranking link without removing the original source workspaces. Its future-open-house view supports agent/property search plus relationship, date-range, and local start-time filters, ranking accepted/worked-with agents first, then interested agents, agents with prior sent outreach, and new agents. An open-house agent click opens one focused property/agent workflow with contact actions and a linked REL8TION SMS composer instead of redirecting to a generic conversation list; rendered outreach media and its queue linkage survive later merges from listing inventory, listing-agent, and canonical open-house feeds. Unfocused agent and opportunity lists render in bounded increments for browser performance.
- `[IMPLEMENTED]` COMMAND identity aggregation is person-specific. Canonical UUIDs, row IDs, phones, emails, and fuzzy import scores are accepted only when usable first-and-last names remain compatible; a brokerage office phone cannot merge different agents' listings, history, relationships, or photos. Middle initials and credential suffixes are treated as harmless variants. Headshot propagation applies the same name boundary, and ambiguous photo URLs shared across incompatible people are suppressed until a person-specific image is verified.
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
- `[INTENDED]` A normal Event Pass may become the paying agent's reusable Rel8tionChip between events; this does not require an Open House Kit or separate hardware purchase. Active-event operation remains available for the authorized host, while permanent dashboard/digital-card access requires an active REL8TION Agent membership.
- `[RISK]` Root wrapper files and app files are not identical.

## Runtime Architecture

REL8TION is deliberately lightweight:

- `[IMPLEMENTED]` Static Vercel pages in `apps/rel8tion-app`.
- `[IMPLEMENTED]` Root static wrappers and public pages such as `a.html` and `b.html`. On the role-aware feature branch, the obsolete root `index.html` smoke test and `admin.html` forwarding alias are removed so Vercel's static filesystem cannot shadow the universal `/` rewrite or bypass the server-authorized `/admin` entry.
- `[IMPLEMENTED]` Root Vercel serverless API routes under `api/`.
- `[IMPLEMENTED]` The admin dashboard API exposes a unified, read-only Agent Performance projection assembled from existing Supabase sources. It labels relationship priority from accepted/confirmed visits, hosted REL8TION events, positive outreach status, and verifiably sent outreach; unsent queue preparation does not establish prior outreach. Missing optional listing inventory degrades to warnings instead of blocking the rest of COMMAND.
- `[IMPLEMENTED]` COMMAND loads that full multi-source dashboard projection once, then keeps normal area/agent/open-house navigation inside the existing browser shell. Cached agent/open-house indexes serve drill-downs, browser Back/Forward restores dashboard state, and a visible-tab-only lightweight refresh updates outreach/relationship data without repeatedly downloading the full dashboard snapshot. When a focused agent is older than every capped initial source slice, the admin-authenticated exact-profile endpoint hydrates that identity on demand across its saved agent, outreach, conversation, listing, visit, lead, keychain, open-house, event, and ranking records instead of raising the global limits or showing a false zero-match result.
- `[IMPLEMENTED]` COMMAND defers relationship hydration until after first paint and uses a summary-only relationship projection without follow-up conversation expansion. Focused agent detail sections render in 20-row increments. Active REL8TION field visits expose the same cancellation action from Accepted Open Houses, the focused agent/open-house workflow, and matched future-opportunity cards. Accepted/confirmed outreach without a field visit can be returned to interested without deleting its source listing or conversation history; unaccepted source-feed listings remain non-destructive.
- `[IMPLEMENTED]` Missing Agent Performance portraits can be supplied directly from the card placeholder through an admin-authenticated upload. COMMAND normalizes the headshot to 4:5, stores it in `agent-images`, records it as manually verified, and synchronizes identity-matched canonical agent, outreach, listing-agent, website, relationship, and ranking records so downstream agent surfaces converge on the same photo.
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
- `[IMPLEMENTED]` `/agent-home` is the private owner dashboard for normal claimed agent NFC scans and paid, idle Event Pass Rel8tionChips.
- `[IMPLEMENTED]` `/c/:code` and `/chip/:code` resolve printed Rel8tionChip QR inventory.
- `[IMPLEMENTED]` `/a` and `/b` are public/legacy profile and lead-capture routes, not normal claimed NFC owner access.

Agent and loan officer Rel8tionChip behavior is intentionally split: printed QR is public/profile oriented, while NFC is private owner/operator access.

The agent owner dashboard validates the claimed NFC UID/agent pairing before loading private data. `/k` exchanges that physical tap for a signed, Secure, HttpOnly, SameSite=Strict 30-minute server session; every private event/history request revalidates that the UID is still claimed by the same agent. Normal keychains retain the rate-limited six-digit SMS challenge before a new phone enrolls a local platform credential. A paid Event Pass Rel8tionChip uses the tapped claimed NFC identity without adding that SMS step, then uses the existing Face ID, fingerprint, or phone screen-lock credential locally. Full server-side WebAuthn signature persistence and account recovery remain future hardening work.

### Smart Signs

- `[IMPLEMENTED]` `/sign-demo-activate` handles smart sign setup and listing binding.
- `[IMPLEMENTED]` `/s` and `/sign` resolve smart sign public codes and route to setup or live event state.
- `[IMPLEMENTED]` Front smart sign NFC is buyer-facing and routes to check-in.
- `[IMPLEMENTED]` Event Pass activation treats the printed QR public code and NFC UID as one physical identity. If its inventory link is missing but the backing sign row remains, the flow may relink only that exact matching pair; mismatched passes stop instead of creating or cross-linking records.
- `[IMPLEMENTED]` Rear smart sign NFC is operator-facing and requires an agent keychain challenge before dashboard access.
- `[IMPLEMENTED]` A smart sign attaches to one active live open house event at a time.

### Event Pass And Sponsored Event Pass

- `[IMPLEMENTED]` `/pass` resolves Event Pass printed QR rows from `smart_sign_inventory.public_code`.
- `[IMPLEMENTED]` A deliberately converted printed agent QR may route from `/c/:code` to `/pass?code=...` only when the original agent inventory row is retired and the matching Event Pass row contains explicit conversion metadata tied to that original row id. `smart_sign_inventory.public_code` remains the Event Pass source of truth.
- `[IMPLEMENTED]` A fresh Event Pass QR scan presents a visual NFC handoff showing the physical pass approaching the correct iPhone and Android NFC areas; public codes and chip-status jargon are hidden from the normal field instruction.
- `[IMPLEMENTED]` Successful normal Event Pass activation shows one concise field-use handoff: visitors scan the printed QR to check in, while the agent taps the Event Pass NFC to reopen the live dashboard. The screen contains one dashboard action and no pass code, event id, setup explanation, buyer-route shortcut, or restart menu. The dashboard header provides a contextual **Get Support** email action without placing the NFC UID in the message.
- `[IMPLEMENTED]` `/sponsored-pass-activate` activates reusable Sponsored Event Passes.
- `[IMPLEMENTED]` Sponsored Event Pass activation records `event_pass_coverage_consents` before sponsor visibility.
- `[IMPLEMENTED]` `/api/event-pass/action` is the server authorization boundary for normal Event Pass registration. It derives the host from the claimed keychain, compares stored agent identity with the listing agent, permits an explicitly confirmed substitute only when the stored brokerage matches, then creates or recovers the exact QR/NFC backing sign and locks the event, sign, and inventory to that agent with the service role. The fresh-pass browser flow carries only an in-memory placeholder and cannot create Event Pass sign rows through the anonymous Data API. Sponsored activation uses the same authorization module; free-form brokerage text alone cannot authorize a substitute.
- `[IMPLEMENTED]` `/event-pass-reuse` is the full-screen continuation route when a previously used normal Event Pass has no active REL8TION Agent entitlement. It preserves the physical pass and selected-listing context and offers loan-officer-sponsored limited use first when the server can resolve an active assigned loan officer; the agent must consent for that event before the server creates sponsor visibility. The full REL8TION choice uses the catalog-controlled `$29/month` Agent plan, removes the sponsorship message, and returns successful or canceled Checkout to the interrupted registration instead of asking for another NFC tap.
- `[IMPLEMENTED]` Event Pass registration sends the owner an event-idempotent email through the existing REL8TION SMTP configuration with Resend fallback and retains delivery status in the event setup context. The database trigger in `20260816235025_enforce_event_pass_host_authorization.sql` independently rejects unauthorized normal Event Pass writes and forces Sponsored Event Pass inserts through the service-role server path; it was applied and advisor-checked on 2026-08-16.
- `[IMPLEMENTED]` Event Pass and Smart Sign may both be active for the same listing/open-house context because routing is device/sign-aware.
- `[IMPLEMENTED]` A normal Event Pass is blocked only while it has a current live event. After that event ends it may be reused by its locked agent; transfer to another agent requires an explicit reset/reassignment.
- `[IMPLEMENTED]` REL8TION COMMAND manages normal Event Passes as their own inventory product rather than as detachable Smart Signs. Its Freshen action atomically clears the inventory assignment, Event Pass NFC owner, pending activation sessions, and backing-sign owner while preserving the printed public code and historical events; the server rejects the narrower Smart Sign detach action for Event Pass backing rows.
- `[IMPLEMENTED]` NFC lifecycle is stateful: a live pass opens its event dashboard; an ended or otherwise idle pass opens the locked paying agent's Rel8tionChip home. That home presents the public digital card plus a Start Open House action bound to the same QR/NFC pair. Without an active REL8TION Agent entitlement, it shows membership checkout and withholds private event history.
- `[IMPLEMENTED]` The activation confirmation explicitly distinguishes the listing agent from a same-company/same-brokerage substitute. The checkbox/radio choice is only a declaration; `/api/event-pass/action` remains authoritative and rejects another-company or unverified/manual-listing activation.

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

- `[IMPLEMENTED]` `/event` is the buyer check-in page. It presents a permanent **Start Check-In** action directly below the property/host card and a first-viewport fixed action until the visitor reaches the form; either reveals the **Buyer / With Agent / Agent** path and contact fields. Contact fields opt into grouped native browser autofill; financing answers and disclosure acknowledgements are not persisted locally.
- `[IMPLEMENTED]` `/event-chat` is the buyer return chat page for dashboard-triggered SMS links.
- `[IMPLEMENTED]` `/agent-dashboard` is the host-agent live event dashboard.
- `[IMPLEMENTED]` `/api/agent-event-dashboard` is the private data and closeout boundary. It requires the short-lived NFC session, revalidates the claimed key, checks `open_house_events.host_agent_slug`, and verifies the sign/event pairing before using the service role. The browser dashboard contains no direct `event_checkins`, `open_house_events`, or `smart_signs` Data API calls.
- `[IMPLEMENTED]` `/api/event-checkin` is the public buyer write boundary. The buyer page sends a validated check-in payload to the server and never needs anonymous Event Pass table access. Event Pass check-in rows are hidden from anonymous/authenticated Data API reads by RLS; remaining non-Event-Pass policies are an explicit compatibility lane for older Smart Sign flows.
- `[PARTIAL]` REL8TION COMMAND at `/admin` is the operational admin dashboard. It includes a Buyer Finder workspace backed by `/api/admin/buyer-home-finder` for admin-only searching, filtering, sorting, and printable buyer-report generation across upcoming open-house/listing records.
- `[IMPLEMENTED]` `/h/:public_code` is the permanent public HomeKey route. It resolves server-side through the existing open-house property renderer, never exposes activation or COMMAND controls, permits anonymous browsing, and creates or updates an attributed COMMAND lead only after the buyer selects a follow-up action and explicitly consents.
- `[IMPLEMENTED]` REL8TION COMMAND has a dedicated Open Houses workspace. Live events render before scheduled coverage and recent history, link directly to the event dashboard, and no longer sit below sign inventory. An admin can cancel a scheduled or confirmed open house with explicit confirmation; the service-role event action preserves history, releases field participants and availability blocks, restores accepted outreach to interested status, and ends any matching live event through the shared sign and loan-officer cleanup path.
- `[IMPLEMENTED]` REL8TION COMMAND Reports defaults to the complete confirmed/accepted open-house history, newest first. Historical report data is loaded independently of the recent outreach feed, field visits and participants are paged, all matching cards render, and Upcoming/Previous filters remain available.
- `[IMPLEMENTED]` Reports also surfaces historical inbound outreach threads that still need an explicit open-house confirmation. Operators can review the saved reply and choose the correct coverage date; REL8TION does not automatically treat ambiguous replies as confirmed visits.
- `[IMPLEMENTED]` Recovery eligibility is based on the saved inbound message history rather than the latest thread direction, preserving review visibility after later outbound follow-ups.
- `[PARTIAL]` `/admin/agent-ranking` is the Agent Ranking / Production Intelligence module. It accepts ListReports-style CSV exports, normalizes agent/contact/listing/buyside/location activity fields, infers county/source/confidence, scores opportunity fit, supports server-side sorting/filtering/pagination, and provides a clickable full-width agent profile modal with matched current listing/open-house records and real prior REL8TION open-house history. **Create REL8TION Prospect** is a general, non-sending CRM lane: it checks canonical agents, agent websites, and relationships; links an existing member or relationship when found; otherwise creates one `agent_relationships` prospect with saved invitation drafts. It never creates an open-house queue row or sends a message. Only a separately selected, verified future listing can create the existing manual open-house reminder draft. Profile portraits use a shared identity-verified fallback chain across the canonical agent, agent website, enriched outreach, and listing-agent records; exact phone/email matching takes precedence and contact-less fallback requires exact name plus compatible brokerage. The profile and Marketing Report receive the same resolved portrait. **Worked together** is established only by ended REL8TION events or past confirmed/live/completed field visits, deduplicated by source open house and joined to the real source address/date when available; imported activity estimates and preview data are excluded. The ListReports `active_listing_count` field is presented as an unverified imported listing signal across the table, profile, area comparison, pitch, and report—not as verified current inventory. Actual current listings and upcoming open houses come from the separate REL8TION inventory sync. The dashboard view is gated to trusted ListReports mappings with identity and phone present, retains defensive display deduplication, and does not present production volume, average price, or transaction count as ListReports-imported data. Ranking upsert identity combines normalized agent name, brokerage, and phone; location is excluded so repeated county/market reports update one current ranking, while name and brokerage keep different agents on a shared office phone separate. Blank numeric filters are treated as no limit, not zero, market filter values are canonicalized so typos or encoded geometry values do not split campaign-ready counts, admin ranking reads page through Supabase instead of relying on a single capped REST response, and filter edits stay local until Apply/Search is clicked so typing in search fields does not query the database per keystroke. Area comparison returns peer rank context, including opportunity-score rank and metric ranks, for profile/report marketing use. Raw uploaded rows remain in `agent_production_import_rows`; `agent_rankings` holds only the canonical current row for each identity. Large confirm imports defer deep open-house matching to profile drill-down or explicit refresh so uploads stay within function time limits. XLS/XLSX import and manual low-confidence match review are not complete.
- `[PARTIAL]` Agent Ranking distinguishes the imported ListReports listing signal from actual current database listings. Its searchable population unions trusted ListReports rankings with relationship-only agents proven by prior REL8TION history or positive outreach state, so enrichment is not required before a worked-with/interested/confirmed/accepted agent can be found. Relationship-only rows are explicitly labeled `ListReports: Not imported`, use no fabricated production metrics, and deduplicate against trusted rankings. Protected `agent_listing_inventory` rows reuse verified current agent-website listings and future open-house rows for ranked agents, claimed agents, prior-work agents, and positive-interest outreach relationships, deduplicating the same agent/address across sources. Current inventory is visible in the admin profile; future listing marketing eligibility is limited server-side to claimed/worked-with or positive-interest relationships. For an eligible real future inventory record, the admin can draft a "have me there" reminder containing its actual address/date. The queue record is manual, unapproved, blocked for review, and has follow-ups disabled, so drafting does not send an SMS. Broad geographic OneKey discovery remains disabled. The separately gated targeted OneKey path starts with positive relationships and every verifiably sent prior-outreach agent, rotates through that population with a protected runtime cursor, reuses previously verified stable OneKey identities, and queries current Sale and Rent listings by member key. Exact-name/contact conflict rules remain mandatory. When separately enabled, reverse-discovered upcoming events are cross-referenced by source ID or normalized address/start time, existing canonical IDs and sources are preserved, and missing events are inserted. The two-hour sync and open-house promotion introduce no automatic messaging.
- `[IMPLEMENTED]` Agent Ranking collapses separate ListReports ranking rows into one display identity when they share the same canonical `agent_id` and exact normalized phone, even if brokerage labels differ between exports. The newest source snapshot provides the visible identity, while duplicate ranking/upload identifiers remain preserved in display metadata and the raw import tables remain unchanged. This read-model consolidation does not alter public agent websites or their listing records.

### Open House Kit And Website Builder

- `[IMPLEMENTED]` `/get-open-house-kit`, `/kit-confirm`, and `/kit-intake` support Complete Open House System acquisition, keychain prefill, company-branding intake, shipping intake, and Stripe Checkout handoff. The Event Pass handoff still arms on `irel8.me` so the physical NFC tap can consume the pending intent. `config/pricing-catalog.json` is the single tracked source for product amounts, composite checkout rules, renewals, features, eligibility, entitlements, fulfillment, and Stripe lookup keys. `/api/public/pricing` supplies normalized pricing to REL8TION public pages and the website builder, with wildcard CORS because the catalog is public and is consumed cross-origin by the WordPress site.
- `[IMPLEMENTED]` Public pricing and marketing calls to action use a payment-first Checkout sequence: select monthly or annual, enter the Stripe-required email/payment information, and provide profile, branding, shipping, and setup details in secured post-payment onboarding. Event Pass/keychain-prefill remains available when field-linked context needs to be carried into setup.
- `[PARTIAL]` The signed Stripe checkout webhook records catalog-coded post-checkout entitlements in the server-only `pricing_entitlements` ledger defined by `supabase/migrations/20260802100949_pricing_entitlements.sql`. Paying-agent Event Pass checkout first validates the claimed NFC UID/agent pair, carries both in Checkout metadata, and uses the same idempotent entitlement mapping from the signed webhook and server-verified Checkout return. Subscription/invoice lifecycle events update access status. The migration was applied to linked production on 2026-08-02 and forced RLS, indexes, and browser-role revocation were verified. The live Stripe endpoint and rotated Vercel production signing secret were configured on 2026-08-17 for the seven supported events; designated signed event delivery remains `[NEEDS VERIFICATION]`.
- `[IMPLEMENTED]` `/book-a-call` is the native REL8TION consultation calendar for private loan-officer programs and real estate broker/team discounts. Availability comes from `config/booking-calendar.json`; `/api/bookings/availability` and `/api/bookings/create` use a server-only Supabase booking ledger with a partial unique index for confirmed slots. The booking migration was applied to linked production on 2026-08-02 and forced RLS, indexes, and browser-role revocation were verified. Vercel production uses the existing REL8TION SMTP account for `.ics` invitations to the visitor and `jared@rel8tion.me`, with Resend as a fallback. Production release `57a3623` and deployment `dpl_5i1Gxvn9Ym5aGrxUQsZQsvCHaoJ7` serve the calendar and verified availability route. A designated real-delivery smoke test remains `[NEEDS VERIFICATION]` because verification did not create a fake reservation.
- `[IMPLEMENTED]` `/api/checkout/stripe-webhook` verifies Stripe signatures and records eligible Open House Kit Checkout Sessions in `open_house_kit_orders` for fulfillment review.
- `[IMPLEMENTED]` `/api/checkout/website-promo` verifies paid kit checkout, stores the paid kit order as a browser-return fallback, creates a hashed dashboard access token, attempts the welcome email/text workflow, and returns the buyer to `/kit-dashboard`. Catalog metadata grants the included Digital You entitlement and makes its onboarding link available in the secured kit dashboard without generating an expiring promotion code.
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
- `[IMPLEMENTED]` General Agent Ranking invitation prospects also live in `agent_relationships` with `relationship_status=prospect`, a general-invitation draft bundle, and explicit non-sending metadata. `agent_outreach_queue` remains reserved for a real linked open house.
- `[IMPLEMENTED]` `agent_relationship_events` is the deduplicated chronological relationship stream for outreach, replies, confirmed open houses, field visits, notes, pins, follow-up markers, referrals, and REL8TION OS synchronization. A follow-up is active when the latest follow-up event is `follow_up_marked` and cleared when the latest is `follow_up_cleared`.
- `[IMPLEMENTED]` `agent_board_v1` is the service-role-only, `security_invoker` board projection used by relation.me and REL8TION OS.
- `[IMPLEMENTED]` `/api/admin/agent-relationships` is the privileged read/write boundary for the shared stream. Browser and desktop clients must not receive the Supabase service-role key.
- `[IMPLEMENTED]` REL8TION OS uses a dedicated production credential to read and dual-write the relation.me relationship stream. The one-time local history migration completed on 2026-07-26 for 404 worked-with agents and one saved note; local pin/note storage remains only as an offline fallback.
- `[IMPLEMENTED]` For relationships currently marked Follow Up, the authenticated board projection also reads existing sent outreach from `agent_outreach_queue` and linked inbound/outbound history from `agent_outreach_replies`. Exact phone, email, or source-row identity is required; the projection does not duplicate or mutate message records.
- `[IMPLEMENTED]` `agents.slug` identifies agent profiles.
- `[IMPLEMENTED]` `keys.uid` stores NFC UID rows; `keys.agent_slug` links claimed agent keychains by convention.
- `[IMPLEMENTED]` `rel8tion_chip_inventory` stores printed agent/LO QR inventory.
- `[IMPLEMENTED]` REL8TION COMMAND's QR Batch Printing dropdown supports Agent Rel8tionChip, Smart Sign, and Event Pass fulfillment ZIPs containing a CSV and identically named high-resolution PNG files. Agent and Event Pass exports reserve existing eligible unprinted inventory; Smart Sign generation creates 1-100 new `inventory_type=smart_sign` rows with canonical `/s?code=...` destinations and batch metadata. Event Pass export remains restricted to fresh unclaimed `single_event` rows.
- `[IMPLEMENTED]` `smart_signs` stores physical smart sign state including `uid_primary`, `uid_secondary`, and `active_event_id`.
- `[IMPLEMENTED]` `smart_sign_inventory.public_code` stores printed Smart Sign and Event Pass QR source-of-truth codes.
- `[IMPLEMENTED]` `property_keepsakes` is the separate HomeKey public-code and durable-attribution table; it references the existing open house, optional event/visit, listing-agent row, and verified loan officer without copying listing facts. `property_keepsake_events` is the minimal server-written HomeKey view/contact/action stream. Both have RLS enabled and are service-role-only.
- `[IMPLEMENTED]` `loan_officer_coverage_signs` stores LO Coverage Sign public code and NFC assignment.
- `[IMPLEMENTED]` `open_house_events.host_agent_slug` stores the event host. Older `agent_slug` assumptions for this table are stale.
- `[IMPLEMENTED]` `event_checkins` stores event-specific buyer attendance/action records.
- `[PARTIAL]` `leads` stores broader/global buyer lead records. HomeKey uses nullable `source`, unique `source_key`, `metadata`, and `updated_at` fields so one buyer/HomeKey identity can accumulate explicitly selected actions without duplicate CRM rows.
- `[IMPLEMENTED]` `event_loan_officer_sessions` stores live LO coverage.
- `[IMPLEMENTED]` `event_pass_coverage_consents` stores Sponsored Event Pass per-event consent.
- `[PARTIAL]` `agent_outreach_queue`, `agent_outreach_replies`, and delivery-event tables support outreach.
- `[PARTIAL]` `open_house_kit_orders` stores Stripe Checkout Sessions for Open House Kit fulfillment and onboarding, including dashboard security state, selected/custom logo fields, and welcome email/SMS status. `company_logos` stores seeded approved company-logo choices; `open_house_kit_access_tokens` stores hashed dashboard/magic-link/chip-scan tokens; `open_house_kit_notifications` logs welcome email/SMS attempts. Live Stripe webhook dashboard configuration and email provider env still require verification.
- `[PARTIAL]` `agent_production_uploads`, `agent_production_import_rows`, and `agent_rankings` support Agent Ranking / Production Intelligence. The linked Supabase schema was applied and catalog/advisor verified for these new objects on 2026-06-28, including ListReports activity columns. On 2026-06-30, location/source/confidence fields and matched open-house counts/ids/timestamps were applied to linked Supabase and column verification passed. On 2026-07-26, production `agent_rankings` was consolidated from 42,149 derived rows to 12,524 canonical rows; the database now canonicalizes identity before writes and enforces uniqueness on normalized agent name + brokerage + phone. The 114,153 raw import-history rows remain separate and intact. Authenticated upload-flow behavior still needs verification.
- `[IMPLEMENTED]` `agent_listing_inventory` is live with RLS enabled, no anon/authenticated access, explicit service-role access, and current-agent/listing/open-house indexes. The admin dashboard can invoke the protected inventory-only refresh on demand. The 2026-07-30 production verification first synced 176 canonical website/open-house records with zero canonical agent/address duplicates, then release `2aec8c6` added relationship-scoped OneKey member inventory. Nina Sabag verified that targeted path end to end with 22 current OneKey listings and 3 upcoming-open-house entries. Production release `7b156d26` expanded reverse discovery to all verifiably sent prior outreach, added the protected rotation cursor and verified OneKey identity cache, and enabled safe canonical `open_houses` promotion. Promotion now resolves listing URLs against historical and upcoming canonical events before upsert, preserves an existing canonical row ID/source on collisions, deduplicates same-run URL discoveries, and rounds fractional living area only for integer-backed `open_houses.sqft`. The production batch is now 500 agents per two-hour run; its verification scanned 500 of 2,097 eligible profiles in 14.3 seconds with zero failures, matched 463 identities, examined 2,261 listings, attached agent data to 21 existing events, inserted 19 missing events, and advanced the cursor from 250 to 750. Inventory syncing does not automatically send outreach; reminder creation remains an explicit manual-review action.
- `[PARTIAL]` `agent_websites` and `agent_website_listings` support the website-builder app.

## Messaging, Outreach, And Compliance

- `[PARTIAL]` `send-lead-sms` source is checked in under `supabase/functions/send-lead-sms` and uses the shared SMS provider layer.
- `[NEEDS VERIFICATION]` Deployed function source/version, provider env, and live SMS behavior still need verification.
- `[IMPLEMENTED]` Open House Kit post-payment welcome SMS calls `send-lead-sms` as `event_transactional`; welcome email uses Resend when `RESEND_API_KEY` and a sender address are configured in Vercel. Both channels include the `/kit-dashboard` access link and are logged through `open_house_kit_notifications`.
- `[IMPLEMENTED]` `/event` sends buyer/agent SMS only after local check-in validation and disclosure completion.
- `[IMPLEMENTED]` The Vercel send cron and `send-agent-outreach` Edge Function enforce the owner-approved automatic-send ceilings of 7 per run, 20 per rolling hour, and 150 per rolling 24 hours. Eligible rows are limited to a configurable rolling upcoming-event horizon (default seven days) and prioritized by the earliest `open_start`, then due send time. Automatic initial sends do not require `approved_for_send=true`; eligible rows are `send_mode=automatic`, generated, rendered, due, with a listing photo and pending initial SMS copy.
- `[IMPLEMENTED]` The protected Vercel generation cron first invokes the existing duplicate-safe `queue_recent_outreach_candidates()` RPC, then calls `generate-agent-outreach`. This source-agnostic handoff ensures completed future open-house enrichment can reach `agent_outreach_queue` even when the enrichment source itself does not invoke queue staging.
- `[IMPLEMENTED]` Direct sender invocation requires the service-role credential. An owner-directed batch may explicitly request a service-role-only health-gate override after provider-health review; recipient STOP/opt-out and duplicate-phone suppression remain mandatory.
- `[IMPLEMENTED]` A service-role-managed `outreach_release_window` runtime setting may temporarily let normal cron runs bypass the aggregate health stop only through a specified open-house timestamp and only until its expiration. It does not bypass STOP/opt-out, duplicate-phone, quiet-hours, readiness, or rate-limit controls.
- `[IMPLEMENTED]` Automated outreach has a global runtime pause via `rel8tion_runtime_settings.key='outreach_send_paused'` or `OUTREACH_SEND_PAUSED=true`; when enabled, live runs send nothing and report `paused=true`, while authenticated dry runs can inspect candidates.
- `[IMPLEMENTED]` While outreach send pause mode is active, `generate-agent-outreach` stages newly generated outreach as `send_mode=manual`, `review_status=manual_ready` so rows flow into the cell-send queue instead of automatic sending.
- `[IMPLEMENTED]` As of 2026-06-28, generic outreach follow-up/drip scheduling is disabled while opt-out health is recovered. Existing live pending follow-ups were cleared to `followups_disabled`, and the current generator/sender leave future follow-up fields unscheduled unless intentionally re-enabled. Inbound Y/N confirmations and operator-composed direct replies remain separate active response paths.
- `[IMPLEMENTED]` SMS provider selection is route-scoped: `SMS_OUTREACH_PROVIDER` controls outreach/manual outreach, `SMS_EVENTS_PROVIDER` controls buyer/event/owner operational traffic, and both fall back to `SMS_PROVIDER`.
- `[IMPLEMENTED]` Twilio sender selection is also route-scoped. Outreach can use `TWILIO_OUTREACH_MESSAGING_SERVICE_SID` or `TWILIO_OUTREACH_FROM_NUMBER`, while operational traffic can use `TWILIO_EVENTS_FROM_NUMBER`; an all-Twilio outreach configuration requires a dedicated outreach sender instead of falling back to the regular number.
- `[IMPLEMENTED]` Opt-out suppression is global across provider routes and fails closed. The inbound handlers process STOP-family keywords and explicit START/UNSTOP, and STOP marks matching queue rows opted out across the phone number.
- `[IMPLEMENTED]` Outreach recovery safety includes a 30-day same-phone cooldown, rolling seven-day opt-out health gate with an owner-approved 5% maximum, 7-day maximum age for missed-open-house outreach, shorter permission-oriented first contact, and follow-ups disabled. Initial MMS is disabled by code default but explicitly enabled in current production after owner approval and verified toll-free delivery; it attaches the generated outreach image first and the NMB business card second. Android Gateway remains text-only.
- `[IMPLEMENTED]` COMMAND manual replies can optionally attach the exact selected future listing's generated image. Photo messages are forced through the Twilio outreach sender, while the Edge Function verifies the stored media source, current listing/agent identity, render status, and REL8TION storage origin before sending. Operator-composed replies omit the repeated STOP footer after the initial outreach disclosure; operator confirmation, suppression, opt-out, and quiet-hour rules still apply.
- `[IMPLEMENTED]` Production outreach is split by route: toll-free Twilio `+18448211802`/Messaging Service `MG8d7ec49cf1d6d231080b7f870a10eb0b` handles outreach, while `+15168885461` handles event/check-in/owner/system traffic. Android Gateway remains a fallback.
- `[IMPLEMENTED]` REL8TION COMMAND shows Twilio ready, Manual ready, and Auto ready rows. Live: manual / Away: auto changes `rel8tion_runtime_settings.outreach_operator_mode`, while Pause cron / Resume cron intentionally changes row `send_mode`.
- `[IMPLEMENTED]` `/manual-sms-outreach` is the protected cell-send backup. It uses `/api/manual-sms-outreach`, opens the local SMS composer, marks rows sent/skipped only after operator action, and does not exclude Douglas Elliman manual-ready rows.
- `[IMPLEMENTED]` REL8TION COMMAND outreach health treats an empty inbound window as quiet/normal instead of a broken inbox; actual warnings remain for raw/unlinked inbound rows and linked replies missing from the inbox view.
- `[IMPLEMENTED]` Rel8tionOS uses the same manual reply and assignment workflows as REL8TION COMMAND. Its API requires an idempotency key for outbound SMS and preserves centralized suppression, opt-out, routing, and quiet-hour enforcement.
- `[PARTIAL]` Agent Ranking / Production Intelligence stages ranked agents into `agent_outreach_queue` with manual send mode and follow-ups disabled. Real future open-house reminder drafts additionally require manual review, remain unapproved and not queued, and use the actual inventory address/date. It should not be used to send automatic SMS or to game opt-out-rate metrics.
- `[IMPLEMENTED]` Durable Twilio outreach recovery settings live in `docs/twilio-outreach-sms-runbook.md`; keep that runbook and the source-of-truth docs aligned.
- `[IMPLEMENTED]` Twilio route separation is live and verified: operational SMS uses `+15168885461`, and outreach uses registered toll-free `+18448211802` through Messaging Service `MG8d7ec49cf1d6d231080b7f870a10eb0b`. Outbound MMS delivered, the service-level inbound webhook was corrected from ElevenLabs to Rel8tion, an inbound test linked to the outreach queue, and the operational owner alert queued. The global pause is off; fresh eligible rows are limited to 7/run, 20/hour, and 150/day while opt-out, duplicate, and health gates remain enforced.
- `[IMPLEMENTED]` Twilio inbound outreach replies enter through the public `twilio-inbound-router` Edge Function, which routes replies into the protected `twilio-inbound-reply` handler. Matched replies link to outreach queue rows using tolerant 10/11-digit phone matching; unmatched replies are still stored with `queue_row_id=null`.
- `[RISK]` Twilio Messaging Service inbound handling must be set to `Send a webhook`, not `Receive the message`, or REL8TION will not see inbound replies. Delivery status callbacks must use `twilio-message-status?token=<TWILIO_STATUS_CALLBACK_TOKEN>`.
- `[IMPLEMENTED]` Buyer financing outreach only happens after explicit buyer opt-in.
- `[IMPLEMENTED]` `api/compliance/ny-disclosure.js` generates six-page disclosure previews and signed packets. Signed packets place the captured electronic signature, date, provider identity, brokerage, and applicable seller-representation selections directly onto the official New York agency and housing/anti-discrimination form pages, in addition to the REL8TION cover and courtesy pages.
- `[IMPLEMENTED]` Corrected disclosure packets use versioned storage filenames and preserve any superseded packet descriptor in `ny_discrimination_disclosure.signed_pdf_history`, so regenerating an older packet does not overwrite the original stored PDF. Official source downloads use explicit PDF request headers, retry transient failures, and fail closed on non-PDF content.
- `[VERIFIED]` Production release `8f3c25ba` was visually verified against both current official signature pages. A bounded legacy regeneration retained two distinct Storage objects, preserved the v1 descriptor in packet history, and linked the corrected v2 supersession metadata. Final legal review remains a business/compliance responsibility.
- `[RISK]` Outreach and auto-reply behavior can spend money and affect real conversations. Queue filters, quiet hours, opt-outs, provider state, and owner approval matter.

## Enrichment And Listing Freshness

- `[PARTIAL]` `estately-enrichment-worker.cjs` and `api/cron/enrich-agents.js` support agent/listing enrichment.
- `[PARTIAL]` `onekey-freshness-worker.cjs` and `api/cron/refresh-open-house-data.js` support listing freshness.
- `[IMPLEMENTED]` `agent-listing-inventory-worker.cjs` also supports the reverse enrichment direction: begin with known relationship/prior-outreach agents, resolve or reuse their verified OneKey member identity, fetch their active Sale/Rent inventory, extract upcoming open houses, cross-reference canonical events, attach known agent data to matches, and prepare unmatched events for insertion when promotion is enabled. The persistent cursor bounds each cron while eventually covering the full historical-outreach population.
- `[NEEDS VERIFICATION]` Browserless/Trulia enrichment source was not found in tracked source during the repo audit; current tracked enrichment is Estately/Cheerio.
- `[NEEDS VERIFICATION]` Live cron execution, schema/RLS, and data quality need verification before relying on automatic enrichment.

## Deployment And Verification

- `[IMPLEMENTED]` Root `vercel.json` contains current rewrites and cron definitions.
- `[IMPLEMENTED]` `npm run verify:routes` checks route-map hygiene before deploy.
- `[NEEDS VERIFICATION]` `npm run verify:production-routes` and Vercel inspection should be run after deploy before calling routes live.
- `[NEEDS VERIFICATION]` Live Supabase migrations, RLS policies, Storage buckets, Edge Function deployments, RPC definitions, and env vars need explicit verification.
- `[NEEDS VERIFICATION]` Known RPCs used by app code but not proven from checked-in SQL include `find_nearest_open_house`, `verified_profiles_lookup`, and `verified_profiles_activate_or_create`. The live definitions and service-role execution contracts for `queue_recent_outreach_candidates()` and `queue_outreach_candidate(text)` were verified read-only on 2026-08-06.
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

Automatic agent outreach is restricted to future open houses. COMMAND presents master sender status, delivery route, and operator handling as separate states. `Twilio toll-free` is the primary route and `Android SMS Gateway fallback` is a provider fallback; neither route determines operator presence. At-desk/manual handling holds every brokerage, while Away/automatic handling allows future eligible rows from every brokerage to use the displayed route. No brokerage receives a provider or automatic-send exception. Provider health, opt-out, duplicate-phone, hourly, daily, and per-run gates are enforced independently.
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
Agent event dashboards never invent loan-officer coverage. The LO card is populated only by the event's active `event_loan_officer_sessions` row; without one, the agent sees an unassigned state and can open the authenticated REL8TION COMMAND assignment controls. Agent dashboards never create loan-officer coverage from a keychain scan or browser-local pending state. A required repository check rejects that retired flow if it is reintroduced.
Confirmed LO assignments create a linked `field_coverage_availability.status=unavailable` window for the scheduled visit. The availability matcher already excludes profiles with overlapping unavailable windows; reassignment replaces only the system-generated block and does not rewrite manual availability.
## Loan-Officer Device Unlock

The authenticated loan-officer account page can enroll a WebAuthn platform credential on the current phone. Returning access uses the phone's Face ID, fingerprint, or device screen lock before opening the field dashboard. The Supabase password/session remains the account security and recovery layer; the locally stored credential identifier is only the device convenience gate. A four-digit local PIN remains available as a compatibility fallback.
## Event Pass Versus Agent Keychain Access

An active Event Pass NFC opens only its currently hosted live-event dashboard. When idle, the same claimed paid-agent NFC may open `/agent-home` as that agent's reusable Rel8tionChip. Both paths require the short-lived server-issued NFC session and current key ownership; copied URLs and browser-local host declarations are not authorization. Event Pass NFC does not enroll the SMS-backed normal-keychain phone session, and reuse/private history still requires the paid agent entitlement described above.
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
