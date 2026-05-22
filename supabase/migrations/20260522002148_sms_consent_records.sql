create table if not exists public.sms_consent_records (
  id uuid primary key default gen_random_uuid(),
  full_name text not null,
  phone text not null,
  phone_normalized text,
  email text,
  role text,
  consent_status text not null default 'opted_in',
  consent_text text not null,
  consent_source text not null default 'sms-consent-page',
  consent_url text not null default 'https://rel8tion.me/sms-consent',
  user_agent text,
  ip_address text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists sms_consent_records_phone_normalized_uidx
  on public.sms_consent_records(phone_normalized)
  where phone_normalized is not null;

create index if not exists sms_consent_records_created_at_idx
  on public.sms_consent_records(created_at desc);

alter table public.sms_consent_records enable row level security;

grant insert on public.sms_consent_records to service_role;
grant select, update on public.sms_consent_records to service_role;

create or replace function public.set_sms_consent_records_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_sms_consent_records_updated_at on public.sms_consent_records;
create trigger set_sms_consent_records_updated_at
before update on public.sms_consent_records
for each row
execute function public.set_sms_consent_records_updated_at();
