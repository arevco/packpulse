-- PackPulse shared cache snapshot (Phase 1)
-- Run in Supabase SQL editor.

create extension if not exists pgcrypto;

create table if not exists public.cache_snapshots (
  id uuid primary key default gen_random_uuid(),
  site_id text not null unique,
  payload jsonb not null default '{}'::jsonb,
  row_counts jsonb not null default '{}'::jsonb,
  synced_at timestamptz not null default now(),
  updated_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function public.set_cache_snapshots_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_cache_snapshots_updated_at on public.cache_snapshots;
create trigger trg_cache_snapshots_updated_at
before update on public.cache_snapshots
for each row execute function public.set_cache_snapshots_updated_at();

create index if not exists idx_cache_snapshots_site_id on public.cache_snapshots(site_id);

-- Access is intended through PackPulse server routes using the service role.
alter table public.cache_snapshots enable row level security;

create table if not exists public.cache_snapshot_history (
  id uuid primary key default gen_random_uuid(),
  site_id text not null,
  row_counts jsonb not null default '{}'::jsonb,
  derived_metrics jsonb not null default '{}'::jsonb,
  captured_at timestamptz not null default now(),
  updated_by text,
  created_at timestamptz not null default now()
);

create index if not exists idx_cache_snapshot_history_site_captured
  on public.cache_snapshot_history(site_id, captured_at desc);

-- Access is intended through PackPulse server routes using the service role.
alter table public.cache_snapshot_history enable row level security;
