-- PackPulse warehouse invoicing snapshots
-- Run in Supabase SQL editor after the shared cache snapshot tables.

create extension if not exists pgcrypto;

create table if not exists public.warehouse_invoicing_snapshots (
  id uuid primary key default gen_random_uuid(),
  site_id text not null,
  snapshot_mode text not null,
  start_date date not null,
  end_date date not null,
  payload jsonb not null default '{}'::jsonb,
  pending boolean not null default false,
  generated_at timestamptz,
  updated_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (site_id, snapshot_mode, start_date, end_date)
);

create or replace function public.set_warehouse_invoicing_snapshots_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_warehouse_invoicing_snapshots_updated_at on public.warehouse_invoicing_snapshots;
create trigger trg_warehouse_invoicing_snapshots_updated_at
before update on public.warehouse_invoicing_snapshots
for each row execute function public.set_warehouse_invoicing_snapshots_updated_at();

create index if not exists idx_warehouse_invoicing_snapshots_site_mode_window
  on public.warehouse_invoicing_snapshots(site_id, snapshot_mode, start_date, end_date);

create index if not exists idx_warehouse_invoicing_snapshots_site_generated
  on public.warehouse_invoicing_snapshots(site_id, generated_at desc, updated_at desc);

alter table public.warehouse_invoicing_snapshots enable row level security;
