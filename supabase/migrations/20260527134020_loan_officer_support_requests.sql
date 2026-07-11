create table if not exists public.loan_officer_support_requests (
  id uuid primary key default gen_random_uuid(),
  full_name text not null,
  company_name text not null,
  email text,
  phone text not null,
  phone_normalized text,
  experience text,
  coverage_areas text,
  availability text,
  notes text,
  status text not null default 'new',
  source text not null default 'loan-officer-support-page',
  source_url text not null default 'https://app.rel8tion.me/loan-officer-support',
  user_agent text,
  ip_address text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists loan_officer_support_requests_created_at_idx
  on public.loan_officer_support_requests(created_at desc);

create index if not exists loan_officer_support_requests_status_idx
  on public.loan_officer_support_requests(status, created_at desc);

create index if not exists loan_officer_support_requests_phone_normalized_idx
  on public.loan_officer_support_requests(phone_normalized)
  where phone_normalized is not null;

create index if not exists loan_officer_support_requests_email_lower_idx
  on public.loan_officer_support_requests(lower(email))
  where email is not null and email <> '';

alter table public.loan_officer_support_requests enable row level security;

grant select, insert, update on public.loan_officer_support_requests to service_role;

create or replace function public.set_loan_officer_support_requests_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_loan_officer_support_requests_updated_at on public.loan_officer_support_requests;
create trigger set_loan_officer_support_requests_updated_at
before update on public.loan_officer_support_requests
for each row
execute function public.set_loan_officer_support_requests_updated_at();
