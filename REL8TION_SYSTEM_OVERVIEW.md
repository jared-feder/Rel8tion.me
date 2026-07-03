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

### Buyer Check-In And Dashboards

- `[IMPLEMENTED]` `/event` is the buyer check-in page.
- `[IMPLEMENTED]` `/event-chat` is the buyer return chat page for dashboard-triggered SMS links.
- `[IMPLEMENTED]` `/agent-dashboard` is the host-agent live event dashboard.
- `[PARTIAL]` REL8TION COMMAND at `/admin` is the operational admin dashboard.
- `[PARTIAL]` `/admin/agent-ranking` is the Agent Ranking / Production Intelligence module. It accepts ListReports-style CSV exports, normalizes agent/contact/listing/buyside/location activity fields, infers county/source/confidence, scores opportunity fit, supports server-side sorting/filtering/pagination, provides a clickable agent profile modal with matched current listing/open-house records, the best available listing-agent photo, a large Rel8tion grade, a plain-English county/market peer comparison that explains the buyer-capture opportunity, and preserved duplicate-row context, and can stage reviewed prospects into outreach manually. The dashboard view is gated to trusted ListReports mappings with identity and phone present, hides old bad-mapping rows without deleting them, collapses same-agent duplicate stored rows for display when normalized agent name + brokerage + phone match, and does not present production volume, average price, or transaction count as ListReports-imported data. Ranking upsert identity is intended to be `identity_key`, combining normalized agent name, brokerage, phone, and county/market so phone alone never collapses shared-office-phone agents. Blank numeric filters are treated as no limit, not zero, market filter values are canonicalized so typos or encoded geometry values do not split campaign-ready counts, and admin ranking reads page through Supabase instead of relying on a single capped REST response. Duplicate display rollups preserve raw/imported rows in Supabase while keeping dashboard campaign counts from double-counting the same agent. Large confirm imports defer deep `open_houses`/`listing_agents` matching to profile drill-down or explicit refresh so upload requests stay within function time limits. XLS/XLSX import and manual low-confidence match review are not complete.

### Open House Kit And Website Builder

- `[PARTIAL]` `/get-open-house-kit`, `/kit-confirm`, and `/kit-intake` support Open House Kit acquisition, keychain prefill, intake, and Stripe Checkout handoff.
- `[PARTIAL]` `/api/checkout/website-promo` can show deterministic website-builder promo codes after paid kit checkout.
- `[PARTIAL]` The separate agent website builder at `my.rel8tion.me` uses `agent_websites` and `agent_website_listings`.
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
- `[PARTIAL]` `agent_production_uploads`, `agent_production_import_rows`, and `agent_rankings` support Agent Ranking / Production Intelligence. The linked Supabase schema was applied and catalog/advisor verified for these new objects on 2026-06-28, including ListReports activity columns. On 2026-06-30, location/source/confidence fields and matched open-house counts/ids/timestamps were applied to linked Supabase and column verification passed. A later 2026-06-30 migration added `agent_rankings.identity_key` and replaced the old phone-first unique index; column/index verification and backfill sampling passed. Legacy null-identity/bad-mapping rows can still exist in storage, but the trusted dashboard view filters them out. Authenticated upload-flow behavior still needs verification.
- `[PARTIAL]` `agent_websites` and `agent_website_listings` support the website-builder app.

## Messaging, Outreach, And Compliance

- `[PARTIAL]` `send-lead-sms` source is checked in under `supabase/functions/send-lead-sms` and uses the shared SMS provider layer.
- `[NEEDS VERIFICATION]` Deployed function source/version, provider env, and live SMS behavior still need verification.
- `[IMPLEMENTED]` `/event` sends buyer/agent SMS only after local check-in validation and disclosure completion.
- `[IMPLEMENTED]` Automated outreach sends are throttled for provider safety: the Vercel send cron defaults to 7 per run, and the `send-agent-outreach` Edge Function hard-caps automatic sends with default limits of 7 per run, 20 per rolling hour, and 150 per rolling 24 hours. Automatic initial sends do not require `approved_for_send=true`; eligible rows are `send_mode=automatic`, generated, rendered, due, with a listing photo and pending initial SMS copy.
- `[IMPLEMENTED]` Automated outreach has a global runtime pause via `rel8tion_runtime_settings.key='outreach_send_paused'` or `OUTREACH_SEND_PAUSED=true`; when enabled, `send-agent-outreach` sends nothing and reports `paused=true`.
- `[IMPLEMENTED]` While outreach send pause/recovery mode is active, `generate-agent-outreach` stages newly generated outreach as `send_mode=manual`, `review_status=manual_ready` so rows flow into the cell-send queue instead of automatic sending.
- `[IMPLEMENTED]` As of 2026-06-28, outreach follow-up/drip scheduling is disabled while opt-out health is recovered. Existing live pending follow-ups were cleared to `followups_disabled`, and the current generator/sender leave future follow-up fields unscheduled unless intentionally re-enabled.
- `[IMPLEMENTED]` SMS provider selection is route-scoped: `SMS_OUTREACH_PROVIDER` controls outreach/manual outreach, `SMS_EVENTS_PROVIDER` controls buyer/event/owner operational traffic, and both fall back to `SMS_PROVIDER`.
- `[IMPLEMENTED]` Production outreach is split by brokerage and operator mode: Douglas Elliman outreach routes through Twilio/MMS; non-Douglas Elliman outreach waits for manual send when `outreach_operator_mode=live`; non-Douglas Elliman outreach routes through Android Gateway when `outreach_operator_mode=away`. Event/owner/system traffic remains on Twilio.
- `[IMPLEMENTED]` REL8TION COMMAND shows Twilio ready, Manual ready, and Android ready rows. Live: manual / Away: Android changes `rel8tion_runtime_settings.outreach_operator_mode`, while Pause cron / Resume cron intentionally changes row `send_mode`.
- `[IMPLEMENTED]` `/manual-sms-outreach` is the protected cell-send backup. It uses `/api/manual-sms-outreach`, opens the local SMS composer, marks rows sent/skipped only after operator action, and does not exclude Douglas Elliman manual-ready rows.
- `[IMPLEMENTED]` REL8TION COMMAND outreach health treats an empty inbound window as quiet/normal instead of a broken inbox; actual warnings remain for raw/unlinked inbound rows and linked replies missing from the inbox view.
- `[PARTIAL]` Agent Ranking / Production Intelligence stages ranked agents into `agent_outreach_queue` with manual send mode and follow-ups disabled. It should not be used to send automatic SMS or to game opt-out-rate metrics.
- `[IMPLEMENTED]` Durable Twilio outreach recovery settings live in `docs/twilio-outreach-sms-runbook.md`; keep that runbook and the source-of-truth docs aligned.
- `[IMPLEMENTED]` As of 2026-06-24, Twilio SMS is restored via `SMS_PROVIDER=twilio`, `SMS_EVENTS_PROVIDER=twilio`, and `TWILIO_PHONE=+15168885461`. Outreach default should be Android Gateway with Douglas Elliman as the Twilio override until toll-free outreach is intentionally added.
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
