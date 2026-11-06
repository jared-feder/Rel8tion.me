# Batch 1: dashboard trust and recovery

Ready for Jared to review Batch 1; not released.

## Baseline and scope

Based on documentation commit `a06de1315736eebc0dfa8410baa8b693de674644`, originally branched from staging `fea00ec42227a31e208ebaa13e6bc541268c1a0a`. Dashboard baseline blob: `2a0b97db70ad581957ecce8834d8e8730f190f94`. Current staging/main dashboard source was compared before implementation and matched this baseline. Unrelated assistant and buyer-AI files were retained.

The real `apps/rel8tion-app/agent-dashboard.html` now provides:

- Manual Refresh, last successful update time, stale/offline/error feedback, a 30-second visible-page interval and a 15-second read deadline. Concurrent refreshes share one read; aborted/obsolete responses cannot overwrite newer data. Incomplete snapshots are rejected instead of presenting default zero counts as current facts.
- Last good event data on a failed update. Fit-data failure is labeled separately. Background rendering pauses while a property-fit form is focused. Refreshed rendering restores unsaved values, checkboxes, expanded details, input focus/selection and scroll. Refresh stops on page exit/hidden state and invalidates reads around scenario saves and closeout; mutations are never automatically retried.
- Retry, Home, support and physical-tap recovery guidance covering both Event Pass and Smart Sign, while preserving claimed-keychain verification. The public buyer QR does not become private access.
- Explicit financing-help counts and badges separate from lack of preapproval. No-LO guidance/coverage actions use contextual support instead of a dead `#` action or ordinary-agent entry into COMMAND.
- Narrow lead-grid wrapping at 320/390px. Existing colors, fonts, disclosure wording, financing opt-in, server authorization, message links, sponsorship, paid features and history entitlements remain in place.

**Review correction:** the hypothesized populated-check-in/no-LO crash was not reproducible. The baseline already guards its loan-officer contact block. The new behavioral test exercises that real renderer with populated and empty no-LO states; no speculative null fix was applied.

Supporting code is `src/agent-dashboard-refresh.js`. The root route map adds only its static-asset rewrite. The app-root deployment serves the file directly. No backend API, database, notification or provider contract was changed.

## Open the safe preview

On Jared's current machine: **http://127.0.0.1:4326/agent-dashboard**. A review tab is left open. This is local and requires the preview process to remain running; it is not a hosted preview.

From a checkout of this branch, restart with:

```sh
node scripts/preview-agent-ux-batch1.cjs
```

No dependencies or live environment variables are needed for the harness. If port 4326 is occupied, set `UX_PREVIEW_PORT` before starting it. The console's displayed default URL assumes port 4326.

The header selects before/after and populated, empty, Event Pass, expired-session or missing-context fixtures. Add synthetic check-in, then wait up to 30 seconds or select Refresh. Toggle Fail next reads, then Refresh to inspect last-good-data retention; toggle again to recover. Edit Purchase Price or Apartment present and select Refresh to check preservation. All names, listing information and contact fields are synthetic.

The server binds only `127.0.0.1`, validates Host and serves allowlisted routes. Its CSP restricts connections/assets to local origin, and presentation assets are cached locally. All application POSTs (including event close, scenario save, SMS and checkout), other write methods and unmatched routes fail closed. Contact/navigation links are intercepted. The only allowed POST writes a bounded JPEG to this review's local evidence directory. This local fixture response mechanism is never inserted into the production page or API. **Never deploy the harness.**

## Evidence

See [screenshots.html](screenshots.html) for the exported browser screenshots, or the files in [evidence](evidence/). Before and after use the same fixture and desktop/390/320 CSS viewport settings. Screenshot rasters omit browser chrome/scrollbars, so their pixel dimensions are slightly smaller than the CSS viewport. The navy preview controls are harness-only.

Observed in Edge against the synthetic actual page:

- A second buyer appeared through automatic refresh without reopening; manual Refresh also worked.
- Failed reads preserved two check-ins and the last success time while showing a stale warning; recovery restored normal status.
- An edited price of 712345 and checked Apartment present survived refresh.
- Empty-event, expired-session and missing-context recovery rendered successfully.
- The revised populated page had no horizontal overflow at 320 and 390 CSS pixels (document widths 307 and 375 respectively).

## Checks

68 focused/relevant checks passed with:

```sh
node --test test/agent-dashboard-refresh.test.cjs test/agent-dashboard-lo-assignment.test.cjs test/event-pass-activation.test.cjs test/event-pass-host-authorization.test.cjs test/event-pass-security.test.cjs test/event-pass-reuse-flow.test.cjs test/event-pass-mobile-viewport.test.cjs test/event-pass-product-ladder.test.cjs
```

The new tests cover serialized reads, timeout/recovery, stale-result rejection, hidden/editing deferral, form/focus/scroll preservation, actual no-LO/empty/error rendering, host validation, malformed snapshots and module routing. Existing suites cover activation, physical authorization, sponsorship consent/reuse, membership/history and browser-script parsing. Install locked repository dependencies with lifecycle scripts disabled before running the existing API suites.

An additional HTTP safety check passed:

```sh
node --test test/agent-dashboard-preview.test.cjs
```

It proves that the loopback fixture rejects application writes and unknown provider routes and applies the local-only connection policy. Route-map and architecture checks are recorded in `verification.txt`.

## Limits and review boundary

Hidden-tab polling, response reordering, deadline behavior, details/focus/selection and scroll restoration are exercised with deterministic behavioral tests. Browser verification covers the synthetic local workflow; it does not certify real NFC hardware, expired production cookies, production API availability, provider delivery or handset behavior. Live mutations were deliberately not exercised. No cloud synthetic/auth-bypass deployment was made. Refresh increases authorized read traffic to at most one snapshot plus fit-data read per 30-second successful cycle while visible and idle.

AGENTS.md reviewed — no durable rule change. CURRENT_STATE.md and REL8TION_SYSTEM_OVERVIEW.md describe the branch behavior without claiming release.

PR creation remains **denied** by automatic approval review. The denied action was opening the documentation draft PR for `feature/agent-ux-review-batches-20261106` targeting `staging`; the stated reason was that it was an external repository commitment not explicitly authorized. It did not execute. No retry or substitute PR was attempted. Deliver this committed branch and compare link until Jared explicitly approves PR creation.

Review branch: `feature/agent-ux-batch-1-dashboard`. [Compare with staging](https://github.com/jared-feder/Rel8tion.me/compare/staging...feature/agent-ux-batch-1-dashboard). The current exact head is available with `git rev-parse HEAD` and in the handoff message. Rollback before release is simply to leave this branch unmerged; no live schema or setting needs reversal.

Batch 2 and production release remain separate review/approval boundaries.
