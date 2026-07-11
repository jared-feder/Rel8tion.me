alter table public.open_house_kit_orders
  add column if not exists dashboard_secured_at timestamptz,
  add column if not exists dashboard_password_hash text,
  add column if not exists dashboard_password_set_at timestamptz,
  add column if not exists dashboard_device_lock_set_at timestamptz,
  add column if not exists dashboard_device_lock_label text,
  add column if not exists dashboard_last_accessed_at timestamptz,
  add column if not exists logo_choice_status text not null default 'not_started',
  add column if not exists selected_logo_id uuid,
  add column if not exists selected_logo_name text,
  add column if not exists selected_logo_url text,
  add column if not exists custom_logo_url text,
  add column if not exists custom_logo_storage_path text,
  add column if not exists logo_notes text,
  add column if not exists logo_selected_at timestamptz,
  add column if not exists welcome_email_status text not null default 'pending',
  add column if not exists welcome_email_sent_at timestamptz,
  add column if not exists welcome_email_error text,
  add column if not exists welcome_sms_status text not null default 'pending',
  add column if not exists welcome_sms_sent_at timestamptz,
  add column if not exists welcome_sms_error text,
  add column if not exists welcome_message_last_attempted_at timestamptz,
  add column if not exists welcome_message_count integer not null default 0;

alter table public.open_house_kit_orders
  drop constraint if exists open_house_kit_orders_logo_choice_status_check;

alter table public.open_house_kit_orders
  add constraint open_house_kit_orders_logo_choice_status_check
    check (logo_choice_status in ('not_started', 'selected', 'uploaded', 'needs_review'));

alter table public.open_house_kit_orders
  drop constraint if exists open_house_kit_orders_welcome_email_status_check;

alter table public.open_house_kit_orders
  add constraint open_house_kit_orders_welcome_email_status_check
    check (welcome_email_status in ('pending', 'sent', 'skipped', 'failed'));

alter table public.open_house_kit_orders
  drop constraint if exists open_house_kit_orders_welcome_sms_status_check;

alter table public.open_house_kit_orders
  add constraint open_house_kit_orders_welcome_sms_status_check
    check (welcome_sms_status in ('pending', 'sent', 'skipped', 'failed'));

create table if not exists public.company_logos (
  id uuid primary key default gen_random_uuid(),
  brand_key text not null unique,
  display_name text not null,
  brokerage_name text,
  domain text,
  logo_url text not null,
  source text not null default 'seed',
  status text not null default 'approved',
  aliases text[] not null default '{}'::text[],
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint company_logos_status_check
    check (status in ('approved', 'needs_review', 'archived'))
);

alter table public.open_house_kit_orders
  drop constraint if exists open_house_kit_orders_selected_logo_id_fkey;

alter table public.open_house_kit_orders
  add constraint open_house_kit_orders_selected_logo_id_fkey
    foreign key (selected_logo_id) references public.company_logos(id)
    on delete set null;

create index if not exists company_logos_status_name_idx
  on public.company_logos(status, display_name);

create index if not exists open_house_kit_orders_logo_status_idx
  on public.open_house_kit_orders(logo_choice_status, created_at desc);

alter table public.company_logos enable row level security;

grant select, insert, update on public.company_logos to service_role;

create or replace function public.set_company_logos_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_company_logos_updated_at on public.company_logos;
create trigger set_company_logos_updated_at
before update on public.company_logos
for each row
execute function public.set_company_logos_updated_at();

