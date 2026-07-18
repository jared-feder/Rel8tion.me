# CURRENT_STATE.md

Daily operational source of truth for REL8TION.

Last cleaned: 2026-06-04.

## 2026-07-16: New York agent-website compliance controls

- `[IMPLEMENTED]` `agent_websites` now stores the exact NY license type, brokerage address/phone, brokerage website, and employing broker Standardized Operating Procedures URL.
- `[IMPLEMENTED]` Generated agent sites display the NY Housing and Anti-Discrimination Disclosure link, brokerage/license identity, brokerage contact information, optional broker site/SOP links, and listing-broker attribution.
- `[IMPLEMENTED]` The website builder collects these fields and saves new incomplete NY sites as drafts. REL8TION COMMAND can edit the same compliance fields.
- `[NEEDS VERIFICATION]` Each employing broker must supply its own current, dated SOP URL. REL8TION must not invent broker policies. Fidel Lloyd's license type and Home Affordable Realty Corp office address/phone are populated, but the brokerage SOP URL remains outstanding.

## 2026-07-17: Outreach future-event and brokerage enforcement

- `[IMPLEMENTED]` `send-agent-outreach` now selects only queue rows whose `open_start` is still in the future.
- `[IMPLEMENTED]` Brokerage-specific Twilio restrictions were retired by owner direction on 2026-07-17. When the operator is away, future eligible rows from any brokerage may use the configured automatic outreach provider.
- `[IMPLEMENTED]` Existing opt-out health gates and hard caps remain unchanged; this correction does not override sender-health suppression.
- `[IMPLEMENTED]` Initial outreach now asks agents to reply `Y` to book support or `N` for another time while retaining the required `STOP to unsubscribe` instruction.
- `[IMPLEMENTED]` Twilio inbound outreach replies recognize exact `Y`/`YES` and `N`/`NO` responses. Y marks the thread interested and confirms a follow-up call; N marks it `not_now` and sends the NMB Hard Loans contact positioning. Both automatic responses preserve STOP language and are mirrored into the outreach thread.
- `[IMPLEMENTED]` As of 2026-07-18, production `send-agent-outreach` caps are 5/run, 20/hour, and 100/day. The rolling opt-out health gate remains enabled (7-day window, 20-send minimum, 1% maximum rate); future-event eligibility and old/manual/past-event backlog exclusions remain in force.

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
- `[RISK]` Root wrapper files and app files are not identical.

## Active Route State

