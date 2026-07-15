# REL8TION Environments

This repo uses branch separation to reduce production risk.

## Production

- Production branch: `main`.
- Vercel production branch should be set to `main`.
- Production uses live Supabase and live Twilio settings. Outreach uses the dedicated toll-free Twilio Messaging Service; event/owner/system SMS stays on the regular Twilio number. Android Gateway is a fallback only.
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
- The legacy/default Twilio sender belongs in `TWILIO_PHONE`; route-specific senders use `TWILIO_EVENTS_FROM_NUMBER`, `TWILIO_OUTREACH_FROM_NUMBER`, or preferably `TWILIO_OUTREACH_MESSAGING_SERVICE_SID`. Delivery callback token belongs in `TWILIO_STATUS_CALLBACK_TOKEN`. Store secret names and URL shapes in docs, not private values.
- SMS provider routing uses `SMS_PROVIDER=twilio`, `SMS_EVENTS_PROVIDER=twilio`, `TWILIO_EVENTS_FROM_NUMBER=+15168885461`, `SMS_OUTREACH_PROVIDER=twilio`, and `TWILIO_OUTREACH_MESSAGING_SERVICE_SID=MG8d7ec49cf1d6d231080b7f870a10eb0b` with toll-free sender `+18448211802`. Android Gateway remains configured for fallback.
- Runtime manual/away behavior is stored in `rel8tion_runtime_settings` under `outreach_operator_mode`.
- When `SMS_OUTREACH_PROVIDER=twilio`, a route-specific outreach sender is required; the code does not fall back to the regular event number. `OUTREACH_INITIAL_MMS_ENABLED` is disabled by code default but is explicitly `true` in current production after owner approval and verified toll-free MMS delivery. The initial Twilio MMS attaches the generated outreach image followed by the NMB business card.
