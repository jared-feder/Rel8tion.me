# Agent Ranking / Production Intelligence

Status: `[PARTIAL]` source exists in this repo. The linked Supabase schema was applied and catalog/advisor verified for the new objects and ListReports activity columns on 2026-06-28. Deployment and end-to-end upload testing still need verification after release.

## Purpose

Agent Ranking / Production Intelligence is an admin-only REL8TION COMMAND module for importing permitted ListReports-style agent activity reports and turning them into opportunity-ranked targets for Event Pass, Open House Kit, and Rel8tionChip conversations.

It is not a scraping tool, login automation tool, consumer lead resale workflow, or automatic SMS sender.

## Route And Files

- Admin route: `/admin/agent-ranking`
- Static page: `apps/rel8tion-app/agent-ranking.html`
- Admin API: `api/admin/agent-ranking.js`
- Shared parser/scoring utilities: `lib/agent-ranking.js`
- Schema migration: `supabase/migrations/20260628125530_agent_ranking_production_intelligence.sql`

The page uses the same admin UID/token headers as REL8TION COMMAND.

## Upload Flow

1. Open `/admin/agent-ranking`.
2. Upload a CSV production report.
3. Set source name, market area, optional period dates, and notes.
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
- Market, city, county, state

Phones are normalized to 10 digits for matching. Email is lowercased. Existing REL8TION agents are matched by phone, email, then conservative name/brokerage similarity.

## Tables

- `agent_production_uploads`: upload metadata, source, period, notes, parse summary
- `agent_production_import_rows`: normalized rows from each upload, match confidence, raw row snapshot
- `agent_rankings`: current opportunity ranking for each agent/contact identity

All three tables have RLS enabled and service-role-only policies in the migration.

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
- Deployed route and end-to-end upload behavior must be verified after release.