- `[IMPLEMENTED]` `/k` routes NFC scans for keychains, front sign chips, rear sign chips, reset scans, pending sign activation, Event Pass flows, Loan Officer Coverage Sign flows, loan officer tags, backup keychains, and normal claimed agent keychains.
- `[IMPLEMENTED]` `/claim` claims a Rel8tionChip/keychain into an agent identity. Event Pass profile completion must not show or process the public-profile keychain QR field.
- `[IMPLEMENTED]` `/onboarding` is the post-claim agent setup page and includes smart sign activation entry points plus backup-keychain setup.
- `[PARTIAL]` `/agent-home` is the permanent owner dashboard for claimed agent NFC scans. Public/share QR profile behavior stays on `/b?agent=<slug>`.
- `[IMPLEMENTED]` `/sign-demo-activate` is the smart sign setup and listing binding flow.
- `[IMPLEMENTED]` `/s` and `/sign` resolve smart sign public codes and route to activation or live event state.
- `[IMPLEMENTED]` `/pass` resolves printed Event Pass QR inventory from `smart_sign_inventory.public_code`.
- `[IMPLEMENTED]` `/sponsored-pass-activate` activates reusable Sponsored Event Passes and records per-event agent consent before sponsor visibility.
- `[IMPLEMENTED]` `/lo-sign`, `/lo-sign-setup`, and `/lo-sign-activate` support Loan Officer Coverage Sign setup, activation, and live routing.
- `[IMPLEMENTED]` `/event` is the buyer smart sign check-in page with guided disclosures, optional financing-help routing, and SMS after local validation.
- `[IMPLEMENTED]` `/event-chat` is the buyer return chat page for dashboard-triggered SMS links.
- `[IMPLEMENTED]` `/agent-dashboard` is the live event dashboard for the host agent.
- `[PARTIAL]` `/loan-officer-dashboard` is the clean LO operations alias; `/lo-field-dashboard` remains a backward-compatible alias.
- `[PARTIAL]` `/nmb-activate` and `/nmb-verified` are loan officer tag/profile pages. Formal remote LO coverage management is not built.
- `[IMPLEMENTED]` `/c/:code` and `/chip/:code` resolve printed Rel8tionChip QR inventory.
- `[IMPLEMENTED]` `/a` redirects legacy/public profile traffic to `/b`.
- `[IMPLEMENTED]` `/b` is the public agent profile and lead capture path.
- `[PARTIAL]` `/get-open-house-kit`, `/kit-confirm`, and `/kit-intake` support the Open House Kit landing, NFC/keychain prefill, manual intake, and Stripe Checkout handoff. Event Pass checkout arming canonicalizes to the programmed NFC origin (`irel8.me`) before setting browser state. Through September 22, 2026 at 11:59 PM Eastern, new checkout sessions use the Summer 2026 promotion: the monthly path charges $199 today for the reusable kit and starts $29/month after 31 days for SMS follow-up and dashboard access; the Summer annual bundle charges $499 today for the kit, one year of service, and the Website Builder, then renews at $300/year. After the cutoff, checkout automatically returns to the configured standard prices.
- `[PARTIAL]` `/loan-officer-support` is the public loan-officer registration application and stores submissions for review in REL8TION COMMAND. Admins can approve a new application into an active verified profile; approval sends the applicant an activation SMS and attempts an idempotent Resend email. Missing email configuration is non-fatal and displayed in the admin result. Authenticated account ownership remains to be built.
- `[PARTIAL]` `/key-reset` is a token-protected admin/beta reset utility, not a full admin dashboard.
- `[PARTIAL]` `/admin` is REL8TION COMMAND. It supports important operational workflows, including a Buyer Finder area that calls `/api/admin/buyer-home-finder` with admin credentials to filter, sort, search, and generate printable buyer reports from upcoming `open_houses`, `agent_outreach_queue`, and matched `listing_agents` records. Broader CRM edits, sign inventory edits, LO calendar/availability edits, billing automation, and full project controls are not complete.
- `[IMPLEMENTED]` Confirmed outreach open houses stored as scheduled `field_demo_visits` can be assigned or reassigned to an active loan officer directly from REL8TION COMMAND's Accepted Open Houses table, even before an active `open_house_events` row exists.
- `[IMPLEMENTED]` The Confirm Open House date picker includes an optional LO dropdown, and the confirmed Reports card keeps an Assign LO/Change LO control so coverage can be added or corrected later.
- `[IMPLEMENTED]` Source for the private Rel8tionOS server API is under `/api/rel8tionos/*`. It provides authenticated health, linked outreach threads/message history, manual reply, Open House acceptance, active loan-officer listing, and live loan-officer assignment endpoints. It reuses REL8TION's existing send and assignment workflows so opt-out, suppression, provider routing, and quiet-hour enforcement remain centralized. See `docs/rel8tionos-api.md`.
- `[NEEDS VERIFICATION]` Rel8tionOS is not connected until the correct Rel8tionOS Vercel project is identified, the same sensitive server credential is installed on both applications, both applications are redeployed, and authenticated production reads are verified.
- `[PARTIAL]` `/admin/agent-ranking` is an admin-only Agent Ranking / Production Intelligence module for permitted ListReports-style CSV imports, opportunity scoring, county/location tagging, open-house matching, server-side sorting/filtering/pagination, clickable agent profile drill-down, printable/copyable agent-facing marketing reports, and manual outreach staging. It supports ListReports fields including `agent_name`, `agent_company`, `agent_phone`, `listings_active_total`, `listings_days_since_last`, `listings_active_last_12_months`, `buyside_last_90_days`, and `buyside_last_12_months`, plus location columns such as county, market, city, state, and ZIP. The dashboard view now gates displayed rows to trusted ListReports mappings with `identity_key` and phone present, hides legacy/bad-mapping ranking rows without deleting them, collapses same-agent duplicate stored rows for display when normalized agent name + brokerage + phone match, and labels unavailable production-volume/average-price/transaction fields as not provided by ListReports. Ranking uniqueness is intended to use `identity_key = import:{normalized_agent_name}|{normalized_brokerage}|{normalized_phone}|{normalized_county_or_market}` so shared office phones do not collapse different agents. On 2026-07-03, blank server-side numeric filter values were fixed to mean "no limit" instead of `0`, market filters were canonicalized so `Lng Island`/encoded geometry values cannot split campaign buckets, stale browser filter responses are ignored, admin ranking reads now page through Supabase in 1,000-row chunks instead of trusting a single capped REST response, duplicate stored rows are rolled up for campaign counts without deleting raw/imported records, and filter edits now stay in a local draft until the admin clicks Apply/Search so typing in search fields does not query the database per keystroke. Area comparison now returns peer rank context, including opportunity-score rank and metric ranks, so the Marketing Report modal can show where an agent ranks in their county/market and can be copied or printed/saved as PDF for outreach or in-person marketing. Pitch copy now uses safe county/market labels and actual profile metrics such as active listings, listing-side 12m, buyside 90d/12m, days since last listing, and matched open-house counts; encoded geometry strings are blocked from pitch text. The profile modal now loads matched `open_houses`/`listing_agents` records, the best available listing-agent photo, a large Rel8tion grade, image-backed prestige/status badges for Rising Star, Shooting Star, All-Star, and Rock Star based on active-listing/listing-side/buyer-side peer multiples, a plain-English county/market opportunity story, and any preserved duplicate-row context. The profile modal is a full-width single-column profile view, while recommended pitch copy and generated pitch variants live only in the separate Pitch Studio modal. Confirm import uses the fast ListReports scoring/upsert path and defers deep open-house matching to profile drill-down or explicit refresh so large uploads do not time out. XLS/XLSX parsing, manual low-confidence match review, and authenticated end-to-end upload testing remain `[NEEDS VERIFICATION]`.

