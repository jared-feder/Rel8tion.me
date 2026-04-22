-- Seed one test outreach row using a random upcoming open house.
-- Replace the values in params with your own phone/name before running.
-- Example send time below is April 22, 2026 at 7:00 PM America/New_York.

with params as (
  select
    'Alexa Sokolov'::text as test_agent_name,
    'Alexa'::text as test_agent_first_name,
    '19172164317'::text as test_agent_phone,
    'jared@rel8tion.me'::text as test_agent_email,
    '2026-04-22 07:00:00 America/New_York'::timestamptz as test_initial_send_at
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
    agent_phone_normalized, `
    agent_email,
    brokerage,
    address,
    price,
    beds,
    baths,
    open_start,
    open_end,
    listing_photo_url,
    mockup_image_url,
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
    oh.image,
    coalesce(oh.source, 'onekey'),
    'ready',
    'generated',
    'approved',
    'not_sent',
    'automatic',
    true,
    'rendered',
    p.test_initial_send_at,
    null,
    'pending',
    'not_scheduled',
    'Hey ' || p.test_agent_first_name || ' - Jared here. Saw your open house at ' || oh.address || '. Would love to stop by and support. I also made a custom Rel8tion sign for it. Open to me swinging by for a quick hello?',
    'Hey ' || p.test_agent_first_name || ' - just circling back before ' || oh.address || '. Happy to stop by and bring the custom Rel8tion sign if helpful.',
    'Hey ' || p.test_agent_first_name || ' - Jared here. Saw your open house at ' || oh.address || '. Would love to stop by and support. I also made a custom Rel8tion sign for it. Open to me swinging by for a quick hello?',
    'Hey ' || p.test_agent_first_name || ' - I noticed your open house at ' || oh.address || '. I made a custom Rel8tion sign for it and would love to drop it off if you''re open.',
    'Hey ' || p.test_agent_first_name || ' - quick one: I saw your open house at ' || oh.address || ' and made a custom sign for it. Want me to swing by and show you?',
    null,
    null,
    null,
    'followup_not_scheduled',
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
    mockup_image_url = excluded.mockup_image_url,
    source = excluded.source,
    enrichment_status = excluded.enrichment_status,
    generation_status = excluded.generation_status,
    review_status = excluded.review_status,
    send_status = excluded.send_status,
    send_mode = excluded.send_mode,
    approved_for_send = excluded.approved_for_send,
    mockup_status = excluded.mockup_status,
    initial_send_at = excluded.initial_send_at,
    followup_send_at = excluded.followup_send_at,
    initial_send_status = excluded.initial_send_status,
    followup_send_status = excluded.followup_send_status,
    selected_sms = excluded.selected_sms,
    followup_sms = excluded.followup_sms,
    sms_variant_1 = excluded.sms_variant_1,
    sms_variant_2 = excluded.sms_variant_2,
    sms_variant_3 = excluded.sms_variant_3,
    sms_link = excluded.sms_link,
    followup_sms_link = excluded.followup_sms_link,
    initial_block_reason = excluded.initial_block_reason,
    followup_block_reason = excluded.followup_block_reason,
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
    initial_send_status,
    selected_sms
)
select *
from seeded;
