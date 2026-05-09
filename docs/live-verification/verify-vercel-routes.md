# Vercel Route Verification

This checklist compares expected routes from the repo contract against root `vercel.json` and local files. It does not prove the current Vercel deployment has received these exact files.

Run:

```powershell
npm run verify:live
```

Then review `latest-live-verification-report.md`.

## Root Config Checks

- [ ] `vercel.json` exists at repo root.
- [ ] `cleanUrls` is enabled if `/a` and `/b` depend on root `a.html` and `b.html`.
- [ ] `rewrites` includes current product routes.
- [ ] `crons` state is intentional. Root config should schedule OneKey freshness; Estately enrichment scheduling still needs separate confirmation if expected.

## Product Routes

| Route | Expected local destination | Check |
| --- | --- | --- |
| `/k` | `/apps/rel8tion-app/k.html` | [ ] |
| `/claim` | `/apps/rel8tion-app/claim.html` | [ ] |
| `/onboarding` | `/apps/rel8tion-app/onboarding.html` | [ ] |
| `/sign-demo-activate` | `/apps/rel8tion-app/sign-demo-activate.html` | [ ] |
| `/s` | `/apps/rel8tion-app/sign.html` | [ ] |
| `/sign` | `/apps/rel8tion-app/sign.html` | [ ] |
| `/event` | `/apps/rel8tion-app/event.html` | [ ] |
| `/agent-dashboard` | `/apps/rel8tion-app/agent-dashboard.html` | [ ] |
| `/admin` | `/apps/rel8tion-app/admin.html` | [ ] |
| `/key-reset` | `/apps/rel8tion-app/key-reset.html` | [ ] |
| `/nmb-activate` | `/apps/rel8tion-app/nmb-activate.html` | [ ] |
| `/nmb-verified` | `/apps/rel8tion-app/nmb-verified.html` | [ ] |
| `/a` | `a.html` via `cleanUrls` | [ ] |
| `/b` | `b.html` via `cleanUrls` | [ ] |

## API Routes

| Route | Expected local file | Safety note | Check |
| --- | --- | --- | --- |
| `/api/admin/reset-key` | `api/admin/reset-key.js` | Do not call casually; destructive reset behavior is expected behind token checks. | [ ] |
| `/api/cron/enrich-agents` | `api/cron/enrich-agents.js` | Do not call casually if it can enrich production data. | [ ] |
| `/api/cron/refresh-open-house-data` | `api/cron/refresh-open-house-data.js` | Do not call casually if it can update production listing prices and active event snapshots. | [ ] |

## Deployment Verification

Local route checks are not enough for live deployment proof. For a real deployment review:

- [ ] Inspect the latest Vercel deployment for the intended branch/project.
- [ ] Confirm the deployment includes the current commit.
- [ ] Confirm rewrites are present in the deployed build.
- [ ] Confirm Cron Jobs in Vercel dashboard if enrichment is expected to run.
- [ ] Avoid manually calling cron/API endpoints that can mutate production data unless that is the explicit test.
