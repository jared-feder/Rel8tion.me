-- Smart Sign QR URL Export
-- Use this to generate batch QR URLs from smart_signs.public_code
-- Run in Supabase SQL editor.

-- 1) Modular/test URLs
select
  id,
  public_code,
  status,
  active_event_id,
  'https://YOUR-MODULAR-VERCEL-URL/s.html?code=' || public_code as qr_url
from public.smart_signs
where public_code is not null
  and trim(public_code) <> ''
order by created_at desc nulls last;

-- 2) Production URLs
select
  id,
  public_code,
  status,
  active_event_id,
  'https://app.rel8tion.me/s.html?code=' || public_code as qr_url
from public.smart_signs
where public_code is not null
  and trim(public_code) <> ''
order by created_at desc nulls last;

-- 3) Only active signs with event attached
select
  id,
  public_code,
  owner_agent_slug,
  active_event_id,
  'https://app.rel8tion.me/s.html?code=' || public_code as qr_url
from public.smart_signs
where public_code is not null
  and trim(public_code) <> ''
  and active_event_id is not null
  and status = 'active'
order by created_at desc nulls last;
