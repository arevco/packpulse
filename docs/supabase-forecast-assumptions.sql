-- PackPulse forecast assumptions (month-scoped)
-- Run in Supabase SQL editor.

create extension if not exists pgcrypto;

create table if not exists public.forecast_assumptions (
  id uuid primary key default gen_random_uuid(),
  site_id text not null,
  month_key text not null,
  global_assumptions jsonb not null default '{}'::jsonb,
  labor_templates jsonb not null default '[]'::jsonb,
  overrides jsonb not null default '[]'::jsonb,
  updated_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(site_id, month_key)
);

create or replace function public.set_forecast_assumptions_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_forecast_assumptions_updated_at on public.forecast_assumptions;
create trigger trg_forecast_assumptions_updated_at
before update on public.forecast_assumptions
for each row execute function public.set_forecast_assumptions_updated_at();

create index if not exists idx_forecast_assumptions_site_month
  on public.forecast_assumptions(site_id, month_key);

-- Access is intended through PackPulse server routes using the service role.
alter table public.forecast_assumptions enable row level security;
