-- Incremental migration for PackPulse installations that already ran
-- docs/supabase-purchase-orders.sql.

create extension if not exists pgcrypto;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'purchase-orders',
  'purchase-orders',
  false,
  4194304,
  array[
    'application/pdf',
    'image/jpeg',
    'image/png',
    'text/csv',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  ]
)
on conflict (id) do update
set public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

create table if not exists public.purchase_order_onboarding_documents (
  id uuid primary key default gen_random_uuid(),
  site_id text not null,
  purchase_order_id uuid not null references public.purchase_orders(id) on delete cascade,
  original_file_name text not null,
  content_type text not null default 'application/pdf',
  byte_size bigint not null default 0,
  sha256 text not null,
  storage_bucket text not null default 'purchase-orders',
  storage_path text not null,
  uploaded_by text,
  created_at timestamptz not null default now(),
  unique (site_id, purchase_order_id, sha256)
);

create index if not exists idx_purchase_order_onboarding_documents_po_created
  on public.purchase_order_onboarding_documents(purchase_order_id, created_at desc);

alter table public.purchase_order_onboarding_documents enable row level security;
