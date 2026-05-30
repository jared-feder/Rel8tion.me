-- Loan Officer Coverage Sign setup lane and starter QR pool.
-- Physical LO signs use a printed QR at /lo-sign?code=PUBLIC_CODE plus two NFC chips.
-- The legacy `uid` column remains as the primary-chip compatibility alias for /k routing.

alter table public.loan_officer_coverage_signs
  add column if not exists uid_primary text null,
  add column if not exists uid_secondary text null,
  add column if not exists primary_device_type text default 'lo_sign_primary_chip',
  add column if not exists secondary_device_type text default 'lo_sign_secondary_chip',
  add column if not exists assigned_at timestamptz null,
  add column if not exists setup_started_at timestamptz null,
  add column if not exists setup_confirmed_at timestamptz null,
  add column if not exists qr_url text null,
  add column if not exists batch_id text null,
  add column if not exists is_printed boolean default false;

create unique index if not exists idx_loan_officer_coverage_signs_uid_primary
  on public.loan_officer_coverage_signs(uid_primary)
  where uid_primary is not null;

create unique index if not exists idx_loan_officer_coverage_signs_uid_secondary
  on public.loan_officer_coverage_signs(uid_secondary)
  where uid_secondary is not null;

create index if not exists idx_loan_officer_coverage_signs_batch_printed
  on public.loan_officer_coverage_signs(batch_id, is_printed, public_code);

insert into public.loan_officer_coverage_signs (
  public_code,
  status,
  qr_url,
  batch_id,
  metadata
)
select
  'lo' || lpad(gs::text, 6, '0') as public_code,
  'available' as status,
  'https://app.rel8tion.me/lo-sign?code=' || 'lo' || lpad(gs::text, 6, '0') as qr_url,
  'lo-sign-001' as batch_id,
  jsonb_build_object(
    'source', 'lo_coverage_sign_setup_batch',
    'batch_id', 'lo-sign-001',
    'created_for', 'loan officer coverage sign QR pool'
  ) as metadata
from generate_series(1, 100) as gs
on conflict (public_code) do nothing;
