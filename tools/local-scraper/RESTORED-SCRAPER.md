# Restored scraper - verified entry point

Use run-trulia-rotating.ps1. It resolves Node, checks the source integrity manifest, then runs trulia-old-working-plus-patch.cjs with trulia-safe-store.cjs. The familiar filename is retained; the safe store provides guarded persistence.

The browserless V5/V6, supervised, and master-enrichment variants are preserved for reference. They are not interchangeable: some retain historical-row selection, merge-duplicate overwrites, or broad photo/detail updates. Do not replace the active runner merely because a version number is higher.

## Data preservation

Existing nonblank agent name, phone, email, company and photos are preserved. Missing values are filled with conditional writes. Name/phone conflicts are logged for review. Insert conflicts never merge over an existing row. Failed searches do not downgrade enrichment flags. Write intents are stored in logs/trulia-write-audit-YYYY-MM-DD.jsonl before writes; an unavailable journal stops the write. A process lock prevents duplicate enrichment workers.

The source backup is in C:/Users/jared/scraper-backups. The original D:/_old_users/jared/scraper copy and browser profiles were not changed. The SHA256 manifest verifies recovery integrity; it is not a substitute for an independent/off-device backup. After an intentional source change, rerun the focused tests and deliberately refresh scraper-integrity.json. Do not disable verification just to silence a changed-file warning.

## Independent helpers

Production open-house refresh runs every 30 minutes. Headshot enrichment is scheduled every six hours at minute 17 and checks up to eight identities per run. The 15-minute routes are outreach jobs. Do not start an old local photo importer or schedule a second helper to duplicate the production jobs. The October 23 live attribution-aware freshness and Event Pass implementation supersedes the earlier recovery draft; that draft's claim and schedule rewrites are archived and excluded from this release.

The launcher no longer embeds a service credential. The worker loads the existing local .env file without printing it; never commit or share .env, cookie files, logs, or browser profiles.

Nothing in the restoration automatically starts scraping, sends SMS, or changes schedules.

The repository integrity manifest hashes UTF-8 source with CRLF normalized to LF, so Git line-ending conversion does not invalidate a recovered checkout. Raw-byte manifests in the independent C/E backups still verify those exact archived files. Use `node verify-scraper.cjs --source-only` to verify a checkout before installing dependencies. This tracked reference does not automatically replace or start the working copy at `C:/Users/jared/scraper`.