## NFC, Sign, Event Pass, And QR State

- `[IMPLEMENTED]` Front smart sign NFC is the buyer/check-in side and is stored as `uid_primary` with `primary_device_type = front_buyer_chip`.
- `[IMPLEMENTED]` Rear smart sign NFC is the agent/dashboard challenge side and is stored as `uid_secondary` with `secondary_device_type = rear_agent_chip`.
- `[IMPLEMENTED]` Rear sign scan requires an agent keychain challenge before dashboard access.
- `[IMPLEMENTED]` Agent sign activation requires the keychain handshake.
- `[IMPLEMENTED]` A live smart sign is designed to attach to one active `open_house_events` row at a time.
- `[IMPLEMENTED]` Smart Sign and Event Pass may both be active for the same listing/open-house context because routing is device/sign-aware rather than listing-blocked.
- `[IMPLEMENTED]` Sponsored Event Pass activation GPS search includes the `20260531-eventpass-gps-search` focused near-me/today fallback.
- `[IMPLEMENTED]` Event Pass is gated as one included event unless renewed/reset by LO/admin. Reuse is blocked when prior event history exists and the pass is not live for that same event.
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
- `[IMPLEMENTED]` Summer 2026 promotional Checkout uses separate live Stripe Prices and records promotion, rate-lock, future-platform-upgrade, and annual Website Builder entitlement metadata on both the Checkout Session and subscription. The locked price and included REL8TION software-platform upgrades apply while the promotional subscription remains active; replacement hardware and third-party services are excluded.
- `[IMPLEMENTED]` `/api/checkout/stripe-webhook` verifies signed Stripe Checkout webhooks and upserts eligible Open House Kit Checkout Sessions into `open_house_kit_orders` for fulfillment review.
- `[IMPLEMENTED]` Successful Open House Kit Stripe returns request `/api/checkout/website-promo` with a Checkout Session id to show a deterministic website-builder promo code for `https://my.rel8tion.me`, verify the paid Stripe session, upsert `open_house_kit_orders`, create a secure `/kit-dashboard` access token, and redirect the buyer into the Open House Kit dashboard as a browser-return fallback before the webhook is configured.
- `[IMPLEMENTED]` `/kit-dashboard` is the post-payment Open House Kit workspace. It loads through `/api/kit/dashboard`, lets the buyer choose from seeded company logos or upload a custom logo into the `open-house-kit-logos` Supabase Storage bucket, records logo status on `open_house_kit_orders`, and supports password setup plus browser/device-lock registration state. Summer annual orders expose their included Website Builder entitlement and onboarding link from persisted Stripe metadata.
- `[IMPLEMENTED]` Post-payment welcome email/SMS orchestration exists in `lib/open-house-kit.js` and is called from both the Stripe webhook and paid browser-return path. Sends are logged in `open_house_kit_notifications`; dashboard links use hashed rows in `open_house_kit_access_tokens`. SMS uses the existing `send-lead-sms` Edge Function and route-scoped SMS provider secrets.
- `[NEEDS VERIFICATION]` Live Stripe webhook endpoint configuration, `STRIPE_WEBHOOK_SECRET` or `STRIPE_OPEN_HOUSE_KIT_WEBHOOK_SECRET`, `RESEND_API_KEY`/verified from-address, product pricing, and real provider delivery need verification before treating checkout messaging as fully automated.

