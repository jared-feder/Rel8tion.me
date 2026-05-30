-- Export unprinted Loan Officer Coverage Sign QR codes for print batches.
-- QR URL stays with the physical LO sign. NFC chips are registered later from /lo-sign-setup.

select
  public_code,
  qr_url,
  status,
  batch_id,
  is_printed,
  created_at
from public.loan_officer_coverage_signs
where batch_id = 'lo-sign-001'
  and status = 'available'
  and coalesce(is_printed, false) = false
order by public_code asc
limit 100;

-- Optional mark-printed block after the physical batch is exported:
--
-- update public.loan_officer_coverage_signs
-- set is_printed = true,
--     metadata = coalesce(metadata, '{}'::jsonb)
--       || jsonb_build_object('printed_at', now(), 'printed_batch_id', batch_id),
--     updated_at = now()
-- where public_code in (
--   select public_code
--   from public.loan_officer_coverage_signs
--   where batch_id = 'lo-sign-001'
--     and status = 'available'
--     and coalesce(is_printed, false) = false
--   order by public_code asc
--   limit 100
-- );
