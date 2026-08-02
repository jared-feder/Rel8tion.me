create table if not exists public.pricing_entitlements (
  id bigint generated always as identity primary key,
  stripe_checkout_session_id text not null unique,
  stripe_customer_id text,
  stripe_subscription_id text,
  stripe_event_id text,
  plan_code text not null,
  role text not null,
  subject_email text,
  subject_slug text,
  status text not null default 'pending',
  seat_status text,
  entitlement_codes text[] not null default '{}',
  website_included boolean not null default false,
  digital_card_included boolean not null default false,
  content_tools_included boolean not null default false,
  outreach_included boolean not null default false,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint pricing_entitlements_role_check check (role in ('real_estate_agent', 'loan_officer')),
  constraint pricing_entitlements_status_check check (status in ('pending', 'active', 'payment_failed', 'inactive', 'canceled')),
  constraint pricing_entitlements_seat_status_check check (seat_status is null or seat_status in ('pending_approval', 'approved', 'rejected', 'inactive'))
);

create index if not exists pricing_entitlements_subscription_idx
  on public.pricing_entitlements (stripe_subscription_id)
  where stripe_subscription_id is not null;

create index if not exists pricing_entitlements_customer_idx
  on public.pricing_entitlements (stripe_customer_id)
  where stripe_customer_id is not null;

create index if not exists pricing_entitlements_subject_slug_idx
  on public.pricing_entitlements (subject_slug)
  where subject_slug is not null;

alter table public.pricing_entitlements enable row level security;
alter table public.pricing_entitlements force row level security;

revoke all on table public.pricing_entitlements from anon, authenticated;
grant select, insert, update on table public.pricing_entitlements to service_role;
grant usage, select on sequence public.pricing_entitlements_id_seq to service_role;

comment on table public.pricing_entitlements is
  'Server-managed Stripe checkout entitlement ledger. Browser roles have no direct access.';

comment on column public.pricing_entitlements.seat_status is
  'Loan-officer outreach seats remain pending_approval after payment until a separate server-side approval.';
