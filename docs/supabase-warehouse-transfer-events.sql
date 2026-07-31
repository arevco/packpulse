-- PackPulse normalized warehouse transfer events table
-- Run in Supabase SQL editor.

create extension if not exists pgcrypto;

create table if not exists public.warehouse_transfer_events (
  id uuid primary key default gen_random_uuid(),
  site_id text not null,
  event_key text not null,
  direction text not null,
  transfer_date_et date not null,
  customer_name text not null default 'Unassigned customer',
  reference_code text,
  order_code text,
  purchase_order_number text,
  item_code text,
  item_description text,
  lot_code text,
  pallet_number text,
  quantity numeric(14,4) not null default 0,
  unit_of_measure text,
  distinct_pallet_key text not null,
  source_report_code text not null,
  source_snapshot_at timestamptz not null default now(),
  updated_by text,
  raw jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ux_warehouse_transfer_events_site_event unique (site_id, event_key)
);

create index if not exists idx_warehouse_transfer_events_site_direction_date
  on public.warehouse_transfer_events(site_id, direction, transfer_date_et desc);

create index if not exists idx_warehouse_transfer_events_site_customer_date
  on public.warehouse_transfer_events(site_id, customer_name, transfer_date_et desc);

create index if not exists idx_warehouse_transfer_events_site_pallet
  on public.warehouse_transfer_events(site_id, pallet_number);

create index if not exists idx_warehouse_transfer_events_site_item_date
  on public.warehouse_transfer_events(site_id, item_code, transfer_date_et desc);

create or replace function public.set_warehouse_transfer_events_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_warehouse_transfer_events_updated_at on public.warehouse_transfer_events;
create trigger trg_warehouse_transfer_events_updated_at
before update on public.warehouse_transfer_events
for each row execute function public.set_warehouse_transfer_events_updated_at();

-- Access is intended through PackPulse server routes using the service role.
alter table public.warehouse_transfer_events enable row level security;
