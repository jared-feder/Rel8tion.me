# REL8TION Agent Website Builder

This app was imported from the former `v0-real-estate-agent-template` project so it can be developed directly inside the REL8TION workspace.

## Local Development

From this folder:

```bash
pnpm install
pnpm dev
```

The app uses Next.js App Router and lives independently from the current static `apps/rel8tion-app` product surface.

## Environment

Useful environment variables found in the imported app:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `STRIPE_SECRET_KEY`
- `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`
- `REL8TION_SUPABASE_URL`
- `REL8TION_SUPABASE_ANON_KEY`
- `ADMIN_PASSWORD`
- `CRON_SECRET`
- `SENDGRID_API_KEY` or `RESEND_API_KEY`
- `LEAD_FROM_EMAIL`
- `LEAD_NOTIFICATION_EMAIL`
- `CRM_WEBHOOK_URL` or `LEAD_CRM_WEBHOOK_URL`
- `CRM_WEBHOOK_SECRET`
- `OPENAI_API_KEY`
- `OPENAI_RESPONSES_MODEL`
- `OPENAI_VIDEO_MODEL`
- `OPENAI_VIDEO_SIZE`
- `OPENAI_VIDEO_SECONDS`

## Current Notes

- `/get-started` contains bundle and standalone website pricing.
- `/api/verify-promo` checks Open House Kit promo codes.
- `/api/brands` reads REL8TION brokerages as brand options.
- `/[slug]` renders public agent websites from `agent_websites`.
- `/agent/login` sends a Supabase magic-link sign-in email, and `/agent/dashboard` shows the signed-in agent their own website plus scoped AI tools based on the `agent_websites.email` match.
- Public contact forms save to `contact_submissions`, send lead notifications when email env vars are configured, and can sync to an external CRM webhook.
- Admin AI Studio stores generated media/job history in `agent_website_ai_media`, uses preset-only options for agent headshots and staging renders through OpenAI image generation, and starts asynchronous Sora AutoReel jobs for REL8TION-branded social posts.
- Agent-owned website listings are stored in `agent_website_listings`. Scrapers/importers should insert or upsert there using `agent_website_id`, `source = 'scraper'`, and a stable `source_listing_id` or `mls_id`; do not put custom-site-only listings into the shared OneKey `listings` table.

## Agent Website Listing Sync

The website-builder app includes a server-side listing sync runner:

```powershell
npm install @supabase/supabase-js

$env:SUPABASE_URL="https://YOUR-PROJECT.supabase.co"
$env:SUPABASE_SERVICE_ROLE_KEY="YOUR_SERVICE_ROLE_KEY"

node .\rel8tion_agent_website_listings_runner.cjs --mode=smoke --dry-run=true --agent-website-id="25631a89-9fd8-44f7-a9b4-345f8040dbe2"
node .\rel8tion_agent_website_listings_runner.cjs --mode=reverse --dry-run=true --agent-website-id="25631a89-9fd8-44f7-a9b4-345f8040dbe2" --agent-name="Melissa Unger" --brokerage="Premier Agent Network"
node .\rel8tion_agent_website_listings_runner.cjs --mode=reverse --dry-run=false --agent-website-id="25631a89-9fd8-44f7-a9b4-345f8040dbe2" --agent-name="Melissa Unger" --brokerage="Premier Agent Network" --min-score=60
node .\rel8tion_agent_website_listings_runner.cjs --mode=cron --dry-run=true
```

The production cron endpoint is `GET/POST /api/cron/sync-agent-website-listings` and is configured in this app's `vercel.json` to run every 30 minutes. It requires `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`. If `CRON_SHARED_SECRET` is set, calls must include `Authorization: Bearer <secret>`.

Acceptance checks:

1. Insert a new `agent_websites` row.
2. Confirm a row appears in `agent_website_listing_sync_queue`.
3. Run cron dry-run.
4. Confirm it finds candidates but does not write.
5. Run cron live.
6. Confirm eligible matches are upserted into `agent_website_listings`.
7. Confirm weak name-only matches below score 60 are skipped.
8. Confirm `agent_websites.listing_sync_last_run_at` and `listing_sync_next_run_at` update.
9. Confirm duplicate runs update the same listing row instead of creating duplicates.
10. Confirm the public site only displays approved listing fields, not internal metadata.
- Several admin/setup flows are still demo or placeholder-backed and need REL8TION data wiring before production use.





\
