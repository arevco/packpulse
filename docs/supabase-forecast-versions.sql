-- Forecast version snapshots (Phase 1)
-- Run in Supabase SQL editor.

create table if not exists public.forecast_versions (
  id bigserial primary key,
  site_id text not null,
  month_key text not null,
  version_no integer not null,
  label text not null default '',
  notes text,
  is_active boolean not null default false,
  summary jsonb not null default '{}'::jsonb,
  snapshot jsonb not null default '{}'::jsonb,
  created_by text,
  created_at timestamptz not null default now(),
  published_at timestamptz not null default now()
);

create unique index if not exists ux_forecast_versions_site_month_version
  on public.forecast_versions(site_id, month_key, version_no);

create index if not exists idx_forecast_versions_site_month
  on public.forecast_versions(site_id, month_key);

create unique index if not exists ux_forecast_versions_site_month_active
  on public.forecast_versions(site_id, month_key)
  where is_active = true;

-- Access is intended through PackPulse server routes using the service role.
alter table public.forecast_versions enable row level security;
