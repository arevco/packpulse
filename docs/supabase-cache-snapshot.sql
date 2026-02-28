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

alter table public.cache_snapshots disable row level security;

