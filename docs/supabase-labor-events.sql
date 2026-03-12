-- PackPulse canonical labor actuals table
-- Run in Supabase SQL editor.

create extension if not exists pgcrypto;

create table if not exists public.labor_events (
  id uuid primary key default gen_random_uuid(),
  site_id text not null,
  event_key text not null,
  worked_at_utc timestamptz,
  clock_in_at_utc timestamptz,
  clock_out_at_utc timestamptz,
  worked_date_et date,
  shift_label text,
  line_name text,
  job_id text,
  work_order_code text,
  work_order_id text,
  item_code text,
  item_description text,
  item_family_name text,
  role_name text,
  role_key text,
  badge_type_prefix text,
  hourly_rate numeric(12,4) not null default 0,
  duration_hours numeric(12,4) not null default 0,
  payable_hours numeric(12,4) not null default 0,
  productive_hours numeric(12,4) not null default 0,
  availability_pct numeric(12,4) not null default 0,
  performance_pct numeric(12,4) not null default 0,
  line_efficiency_pct numeric(12,4) not null default 0,
  source_snapshot_at timestamptz,
  updated_by text,
  raw jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ux_labor_events_site_event unique (site_id, event_key)
);

create index if not exists idx_labor_events_site_date
  on public.labor_events(site_id, worked_date_et desc);

create index if not exists idx_labor_events_site_shift
  on public.labor_events(site_id, worked_date_et desc, shift_label);

create index if not exists idx_labor_events_site_line
  on public.labor_events(site_id, line_name, worked_date_et desc);

create index if not exists idx_labor_events_site_job
  on public.labor_events(site_id, job_id);

create index if not exists idx_labor_events_site_wo
  on public.labor_events(site_id, work_order_code);

create or replace function public.set_labor_events_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_labor_events_updated_at on public.labor_events;
create trigger trg_labor_events_updated_at
before update on public.labor_events
for each row execute function public.set_labor_events_updated_at();

alter table public.labor_events disable row level security;
