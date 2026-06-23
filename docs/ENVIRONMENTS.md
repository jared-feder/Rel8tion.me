# REL8TION Environments

This repo uses branch separation to reduce production risk.

## Production

- Production branch: `main`.
- Vercel production branch should be set to `main`.
- Production uses live Supabase, live Twilio settings, and the Android Gateway for outreach volume when `SMS_OUTREACH_PROVIDER=android_gateway`.
- Production secrets must never be committed to the repo.
- Production is not the place to test risky Supabase, Twilio, NFC, sign, key, claim, buyer, or agent-dashboard changes.
- Current Twilio outreach recovery settings are documented in `docs/twilio-outreach-sms-runbook.md`; keep the runbook updated when changing Twilio numbers, Messaging Service webhooks, or status callback tokens.

## Staging / Pre-Production

- Staging branch: `staging`.
- Staging should be tested through a Vercel preview deployment from the `staging` branch, or through another explicitly labeled preview deployment.
- Staging should use staging/test Supabase and test Twilio settings when possible.
- SMS-related work should support a dry-run or test mode before it is promoted to production.
- NFC/sign/key/claim/buyer/agent flows must be tested on staging before merge to `main`.

## Feature Branches

- New work should happen on `feature/*` branches created from `staging`.
- Feature branches should use local/dev resources or staging resources when available.
- Feature branches should not point new risky behavior directly at production services.

## Hotfix Branches

- Emergency production fixes should use `hotfix/*` branches created from `main`.
- After a hotfix reaches `main`, merge `main` back into `staging` so testing/pre-production does not drift away from production.

## Secrets

- Use Vercel environment variables, Supabase dashboard secrets, or local untracked `.env` files for sensitive values.
- Do not commit production tokens, private service keys, Twilio credentials, webhook secrets, signing secrets, or provider API keys.
- The public Supabase anon key can exist in browser code when intentionally used as a public client key, but private service credentials must never be exposed in frontend code.
- Twilio sender number belongs in Supabase secret `TWILIO_PHONE`; delivery callback token belongs in `TWILIO_STATUS_CALLBACK_TOKEN`. Store the secret names and URL shapes in docs, not the actual token values.
- SMS provider routing should use `SMS_PROVIDER=twilio` as the default, `SMS_EVENTS_PROVIDER=twilio` for buyer/event/owner operational texts, and `SMS_OUTREACH_PROVIDER=android_gateway` when protecting Twilio from outreach volume.
