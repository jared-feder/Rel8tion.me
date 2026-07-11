create table if not exists public.buyers (
  id uuid primary key default gen_random_uuid(),
  full_name text,
  phone text,
  phone_normalized text,
  email text,
  source text,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.buyers is
  'Global REL8TION buyer/contact record. Do not store SSN, income, credit, debt, asset, employment, AUS, preapproval letters, or financial documents here.';

create unique index if not exists buyers_phone_normalized_uidx
  on public.buyers(phone_normalized)
  where phone_normalized is not null and phone_normalized <> '';

create unique index if not exists buyers_email_lower_uidx
  on public.buyers(lower(email))
  where email is not null and email <> '';

create table if not exists public.buyer_agent_relationships (
  id uuid primary key default gen_random_uuid(),
  buyer_id uuid not null references public.buyers(id) on delete cascade,
  agent_slug text not null,
  source text,
  status text not null default 'active',
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists buyer_agent_relationships_buyer_agent_uidx
  on public.buyer_agent_relationships(buyer_id, agent_slug);

create index if not exists buyer_agent_relationships_agent_slug_idx
  on public.buyer_agent_relationships(agent_slug, status);

create table if not exists public.buyer_loan_officer_relationships (
  id uuid primary key default gen_random_uuid(),
  buyer_id uuid not null references public.buyers(id) on delete cascade,
  loan_officer_profile_id uuid not null references public.verified_profiles(uid),
  source text,
  status text not null default 'active',
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists buyer_loan_officer_relationships_buyer_lo_uidx
  on public.buyer_loan_officer_relationships(buyer_id, loan_officer_profile_id);

create index if not exists buyer_loan_officer_relationships_lo_idx
  on public.buyer_loan_officer_relationships(loan_officer_profile_id, status);

create table if not exists public.agent_loan_officer_relationships (
  id uuid primary key default gen_random_uuid(),
  agent_slug text not null,
  loan_officer_profile_id uuid not null references public.verified_profiles(uid),
  source text,
  status text not null default 'active',
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists agent_loan_officer_relationships_agent_lo_uidx
  on public.agent_loan_officer_relationships(agent_slug, loan_officer_profile_id);

create index if not exists agent_loan_officer_relationships_lo_idx
  on public.agent_loan_officer_relationships(loan_officer_profile_id, status);

create table if not exists public.buyer_affordability_guidance (
  id uuid primary key default gen_random_uuid(),
  buyer_id uuid not null references public.buyers(id) on delete cascade,
  agent_slug text not null,
  loan_officer_profile_id uuid not null references public.verified_profiles(uid),
  source_event_id uuid,
  source_checkin_id uuid,
  max_monthly_housing_payment numeric(12,2) not null check (max_monthly_housing_payment > 0),
  max_purchase_price_guidance numeric(14,2) check (max_purchase_price_guidance is null or max_purchase_price_guidance >= 0),
  max_loan_amount_guidance numeric(14,2) check (max_loan_amount_guidance is null or max_loan_amount_guidance >= 0),
  down_payment_percent numeric(7,4) check (down_payment_percent is null or (down_payment_percent >= 0 and down_payment_percent <= 100)),
  rate_assumption_percent numeric(7,4) check (rate_assumption_percent is null or (rate_assumption_percent >= 0 and rate_assumption_percent <= 25)),
  loan_term_years integer check (loan_term_years is null or (loan_term_years >= 1 and loan_term_years <= 50)),
  mortgage_insurance_monthly numeric(12,2) check (mortgage_insurance_monthly is null or mortgage_insurance_monthly >= 0),
  rent_income_allowed boolean not null default false,
  rent_income_percentage numeric(7,4) not null default 0 check (rent_income_percentage >= 0 and rent_income_percentage <= 100),
  rent_income_notes text,
  guidance_notes text,
  lo_attestation_completed_preapproval_outside_rel8tion boolean not null default false,
  lo_attestation_text text,
  status text not null default 'active' check (status in ('active', 'replaced', 'expired', 'withdrawn')),
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.buyer_affordability_guidance is
  'Guidance-only caps and assumptions entered by a licensed loan officer after any preapproval work is completed outside REL8TION. REL8TION does not collect borrower financial/application data and does not approve loans.';

create unique index if not exists buyer_affordability_guidance_active_buyer_agent_uidx
  on public.buyer_affordability_guidance(buyer_id, agent_slug)
  where status = 'active';

create index if not exists buyer_affordability_guidance_lo_idx
  on public.buyer_affordability_guidance(loan_officer_profile_id, status, updated_at desc);

create table if not exists public.buyer_property_fit_scenarios (
  id uuid primary key default gen_random_uuid(),
  guidance_id uuid not null references public.buyer_affordability_guidance(id) on delete cascade,
  buyer_id uuid not null references public.buyers(id) on delete cascade,
  checkin_id uuid,
  open_house_event_id uuid,
  agent_slug text not null,
  loan_officer_profile_id uuid references public.verified_profiles(uid),
  purchase_price numeric(14,2) not null check (purchase_price > 0),
  annual_taxes numeric(12,2) not null default 0 check (annual_taxes >= 0),
  annual_insurance numeric(12,2) not null default 0 check (annual_insurance >= 0),
  monthly_hoa numeric(12,2) not null default 0 check (monthly_hoa >= 0),
  apartment_present boolean not null default false,
  estimated_monthly_rent numeric(12,2) not null default 0 check (estimated_monthly_rent >= 0),
  estimated_principal_interest numeric(12,2),
  estimated_gross_monthly_payment numeric(12,2),
  rent_credit_monthly numeric(12,2),
  estimated_net_monthly_payment numeric(12,2),
  monthly_cap numeric(12,2),
  result_status text not null check (result_status in ('within_guidance', 'close_review_recommended', 'outside_guidance', 'lo_review_required')),
  result_label text not null check (result_label in ('Looks Within LO Guidance', 'Close — LO Review Recommended', 'Outside Current LO Guidance', 'LO Review Required')),
  assumptions_snapshot jsonb not null default '{}'::jsonb,
  agent_notes text,
  review_status text not null default 'not_reviewed' check (review_status in ('not_reviewed', 'reviewed', 'lo_review_required', 'needs_guidance_update')),
  review_notes text,
  reviewed_by_loan_officer_profile_id uuid references public.verified_profiles(uid),
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.buyer_property_fit_scenarios is
  'Agent-entered property fit scenarios compared to loan-officer-entered guidance. This is not a loan approval, underwriting decision, Loan Estimate, or commitment to lend.';

create index if not exists buyer_property_fit_scenarios_buyer_idx
  on public.buyer_property_fit_scenarios(buyer_id, created_at desc);

create index if not exists buyer_property_fit_scenarios_guidance_idx
  on public.buyer_property_fit_scenarios(guidance_id, created_at desc);

create index if not exists buyer_property_fit_scenarios_agent_idx
  on public.buyer_property_fit_scenarios(agent_slug, open_house_event_id, created_at desc);

alter table public.leads
  add column if not exists buyer_id uuid;

alter table public.event_checkins
  add column if not exists buyer_id uuid;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'leads_buyer_id_fkey'
  ) then
    alter table public.leads
      add constraint leads_buyer_id_fkey foreign key (buyer_id) references public.buyers(id) on delete set null;
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'event_checkins_buyer_id_fkey'
  ) then
    alter table public.event_checkins
      add constraint event_checkins_buyer_id_fkey foreign key (buyer_id) references public.buyers(id) on delete set null;
  end if;
end $$;

create index if not exists leads_buyer_id_idx
  on public.leads(buyer_id);

create index if not exists event_checkins_buyer_id_idx
  on public.event_checkins(buyer_id);

alter table public.buyers enable row level security;
alter table public.buyer_agent_relationships enable row level security;
alter table public.buyer_loan_officer_relationships enable row level security;
alter table public.agent_loan_officer_relationships enable row level security;
alter table public.buyer_affordability_guidance enable row level security;
alter table public.buyer_property_fit_scenarios enable row level security;

grant select, insert, update on public.buyers to service_role;
grant select, insert, update on public.buyer_agent_relationships to service_role;
grant select, insert, update on public.buyer_loan_officer_relationships to service_role;
grant select, insert, update on public.agent_loan_officer_relationships to service_role;
grant select, insert, update on public.buyer_affordability_guidance to service_role;
grant select, insert, update on public.buyer_property_fit_scenarios to service_role;