## Agent Website Builder

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
- `[IMPLEMENTED]` Root cron code includes outreach generation and send endpoints. During opt-out recovery, the Vercel cron and `send-agent-outreach` Edge Function hard-cap automatic sends at 5 per run, 10 per rolling hour, and 25 per rolling 24 hours, even if older secrets contain higher values. Automatic initial sends do not require `approved_for_send=true`; eligible rows are `send_mode=automatic`, generated, rendered, due, with a listing photo and pending initial SMS copy.
- `[IMPLEMENTED]` `send-agent-outreach` supports a global runtime pause through `rel8tion_runtime_settings.key='outreach_send_paused'` or `OUTREACH_SEND_PAUSED=true`. When enabled, live runs return `paused=true` and send no outreach messages, even if cron fires and rows are due; authenticated dry runs can still inspect candidate routing and copy.
- `[IMPLEMENTED]` `generate-agent-outreach` reads the same outreach send pause and stages newly generated outreach as `send_mode=manual`, `review_status=manual_ready` while pause/recovery mode is active, so new rows land in the cell-send queue instead of automatic.
- `[IMPLEMENTED]` As of 2026-06-28, outreach follow-up/drip scheduling is disabled while opt-out health is recovered. Pending live follow-ups were marked `followup_send_status=not_scheduled`, `followup_send_at=null`, `followup_sms=null`, `followup_sms_link=null`, and `followup_block_reason=followups_disabled`; the generator and sender keep future follow-ups unscheduled until this is intentionally re-enabled.
- `[IMPLEMENTED]` REL8TION COMMAND surfaces generated/rendered due outreach rows as Twilio ready, Manual ready, or Auto ready and can explicitly Pause cron/Resume cron by changing `send_mode`. Do not reintroduce a hidden approval gate for normal cron sends without owner confirmation.
- `[IMPLEMENTED]` `/manual-sms-outreach` is a protected static phone-send backup backed by `/api/manual-sms-outreach`. It opens the local SMS composer only, never sends through Twilio/Android itself, and manual-ready rows can include any brokerage, including Douglas Elliman.
- `[IMPLEMENTED]` `send-agent-manual-reply` supports a service-role/admin `provider_override` for owner-approved manual outreach, including Twilio one-off campaigns, while preserving `manual_outreach` STOP text, suppression checks, delivery logging, and reply threading.
- `[IMPLEMENTED]` Rel8tionOS outbound replies require a stable idempotency key and pass through `send-agent-manual-reply`; the integration API does not bypass the global suppression list or outreach quiet-hour policy.
- `[IMPLEMENTED]` REL8TION COMMAND outreach health treats an empty inbound window as quiet/normal instead of a broken inbox; it still warns on unlinked raw rows and fails only when linked replies are missing from the inbox view.
- `[PARTIAL]` Agent Ranking / Production Intelligence can stage ranked agents into `agent_outreach_queue` with `source=agent_ranking`, `send_mode=manual`, `initial_send_status=not_queued`, and follow-ups disabled. This is a review queue action, not an automatic sender.
- `[IMPLEMENTED]` `docs/twilio-outreach-sms-runbook.md` is the durable Twilio outreach recovery/runbook document. Keep it in source control and update it whenever provider settings change.
- `[IMPLEMENTED]` On 2026-06-23, Twilio SMS was restored with `SMS_PROVIDER=twilio` and `TWILIO_PHONE=+15168885461` in live Supabase secrets. Outbound smoke test queued from `+15168885461`, inbound reply to that number saved into `agent_outreach_replies`, owner alert queued, and the matched outreach queue row moved to `review_status=replied`.
- `[IMPLEMENTED]` The shared SMS layer supports a dedicated Twilio outreach sender through `TWILIO_OUTREACH_MESSAGING_SERVICE_SID` or `TWILIO_OUTREACH_FROM_NUMBER`, with `TWILIO_EVENTS_FROM_NUMBER` for the regular operational number. When `SMS_OUTREACH_PROVIDER=twilio`, it requires the dedicated outreach sender and will not silently fall back to the regular event number.
- `[IMPLEMENTED]` SMS suppression is global across Android and Twilio and fails closed when suppression status cannot be verified. Twilio and Android inbound handlers recognize STOP-family keywords, exact START/UNSTOP removes application suppression, and a STOP updates matching outreach rows across the phone number.
- `[IMPLEMENTED]` Outreach safety recovery adds a default 30-day same-phone cooldown, a rolling 7-day opt-out health gate (minimum 20 sends, default 1% maximum), a 7-day maximum age for missed-open-house outreach, and shorter permission-oriented initial copy. Initial MMS remains disabled by code default, but production `OUTREACH_INITIAL_MMS_ENABLED=true` was explicitly owner-approved on 2026-07-14 after the toll-free MMS route was verified. Each staged initial MMS attaches the generated outreach image first and the NMB business card second. Android remains text-SMS-only.
- `[IMPLEMENTED]` On 2026-07-14, Twilio Console showed toll-free registration complete for `+18448211802`; an owner-only MMS was delivered with SID `MM395033030537bb1de5b4b0b6489d7cdd`. Messaging Service `MG8d7ec49cf1d6d231080b7f870a10eb0b` was changed from the old ElevenLabs sender webhook to `Send a webhook` with the Rel8tion `twilio-inbound-router` URL for both primary and fallback POST handling.
- `[IMPLEMENTED]` The post-cutover inbound test was stored in `agent_outreach_replies` with SID `SM5bd0275785326ce95cfd9c4970070647`, linked to queue row `b674dd8f-99f1-40f7-9ec2-403634b3571c`, and produced an event-route owner alert with SID `SMc284b6659cb7b25c8c61e724b31231d8`. Runtime `outreach_send_paused` is now false with reason `toll_free_outreach_verified`; recovery caps are 5/run, 10/hour, and 25/day, with the rolling health gate still able to pause automatically.
- `[IMPLEMENTED]` Twilio inbound outreach numbers should use the public `twilio-inbound-router` Edge Function as the incoming-message webhook. The router is deployed without JWT verification for Twilio, then forwards inbound replies into the protected `twilio-inbound-reply` handler with service-role auth. Matched replies link to outreach queue rows using tolerant 10/11-digit phone matching; unmatched replies are still stored with `queue_row_id=null` instead of being dropped.
- `[RISK]` In Twilio Messaging Service inbound settings, choose `Send a webhook`; `Receive the message` does not call REL8TION and makes replies disappear from Supabase even though Twilio stores them.
- `[RISK]` Delivery status callback URLs must use `twilio-message-status?token=<TWILIO_STATUS_CALLBACK_TOKEN>` with `POST`; do not use the inbound router for delivery status, and do not commit the token value.
- `[RISK]` Outreach sends real messages and can spend money. Verify filters, quiet hours, opt-outs, provider state, and owner approval before changing send behavior.
- `[RISK]` Android SMS Gateway/Tracfone outreach can be carrier-flagged if messages are sent in bursts. Do not raise outreach send caps without explicit owner approval and a provider health check.
- `[RISK]` Twilio/A2P campaign state has previously been reported as suspended. Treat Twilio delivery as unreliable until provider status is verified.

