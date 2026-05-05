-- Real Smart Sign test seed
--
-- Use this after:
-- 1. sql/migrations/20260423_device_assignment_slots.sql
-- 2. your agent chip is already claimed to the target agent slug
--
-- Fill these five values first:
--   AGENT_SLUG
--   SIGN_PUBLIC_CODE
--   SIGN_CHIP_UID_PRIMARY
--   SIGN_CHIP_UID_SECONDARY
--   SIGN_SLOT_NUMBER

with params as (
  select
    'AGENT_SLUG'::text as agent_slug,
    'SIGN_PUBLIC_CODE'::text as public_code,
    'SIGN_CHIP_UID_PRIMARY'::text as uid_primary,
    'SIGN_CHIP_UID_SECONDARY'::text as uid_secondary,
    1::smallint as assigned_slot
),
existing as (
  select s.id
  from public.smart_signs s
  cross join params p
  where s.public_code = p.public_code
     or s.uid_primary in (p.uid_primary, p.uid_secondary)
     or s.uid_secondary in (p.uid_primary, p.uid_secondary)
     or s.activation_uid_primary in (p.uid_primary, p.uid_secondary)
     or s.activation_uid_secondary in (p.uid_primary, p.uid_secondary)
  limit 1
),
updated as (
  update public.smart_signs s
  set
    public_code = p.public_code,
    status = coalesce(s.status, 'inactive'),
    uid_primary = p.uid_primary,
    uid_secondary = p.uid_secondary,
    activation_uid_primary = p.uid_primary,
    activation_uid_secondary = p.uid_secondary,
    activation_method = coalesce(s.activation_method, 'manual_seed_real_test'),
    primary_device_type = coalesce(s.primary_device_type, 'smart_sign_side_a'),
    secondary_device_type = coalesce(s.secondary_device_type, 'smart_sign_side_b'),
    assigned_agent_slug = p.agent_slug,
    assigned_slot = p.assigned_slot,
    assigned_at = now(),
    owner_agent_slug = coalesce(s.owner_agent_slug, p.agent_slug)
  from params p
  where s.id in (select id from existing)
  returning s.*
),
inserted as (
  insert into public.smart_signs (
    public_code,
    status,
    uid_primary,
    uid_secondary,
    activation_uid_primary,
    activation_uid_secondary,
    activation_method,
    primary_device_type,
    secondary_device_type,
    assigned_agent_slug,
    assigned_slot,
    assigned_at,
    owner_agent_slug
  )
  select
    p.public_code,
    'inactive',
    p.uid_primary,
    p.uid_secondary,
    p.uid_primary,
    p.uid_secondary,
    'manual_seed_real_test',
    'smart_sign_side_a',
    'smart_sign_side_b',
    p.agent_slug,
    p.assigned_slot,
    now(),
    p.agent_slug
  from params p
  where not exists (select 1 from updated)
  returning *
)
select
  id,
  public_code,
  status,
  uid_primary,
  uid_secondary,
  activation_uid_primary,
  activation_uid_secondary,
  assigned_agent_slug,
  assigned_slot,
  assigned_at,
  active_event_id
from updated
union all
select
  id,
  public_code,
  status,
  uid_primary,
  uid_secondary,
  activation_uid_primary,
  activation_uid_secondary,
  assigned_agent_slug,
  assigned_slot,
  assigned_at,
  active_event_id
from inserted;

-- Optional verification query:
-- select id, public_code, uid_primary, uid_secondary, activation_uid_primary, activation_uid_secondary,
--        assigned_agent_slug, assigned_slot, active_event_id, status
-- from public.smart_signs
-- where public_code = 'SIGN_PUBLIC_CODE';
