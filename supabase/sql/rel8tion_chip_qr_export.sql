-- Export unprinted agent Rel8tionChip QR codes for print batches.
-- QR URL should be printed on the keychain. NFC should remain programmed to /k?uid=<uid>.

select
  chip_code,
  qr_url,
  chip_type,
  status,
  is_printed,
  created_at
from public.rel8tion_chip_inventory
where chip_type = 'agent'
  and status = 'unassigned'
  and is_printed = false
order by created_at asc, chip_code asc
limit 1000;

-- Optional mark-printed block after the physical batch is exported:
--
-- update public.rel8tion_chip_inventory
-- set is_printed = true,
--     notes = coalesce(notes || E'\n', '') || 'Printed batch exported on ' || now()::text
-- where chip_code in (
--   select chip_code
--   from public.rel8tion_chip_inventory
--   where chip_type = 'agent'
--     and status = 'unassigned'
--     and is_printed = false
--   order by created_at asc, chip_code asc
--   limit 1000
-- );
