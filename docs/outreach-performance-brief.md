# Outreach Performance Brief

The owner's August 17, 2026 six-section PDF is the product reference. The earlier August 5 version lacked the expanded Week in Review. Links to both originals remain in COMMAND Reports. Their original generation source was not recovered; the application now has a versioned generator and private immutable archive in this repository.

## Report and delivery

- COMMAND: `https://app.rel8tion.me/command?area=reports`.
- Private JSON/PDF archive: `/api/admin/outreach-performance-reports`, existing admin-header authorization required. `GET ?week=YYYY-MM-DD&format=pdf` downloads six pages. Credentials never appear in URLs.
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

## Verification

Run both report test commands, route-map checks, COMMAND tests and PDF visual rendering before release. After release, inspect the deployment Git SHA, public COMMAND page, unauthorized route protection, authenticated archive generation/PDF, and owner email provider acceptance. A cron entry alone does not verify a future scheduled invocation.
