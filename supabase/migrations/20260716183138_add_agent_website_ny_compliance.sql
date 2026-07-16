alter table public.agent_websites
  add column if not exists license_type text,
  add column if not exists brokerage_address text,
  add column if not exists brokerage_phone text,
  add column if not exists brokerage_website_url text,
  add column if not exists standardized_operating_procedure_url text,
  add column if not exists ny_compliance_updated_at timestamptz;

comment on column public.agent_websites.license_type is 'Exact New York license type displayed with the licensee name.';
comment on column public.agent_websites.standardized_operating_procedure_url is 'Public URL for the employing broker standardized operating procedures required by NY RPL 442-h.';
