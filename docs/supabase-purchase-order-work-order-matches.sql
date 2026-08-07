-- Reviewed Work Order matches for Purchase Orders.
-- Run after docs/supabase-purchase-orders.sql.

create extension if not exists pgcrypto;

create table if not exists public.purchase_order_work_order_matches (
  id uuid primary key default gen_random_uuid(),
  site_id text not null,
  purchase_order_id uuid not null references public.purchase_orders(id) on delete cascade,
  line_id uuid not null references public.purchase_order_lines(id) on delete cascade,
  work_order_code text not null,
  work_order_key text not null,
  match_method text not null default 'reviewed',
  work_order_snapshot jsonb not null default '{}'::jsonb,
  reviewed_by text,
  reviewed_at timestamptz not null default now(),
  unique (line_id, work_order_key)
);

create index if not exists idx_purchase_order_work_order_matches_po
  on public.purchase_order_work_order_matches(site_id, purchase_order_id, line_id);

alter table public.purchase_order_work_order_matches enable row level security;
