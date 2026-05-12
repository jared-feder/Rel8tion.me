# REL8TION Git Workflow

This workflow keeps production stable while still allowing fast iteration.

## Branch Roles

- `main` is production. Vercel production should deploy from `main`.
- `staging` is testing and pre-production.
- `feature/*` branches are for new development work.
- `hotfix/*` branches are for emergency production fixes.

## Required Flow

New work:

1. Branch from `staging` using `feature/name-of-work`.
2. Merge feature branches into `staging` first.
3. Test the affected routes, mobile/NFC paths, Supabase writes, and SMS behavior on staging or preview.
4. Merge `staging` into `main` only after testing.

Hotfixes:

1. Branch from `main` using `hotfix/name-of-fix`.
2. Merge the hotfix into `main` after focused testing.
3. Merge `main` back into `staging` immediately after the production fix lands.

Legacy branches:

- Older legacy/dev branches may still merge into `staging` temporarily while the repo is cleaned up.
- Legacy/dev branches should not merge directly into `main`.
- If a legacy branch contains production-critical work, first reconcile it into `staging`, test, then promote through the normal `staging` to `main` path.

## Hard Rules

- Never commit directly to `main`.
- Never test risky Supabase, Twilio, NFC, sign, key, claim, buyer, or agent-dashboard changes directly on production.
- Never force-push `main` or `staging`.
- Never delete production or historical recovery branches without an explicit cleanup plan.
- Never commit production secrets.
- Do not automatically merge anything without review.

## Command Examples

Check current branch:

```bash
git branch --show-current
git status --short
```

Update `staging`:

```bash
git switch staging
git fetch origin
git pull --ff-only origin staging
```

Create a feature branch from `staging`:

```bash
git switch staging
git pull --ff-only origin staging
git switch -c feature/name-of-work
```

Push a feature branch:

```bash
git push -u origin feature/name-of-work
```

Open a PR from feature to staging:

```bash
gh pr create --base staging --head feature/name-of-work --title "Short title" --body "Summary, testing, risks, rollback."
```

Open a PR from staging to main:

```bash
gh pr create --base main --head staging --title "Promote staging to production" --body "Summary of tested changes and rollback notes."
```

Create a hotfix branch from `main`:

```bash
git switch main
git fetch origin
git pull --ff-only origin main
git switch -c hotfix/name-of-fix
```

Push a hotfix branch:

```bash
git push -u origin hotfix/name-of-fix
```

Open a PR from hotfix to main:

```bash
gh pr create --base main --head hotfix/name-of-fix --title "Hotfix: short title" --body "Emergency fix, testing, risks, rollback."
```

Sync a production hotfix back into `staging`:

```bash
git switch staging
git fetch origin
git pull --ff-only origin staging
git merge origin/main
git push origin staging
```

If the merge is not clean, stop and resolve it in a separate sync branch:

```bash
git switch staging
git pull --ff-only origin staging
git switch -c sync/main-into-staging
git merge origin/main
git push -u origin sync/main-into-staging
gh pr create --base staging --head sync/main-into-staging --title "Sync main into staging" --body "Brings production hotfixes back into staging."
```

## Manual GitHub Branch Protection

Configure these settings in GitHub repository settings:

- Protect `main`.
- Require pull requests before merging into `main`.
- Require the `Branch Safety` workflow to pass.
- Require the `Repo Checks` workflow to pass.
- Block force pushes.
- Block branch deletions.
- Restrict direct pushes to `main` if available for the repository plan.
- Prefer requiring conversation resolution before merge.

Recommended optional settings:

- Protect `staging` from force pushes and deletions.
- Require status checks before merging into `staging`.
- Require a linear history if that matches the team's merge style.

## Vercel Production Rule

Vercel production branch should be `main`. Preview and staging work should be tested through the `staging` branch preview or another Vercel preview deployment before promotion to `main`.