insert into public.company_logos (brand_key, display_name, brokerage_name, domain, logo_url, source, status, aliases)
values
  ('rel8tion', 'REL8TION', 'REL8TION', 'rel8tion.me', 'https://rel8tion.me/wp-content/uploads/2026/04/logo150x100trans.png', 'seed', 'approved', array['rel8tion', 'relation']),
  ('douglas_elliman', 'Douglas Elliman', 'Douglas Elliman', 'elliman.com', 'https://www.google.com/s2/favicons?domain=elliman.com&sz=128', 'domain_favicon_seed', 'approved', array['douglas elliman', 'elliman', 'de']),
  ('compass', 'Compass', 'Compass', 'compass.com', 'https://www.google.com/s2/favicons?domain=compass.com&sz=128', 'domain_favicon_seed', 'approved', array['compass real estate']),
  ('corcoran', 'The Corcoran Group', 'Corcoran', 'corcoran.com', 'https://www.google.com/s2/favicons?domain=corcoran.com&sz=128', 'domain_favicon_seed', 'approved', array['corcoran']),
  ('coldwell_banker', 'Coldwell Banker', 'Coldwell Banker', 'coldwellbanker.com', 'https://www.google.com/s2/favicons?domain=coldwellbanker.com&sz=128', 'domain_favicon_seed', 'approved', array['coldwell banker', 'cb']),
  ('keller_williams', 'Keller Williams', 'Keller Williams', 'kw.com', 'https://www.google.com/s2/favicons?domain=kw.com&sz=128', 'domain_favicon_seed', 'approved', array['keller williams', 'kw']),
  ('exp_realty', 'eXp Realty', 'eXp Realty', 'exprealty.com', 'https://www.google.com/s2/favicons?domain=exprealty.com&sz=128', 'domain_favicon_seed', 'approved', array['exp', 'exp realty']),
  ('serhant', 'SERHANT.', 'SERHANT.', 'serhant.com', 'https://www.google.com/s2/favicons?domain=serhant.com&sz=128', 'domain_favicon_seed', 'approved', array['serhant']),
  ('brown_harris_stevens', 'Brown Harris Stevens', 'Brown Harris Stevens', 'bhsusa.com', 'https://www.google.com/s2/favicons?domain=bhsusa.com&sz=128', 'domain_favicon_seed', 'approved', array['bhs', 'brown harris stevens']),
  ('sothebys', 'Sotheby''s International Realty', 'Sotheby''s International Realty', 'sothebysrealty.com', 'https://www.google.com/s2/favicons?domain=sothebysrealty.com&sz=128', 'domain_favicon_seed', 'approved', array['sothebys', 'sotheby''s']),
  ('remax', 'RE/MAX', 'RE/MAX', 'remax.com', 'https://www.google.com/s2/favicons?domain=remax.com&sz=128', 'domain_favicon_seed', 'approved', array['remax', 're/max']),
  ('century_21', 'Century 21', 'Century 21', 'century21.com', 'https://www.google.com/s2/favicons?domain=century21.com&sz=128', 'domain_favicon_seed', 'approved', array['century 21', 'c21'])
on conflict (brand_key) do update set
  display_name = excluded.display_name,
  brokerage_name = excluded.brokerage_name,
  domain = excluded.domain,
  logo_url = excluded.logo_url,
  source = excluded.source,
  status = excluded.status,
  aliases = excluded.aliases,
  updated_at = now();

create table if not exists public.open_house_kit_access_tokens (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.open_house_kit_orders(id) on delete cascade,
  token_hash text not null unique,
  purpose text not null default 'dashboard',
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '90 days'),
  last_used_at timestamptz,
  revoked_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  constraint open_house_kit_access_tokens_purpose_check
    check (purpose in ('dashboard', 'welcome_email', 'welcome_sms', 'checkout_success', 'chip_scan', 'password_login'))
);

create index if not exists open_house_kit_access_tokens_order_idx
  on public.open_house_kit_access_tokens(order_id, created_at desc);

create index if not exists open_house_kit_access_tokens_active_idx
  on public.open_house_kit_access_tokens(order_id, expires_at desc)
  where revoked_at is null;

alter table public.open_house_kit_access_tokens enable row level security;

grant select, insert, update on public.open_house_kit_access_tokens to service_role;

create table if not exists public.open_house_kit_notifications (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.open_house_kit_orders(id) on delete cascade,
  channel text not null,
  recipient text,
  template_key text not null,
  status text not null default 'pending',
  provider text,
  provider_message_id text,
  error text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  updated_at timestamptz not null default now(),
  constraint open_house_kit_notifications_channel_check
    check (channel in ('email', 'sms')),
  constraint open_house_kit_notifications_status_check
    check (status in ('pending', 'sent', 'skipped', 'failed'))
);

create unique index if not exists open_house_kit_notifications_once_idx
  on public.open_house_kit_notifications(order_id, channel, template_key)
  where status = 'sent';

create index if not exists open_house_kit_notifications_order_idx
  on public.open_house_kit_notifications(order_id, created_at desc);

alter table public.open_house_kit_notifications enable row level security;

grant select, insert, update on public.open_house_kit_notifications to service_role;

create or replace function public.set_open_house_kit_notifications_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_open_house_kit_notifications_updated_at on public.open_house_kit_notifications;
create trigger set_open_house_kit_notifications_updated_at
before update on public.open_house_kit_notifications
for each row
execute function public.set_open_house_kit_notifications_updated_at();

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'open-house-kit-logos',
  'open-house-kit-logos',
  true,
  5242880,
  array['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml']::text[]
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Public read Open House Kit logos" on storage.objects;
create policy "Public read Open House Kit logos"
on storage.objects
for select
to anon, authenticated
using (bucket_id = 'open-house-kit-logos');
