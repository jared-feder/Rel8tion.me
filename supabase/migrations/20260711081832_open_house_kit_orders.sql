create table if not exists public.open_house_kit_orders (
  id uuid primary key default gen_random_uuid(),
  stripe_checkout_session_id text not null unique,
  stripe_webhook_event_id text,
  last_stripe_event_type text,
  stripe_subscription_id text,
  stripe_customer_id text,
  stripe_payment_intent_id text,
  status text not null default 'paid',
  fulfillment_status text not null default 'needs_review',
  plan text not null default 'unknown',
  product text,
  source text,
  flow text,
  uid text,
  agent_id text,
  agent_slug text,
  agent_name text,
  brokerage text,
  email text,
  phone text,
  phone_normalized text,
  shipping_name text,
  shipping_address_line1 text,
  shipping_address_line2 text,
  shipping_city text,
  shipping_state text,
  shipping_postal_code text,
  shipping_country text,
  address_summary text,
  event_label text,
  sign_id text,
  sponsor_profile_id text,
  sponsor_name text,
  sponsor_company text,
  notes text,
  amount_subtotal integer,
  amount_total integer,
  currency text,
  payment_status text,
  customer_details jsonb not null default '{}'::jsonb,
  shipping_details jsonb not null default '{}'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  raw_session jsonb not null default '{}'::jsonb,
  stripe_created_at timestamptz,
  paid_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint open_house_kit_orders_status_check
    check (status in ('paid', 'no_payment_required', 'payment_pending', 'payment_failed')),
  constraint open_house_kit_orders_fulfillment_status_check
    check (fulfillment_status in ('needs_review', 'payment_pending', 'payment_failed', 'preparing', 'shipped', 'delivered', 'cancelled'))
);

create index if not exists open_house_kit_orders_created_at_idx
  on public.open_house_kit_orders(created_at desc);

create index if not exists open_house_kit_orders_fulfillment_idx
  on public.open_house_kit_orders(fulfillment_status, created_at desc);

create index if not exists open_house_kit_orders_agent_slug_idx
  on public.open_house_kit_orders(agent_slug)
  where agent_slug is not null and agent_slug <> '';

create index if not exists open_house_kit_orders_email_lower_idx
  on public.open_house_kit_orders(lower(email))
  where email is not null and email <> '';

create index if not exists open_house_kit_orders_phone_normalized_idx
  on public.open_house_kit_orders(phone_normalized)
  where phone_normalized is not null and phone_normalized <> '';

alter table public.open_house_kit_orders enable row level security;

grant select, insert, update on public.open_house_kit_orders to service_role;

create or replace function public.set_open_house_kit_orders_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_open_house_kit_orders_updated_at on public.open_house_kit_orders;
create trigger set_open_house_kit_orders_updated_at
before update on public.open_house_kit_orders
for each row
execute function public.set_open_house_kit_orders_updated_at();
