-- Customer onboarding intake workspace for PackPulse.
-- Safe to run multiple times.

create extension if not exists pgcrypto;

create table if not exists public.customer_onboarding_intakes (
  id uuid primary key default gen_random_uuid(),
  site_id text not null,
  status text not null default 'draft',
  customer_name text null,
  primary_contact_name text null,
  primary_contact_email text null,
  target_production_date date null,
  intake_data jsonb not null default '{}'::jsonb,
  archived boolean not null default false,
  created_by text null,
  created_at timestamptz not null default now(),
  updated_by text null,
  updated_at timestamptz not null default now(),
  submitted_at timestamptz null,
  constraint customer_onboarding_intakes_status_check
    check (status in ('draft', 'submitted'))
);

create index if not exists customer_onboarding_intakes_site_updated_idx
  on public.customer_onboarding_intakes (site_id, updated_at desc);

create index if not exists customer_onboarding_intakes_site_status_idx
  on public.customer_onboarding_intakes (site_id, status, updated_at desc);

alter table public.customer_onboarding_intakes enable row level security;