## Supabase, Schema, And RLS

- `[IMPLEMENTED]` Browser code uses the public anon key in app config and standalone pages.
- `[IMPLEMENTED]` Service-role serverless routes exist for Sponsored Event Pass, Loan Officer Coverage Sign, admin reset, admin actions, checkout, and selected privileged flows.
- `[NEEDS VERIFICATION]` Live RLS policy state is not fully confirmed.
- `[NEEDS VERIFICATION]` Live schema and repo migrations must be checked before frontend assumptions are changed.
- `[NEEDS VERIFICATION]` RPC definitions used by app code but not proven from checked-in SQL include `find_nearest_open_house`, `queue_recent_outreach_candidates`, `verified_profiles_lookup`, and `verified_profiles_activate_or_create`.
- `[PARTIAL]` Agent Ranking / Production Intelligence migration source exists for `agent_production_uploads`, `agent_production_import_rows`, and `agent_rankings`. On 2026-06-28, the linked Supabase schema was applied with RLS enabled, service-role-only policies, ListReports activity columns, catalog verification, and filtered advisor verification for the new objects. On 2026-06-30, the location/source/confidence and matched open-house counts/ids/timestamps migration was applied to linked Supabase and column verification passed. A later 2026-06-30 migration replaced the old phone-first unique expression index with unique `agent_rankings.identity_key`; column/index verification and backfill sampling passed. As of the ranking display cleanup, legacy rows with missing identity or bad early production-field mappings remain stored but are hidden from the trusted dashboard view.
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
