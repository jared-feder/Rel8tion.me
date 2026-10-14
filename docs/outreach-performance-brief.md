# Outreach Performance Brief

The owner's August 17, 2026 six-section PDF is the product reference. The earlier August 5 version lacked the expanded Week in Review. Links to both originals remain in COMMAND Reports. Their original generation source was not recovered; the application now has a versioned generator and private immutable archive in this repository.

## Report and delivery

- COMMAND: `https://app.rel8tion.me/command?area=reports`.
- Private JSON/PDF archive: `/api/admin/outreach-performance-reports`, existing admin-header authorization required. `GET ?week=YYYY-MM-DD&format=pdf` downloads the newest edition; add `version=1` for the original. Edition 2 has eight core sections and paginates long tables. Credentials never appear in URLs.
- `POST {action: "generate", week: "YYYY-MM-DD"}` creates only a snapshot. `action: "email"` submits its PDF to configured report recipients. It never sends agent outreach or closes events.
- `/api/cron/outreach-performance-report`: Monday 09:10 New York, protected with the existing cron bearer secret. UTC 13:10 and 14:10 schedules are filtered by the New York hour guard.
- `PRODUCTION_REPORT_EMAILS` (or the existing singular/owner fallback) chooses recipients. Existing SMTP or Resend configuration is reused. Accepted email submissions and uncertain outcomes are not automatically resent; acceptance is not proof of inbox delivery.
- A missing completed report becomes visible after Monday 09:15. Failure is separate from generation; a saved report remains available even if email fails. Repair the cause and use Generate/Email in COMMAND. For `unknown` email status, inspect the provider before any manual database intervention.

## Metric contract, version 1

All activity weeks are completed Monday-Sunday periods in America/New_York. Lifetime measures and cohort outcomes use evidence available at generation. A backfilled week is a reconstruction, not an assertion of what was known at that time. Saved snapshots cannot be overwritten.

| Measure | Source and rule |
| --- | --- |
| Initial outbound | Queue `initial_sent_at`, otherwise `manual_sms_sent_at`, otherwise legacy `sent_at`; deduplicate provider ID, falling back to queue ID. |
| Follow-up outbound | Queue `followup_sent_at`; deduplicate its provider ID or queue ID. |
| Conversation outbound | Outbound reply records, excluding provider IDs already present in initial/follow-up queue fields; deduplicate provider ID or reply ID. |
| Distinct agents | Normalized phone, otherwise email, with compatible first/last-name anchors. Conflicting names at an office contact remain separate. Missing/ambiguous identities use separate source rows. |
| Replies | Inbound records linked to the queue row first; unlinked records can match an unambiguous contact identity. Received time must be after the initial send. STOP replies are still historical replies. |
| Reply rate | Distinct replying agents / distinct contacted agents in the initial-send cohort. No contacts yields N/A. |
| Ever confirmed | Queue confirmed/accepted status or linked non-test field visit; deduplicate house plus New York event date. Preserve the hashed outcome ledger across saved snapshots, even after cancellation, opt-out or later missing records. |
| Confirmation conversion | Confirmed houses assigned to the initial-send cohort / initial messages. No initial messages yields N/A. This is not a sales conversion or causal attribution claim. |
| Active relationships | Mutually exclusive priority: opt-out, not-now, confirmed, interested, replied. Active includes the last three states only. Suppression takes precedence. |
| Buyer check-ins | Check-in records created in the week, excluding visitor_type buyer_agent; producing events count distinct event IDs. Separate legacy profile/HomeKey lead records are not deduplicated people or attributed outreach sales. |
| House intake | House creation timestamps, excluding explicit QA/test sources. Lifetime includes the partial current week; cadence excludes it. |
| Enrichment cadence | Agent-record creation week; unique house IDs and distinct agent identities per week. Timestamp-without-zone values are interpreted as UTC. |
| Averages | Completed weeks from the first intake/outreach week, including zero-activity weeks; recent comparison uses up to eight completed weeks. |
| Quality gaps | Houses with enrichment records but no flag, or a flag but no record; missing contact identities; inbound rows without a matching queue link. |

Source deletions before archive restoration cannot be recovered from these tables. Differences from the August reference PDFs may reflect elapsed activity, matured outcomes, source changes and explicit identity/deduplication rules. Never fabricate missing historical snapshots or replace verified records with the older PDF totals.

## Expanded edition (version 2)

The original metric contract remains in force. These additions restore the fuller conversion and lead narrative:

| Measure | Definition |
| --- | --- |
| Reply-to-host | Distinct replying agents with confirmed houses / distinct replying agents. Hosts without a recorded post-send reply are separately identified, never silently included in this rate. |
| Houses from replies | Confirmed houses associated with replying agents. A repeat host contributes one host but can contribute multiple houses. |
| Overall host conversion | Distinct contacted agents with a confirmed house / distinct contacted agents. |
| Recent/all cohort conversion | Confirmed houses / initial messages summed over recent eight or all completed initial-send cohorts. |
| Weekly lead total | Buyer check-in records plus profile/HomeKey lead records created during the week; not deduplicated people. |
| Leads per producing event | Linked buyer records created this week / distinct event IDs producing those records. |
| Leads per recorded event | This-week buyer records for eligible events dated this week / all such events, including zero-lead events. Active/live/ended/completed events qualify; explicit test sources and cancellations do not. |
| Per-open-house rows | One row per event ID with property address, event date, count and reporting-week scope. Resumed sessions can appear separately. Other-date/unverified events, unlinked records and profile leads remain separate. |
| Source cadence | Houses or distinct agent identities per source per completed week. Source-level agent counts may overlap; overall agent cadence deduplicates within each week. Small PDF source rows are combined as Other, without dropping their counts. |

Migration `20261014201556_outreach_report_editions.sql` adds an edition column (old rows default to 1), replaces the week-only primary key with a composite key, and prevents changing an edition. Existing RLS, private grants and completed-snapshot protection remain. The archive factory scopes reads, upserts, leases and email state by edition. Email provider idempotency/message IDs include the edition. Apply the migration with the edition-aware release; the older worker's week-only upsert key is incompatible after the constraint change. Never regenerate or mutate the original snapshot to add fields.

## Verification

Run both report test commands, route-map checks, COMMAND tests and PDF visual rendering before release. After release, inspect the deployment Git SHA, public COMMAND page, unauthorized route protection, authenticated archive generation/PDF, and owner email provider acceptance. A cron entry alone does not verify a future scheduled invocation.
