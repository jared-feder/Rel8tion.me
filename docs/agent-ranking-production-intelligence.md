# Agent Ranking / Production Intelligence

Status: `[PARTIAL]` source exists in this repo. The linked Supabase schema was applied and catalog/advisor verified for the base objects and ListReports activity columns on 2026-06-28. The 2026-06-30 county/location, open-house match, and `identity_key` migrations were applied and verified on linked Supabase. Authenticated end-to-end upload testing still needs verification.

## Purpose

Agent Ranking / Production Intelligence is an admin-only REL8TION COMMAND module for importing permitted ListReports-style agent activity reports and turning them into opportunity-ranked targets for Event Pass, Open House Kit, and Rel8tionChip conversations.

It is not a scraping tool, login automation tool, consumer lead resale workflow, or automatic SMS sender.

## Route And Files

- Admin route: `/admin/agent-ranking`
- Static page: `apps/rel8tion-app/agent-ranking.html`
- Admin API: `api/admin/agent-ranking.js`
- Shared parser/scoring utilities: `lib/agent-ranking.js`
- Location inference utility: `lib/location-intelligence.js`
- Open-house matcher: `lib/agent-ranking-open-house.js`
- Base schema migration: `supabase/migrations/20260628125530_agent_ranking_production_intelligence.sql`
- Location/open-house migration: `supabase/migrations/20260630065516_agent_ranking_location_open_house_matching.sql`
- Identity-key migration: `supabase/migrations/20260630075547_agent_ranking_identity_key.sql`

The page uses the same admin UID/token headers as REL8TION COMMAND.

## Upload Flow

1. Open `/admin/agent-ranking`.
2. Upload a CSV production report.
3. Set source name, market area, optional period dates, location defaults, and notes.
4. Preview the import.
5. Review detected column mapping, duplicate count, match counts, and the first 20 normalized rows.
6. Confirm import.

CSV parsing is implemented server-side. XLS/XLSX files are intentionally rejected until a package-backed spreadsheet parser is added and tested.

## Supported Flexible Columns

The parser accepts common variants for:

- Agent name, first name, last name
- Brokerage/company/office
- Phone, mobile, email
- Production volume, transactions/sides/units
- Active listings, sold listings
- ListReports columns: `agent_name`, `agent_company`, `agent_phone`, `listings_active_total`, `listings_days_since_last`, `listings_active_last_12_months`, `buyside_last_90_days`, `buyside_last_12_months`
- Average price
- Location columns: `county`, `agent_county`, `market_county`, `primary_county`, `area`, `market`, `market_area`, `city`, `town`, `municipality`, `zip`, `zipcode`, `postal_code`, `state`, `region`, `territory`, `board_area`, `mls_area`

Phones are normalized to 10 digits for matching. Email is lowercased. Existing REL8TION agents are matched by phone, email, then conservative name/brokerage similarity.

## Ranking Identity

Rankings use `agent_rankings.identity_key`, not phone alone, as the database upsert identity.

Identity format:

`import:{normalized_agent_name}|{normalized_brokerage}|{normalized_phone}|{normalized_county_or_market}`

Rows missing agent name or phone are skipped during final import and counted in the final import summary. Multiple agents sharing the same office/brokerage phone remain separate when their names, brokerages, or county/market values differ. Upload batches are deduped by `identity_key` before ranking upsert, and the admin API uses Supabase/PostgREST upsert with `on_conflict=identity_key`.

Final import summaries include uploaded rows, valid rows, skipped missing phone/name, duplicates skipped, new rankings inserted, existing rankings updated, and failed rows.

## Location Intelligence

Each imported row stores `county`, `primary_county`, `market_area`, `city`, `state`, `zip`, `inferred_county`, `location_confidence`, and `location_source`.

Source priority and confidence:

- `manual_admin`: 100
- `imported_county`: 100
- `zip_city_inferred`: 85 for ZIP inference, 75 for city/market/address inference
- `open_house_match`: 80
- `upload_default`: 70
- `missing`: 0

The admin upload modal supports default county, market area, state, apply-defaults, county inference, and location notes. The ranking table and profile modal show source/confidence badges. The Fix Location action updates the ranking row only, marks `location_source=manual_admin`, and sets confidence to 100.

County inference is local-rule based for NY markets; it does not call a paid geocoder.

## Tables

- `agent_production_uploads`: upload metadata, source, period, notes, parse summary
- `agent_production_import_rows`: normalized rows from each upload, match confidence, location fields, raw row snapshot
- `agent_rankings`: current opportunity ranking for each `identity_key`, location fields, matched open-house counts, matched open-house ids, and last matched open-house timestamp

All three tables have RLS enabled and service-role-only policies in the migration.

## Open-House Matching

Imports are matched to current REL8TION `open_houses` and `listing_agents` data by phone, email, name plus brokerage, and name plus county/market/city. The API action `refresh_matches` recomputes matches for all rankings or an optional `upload_id`, `agent_id`, or `ranking_id`.

## Ranking Logic

Ranking emphasizes opportunity, not just raw production.

Signals include:

- Production volume
- Transaction count
- Active and sold listing counts
- ListReports active-listing total
- Days since last listing activity
- Listing-side activity in the last 12 months
- Buyside activity in the last 90 days and 12 months
- Average price
- Known open-house activity from outreach data
- Matched current open houses
- Matched weekend open houses
- Matched active listing count
- Location confidence
- Contactability by phone/email
- Above-average production compared with the imported batch

The module assigns recommended tiers: `A+`, `A`, `B`, `C`, `Unknown`, and admin-reviewed `Not a Fit`.

## Outreach Safety

The `Add to Outreach Queue` action creates or updates an `agent_outreach_queue` row with:

- `source = agent_ranking`
- `send_mode = manual`
- `initial_send_status = not_queued`
- `followup_send_status = not_scheduled`
- `followup_block_reason = followups_disabled`

This stages a reviewed opportunity. It does not automatically send SMS, bypass consent, or lower opt-out-rate metrics.

## Current Limitations

- CSV only; XLS/XLSX support is not finalized.
- Manual low-confidence row matching is not yet a full backend workflow.
- Authenticated end-to-end upload behavior must be verified after release.
