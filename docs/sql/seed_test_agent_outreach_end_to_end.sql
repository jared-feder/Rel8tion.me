-- Seed one test outreach row for the full pipeline:
-- queue row -> generate-agent-outreach -> trigger-agent-mockups -> approve -> send-agent-outreach
--
-- Replace the values in params with your own details before running.
-- After seeding:
-- 1. Run generate-agent-outreach
-- 2. Run trigger-agent-mockups
-- 3. Approve the row in the hot list, or run the final update block below
-- 4. Run send-agent-outreach after the scheduled send time

with params as (
  select
    'jOHN'::text as test_agent_name,
    'Jason'::text as test_agent_first_name,
    '13477758059'::text as test_agent_phone,
    'you@example.com'::text as test_agent_email,
    '2026-04-22 09:00:00 America/New_York'::timestamptz as test_initial_send_at
),
picked_open_house as (
  select
    oh.*
  from public.open_houses oh
  where oh.open_start > now() + interval '2 hours'
    and oh.open_start <= now() + interval '7 days'
    and coalesce(trim(oh.address), '') <> ''
    and coalesce(trim(oh.image), '') <> ''
  order by random()
  limit 1
),
seeded as (
  insert into public.agent_outreach_queue (
    open_house_id,
    agent_name,
    agent_first_name,
    agent_phone,
    agent_phone_normalized,
    agent_email,
    brokerage,
    address,
    price,
    beds,
    baths,
    open_start,
    open_end,
    listing_photo_url,
    source,
    enrichment_status,
    generation_status,
    review_status,
    send_status,
    send_mode,
    approved_for_send,
    mockup_status,
    initial_send_at,
    followup_send_at,
    initial_send_status,
    followup_send_status,
    selected_sms,
    followup_sms,
    sms_variant_1,
    sms_variant_2,
    sms_variant_3,
    sms_link,
    followup_sms_link,
    initial_block_reason,
    followup_block_reason,
    last_error,
    send_error
  )
  select
    oh.id,
    p.test_agent_name,
    p.test_agent_first_name,
    p.test_agent_phone,
    regexp_replace(p.test_agent_phone, '\D', '', 'g'),
    p.test_agent_email,
    coalesce(oh.brokerage, 'Test Brokerage'),
    oh.address,
    oh.price,
    oh.beds,
    oh.baths,
    oh.open_start,
    oh.open_end,
    oh.image,
    coalesce(oh.source, 'onekey'),
    'ready',
    'pending',
    'pending',
    'not_sent',
    'automatic',
    false,
    'pending',
    p.test_initial_send_at,
    null,
    'pending',
    'not_scheduled',
    null,
    null,
    null,
    null,
    null,
    null,
    null,
    null,
    null,
    null,
    null
  from picked_open_house oh
  cross join params p
  on conflict (open_house_id, agent_phone)
  do update set
    agent_name = excluded.agent_name,
    agent_first_name = excluded.agent_first_name,
    agent_phone = excluded.agent_phone,
    agent_phone_normalized = excluded.agent_phone_normalized,
    agent_email = excluded.agent_email,
    brokerage = excluded.brokerage,
    address = excluded.address,
    price = excluded.price,
    beds = excluded.beds,
    baths = excluded.baths,
    open_start = excluded.open_start,
    open_end = excluded.open_end,
    listing_photo_url = excluded.listing_photo_url,
    source = excluded.source,
    enrichment_status = 'ready',
    generation_status = 'pending',
    review_status = 'pending',
    send_status = 'not_sent',
    send_mode = 'automatic',
    approved_for_send = false,
    mockup_status = 'pending',
    initial_send_at = excluded.initial_send_at,
    followup_send_at = null,
    initial_send_status = 'pending',
    followup_send_status = 'not_scheduled',
    selected_sms = null,
    followup_sms = null,
    sms_variant_1 = null,
    sms_variant_2 = null,
    sms_variant_3 = null,
    sms_link = null,
    followup_sms_link = null,
    initial_block_reason = null,
    followup_block_reason = null,
    last_error = null,
    send_error = null,
    updated_at = now()
  returning
    id,
    open_house_id,
    agent_name,
    agent_phone,
    address,
    open_start,
    initial_send_at,
    generation_status,
    mockup_status,
    approved_for_send
)
select *
from seeded;

-- Optional final step after generate + render if you want SQL instead of clicking Approve:
--
-- update public.agent_outreach_queue
-- set
--   approved_for_send = true,
--   review_status = 'approved',
--   initial_send_at = '2026-04-22 19:00:00 America/New_York'::timestamptz
-- where id = 'PUT_QUEUE_ROW_ID_HERE';
