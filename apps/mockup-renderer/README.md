# Mockup Renderer

This Vercel app renders outreach JPG mockups with `sharp`, uploads them to Supabase Storage, updates `agent_outreach_queue.mockup_image_url`, and wraps the existing generate/send jobs with cron endpoints.

## Root directory

Set the Vercel project root to:

`apps/mockup-renderer`

## Required environment variables

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `SUPABASE_STORAGE_BUCKET`
- `REL8TION_PUBLIC_BASE_URL`
- `GENERATE_FUNCTION_URL`
- `TWILIO_SEND_FUNCTION_URL`
- `CRON_SHARED_SECRET`

## Cron flow

1. `/api/cron-generate`
2. `/api/cron-render`
3. `/api/cron-send`
