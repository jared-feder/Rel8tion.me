-- REL8TION QR Inventory Export
-- Source of truth: public.smart_sign_inventory.public_code only.
-- Do not generate printable QR codes from the smart_signs table.
-- Safe to paste into Supabase SQL Editor. Optional INSERT/UPDATE blocks are separated below.

-- 1) Main QR inventory export
select
  id,
  public_code,
  inventory_type,
  qr_url,
  case
    when inventory_type = 'event_pass'
      then 'https://app.rel8tion.me/pass?code=' || public_code
    when qr_url is not null and trim(qr_url) <> ''
      then qr_url
    else
      'https://app.rel8tion.me/s.html?code=' || public_code
  end as generated_print_url,
  is_printed,
  claimed_at,
  smart_sign_id,
  notes,
  created_at
from public.smart_sign_inventory
where public_code is not null
  and trim(public_code) <> ''
order by created_at desc nulls last, id;

-- 2) Export ONLY unprinted Event Pass QR rows
select
  id,
  public_code,
  inventory_type,
  qr_url,
  case
    when inventory_type = 'event_pass'
      then 'https://app.rel8tion.me/pass?code=' || public_code
    when qr_url is not null and trim(qr_url) <> ''
      then qr_url
    else
      'https://app.rel8tion.me/s.html?code=' || public_code
  end as generated_print_url,
  is_printed,
  claimed_at,
  smart_sign_id,
  notes,
  created_at
from public.smart_sign_inventory
where inventory_type = 'event_pass'
  and is_printed = false
  and public_code is not null
  and trim(public_code) <> ''
order by created_at asc, id;

-- 3) Export ONLY unprinted Smart Sign QR rows
select
  id,
  public_code,
  inventory_type,
  qr_url,
  case
    when inventory_type = 'event_pass'
      then 'https://app.rel8tion.me/pass?code=' || public_code
    when qr_url is not null and trim(qr_url) <> ''
      then qr_url
    else
      'https://app.rel8tion.me/s.html?code=' || public_code
  end as generated_print_url,
  is_printed,
  claimed_at,
  smart_sign_id,
  notes,
  created_at
from public.smart_sign_inventory
where inventory_type = 'smart_sign'
  and is_printed = false
  and public_code is not null
  and trim(public_code) <> ''
order by created_at asc, id;

-- 4) Export ALL unprinted QR inventory rows
select
  id,
  public_code,
  inventory_type,
  qr_url,
  case
    when inventory_type = 'event_pass'
      then 'https://app.rel8tion.me/pass?code=' || public_code
    when qr_url is not null and trim(qr_url) <> ''
      then qr_url
    else
      'https://app.rel8tion.me/s.html?code=' || public_code
  end as generated_print_url,
  is_printed,
  claimed_at,
  smart_sign_id,
  notes,
  created_at
from public.smart_sign_inventory
where is_printed = false
  and public_code is not null
  and trim(public_code) <> ''
order by inventory_type, created_at asc, id;

-- 5) OPTIONAL INSERT: create new Event Pass inventory rows.
-- Change row_count below before running. Default example: 50.
with settings as (
  select 50::integer as row_count
),
candidate_codes as (
  select distinct
    'ep-' || lower(substr(replace(gen_random_uuid()::text, '-', ''), 1, 12)) as public_code
  from settings
  cross join generate_series(1, (select row_count * 3 from settings))
),
new_codes as (
  select candidate_codes.public_code
  from candidate_codes
  where not exists (
    select 1
    from public.smart_sign_inventory existing
    where existing.public_code = candidate_codes.public_code
  )
  order by candidate_codes.public_code
  limit (select row_count from settings)
)
insert into public.smart_sign_inventory (
  public_code,
  inventory_type,
  qr_url,
  is_printed,
  notes
)
select
  public_code,
  'event_pass',
  'https://app.rel8tion.me/pass?code=' || public_code,
  false,
  'Event Pass print batch'
from new_codes
returning
  id,
  public_code,
  inventory_type,
  qr_url,
  is_printed,
  notes,
  created_at;

-- 6) OPTIONAL UPDATE: fix Event Pass qr_url values only.
update public.smart_sign_inventory
set qr_url = 'https://app.rel8tion.me/pass?code=' || public_code
where inventory_type = 'event_pass'
  and public_code is not null
  and trim(public_code) <> ''
  and (
    qr_url is null
    or qr_url <> 'https://app.rel8tion.me/pass?code=' || public_code
  );

-- 7) OPTIONAL UPDATE: mark exported Event Pass rows as printed after printing is confirmed.
-- Replace the UUID list with the ids you actually printed.
update public.smart_sign_inventory
set is_printed = true
where inventory_type = 'event_pass'
  and is_printed = false
  and id in (
    '00000000-0000-0000-0000-000000000000'
  );
