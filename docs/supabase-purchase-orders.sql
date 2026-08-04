-- PackPulse purchase order register
-- Run in the Supabase SQL editor before enabling the Purchase Orders view.

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

create table if not exists public.purchase_orders (
  id uuid primary key default gen_random_uuid(),
  site_id text not null,
  customer_name text,
  customer_key text,
  po_number text,
  po_number_key text,
  po_date date,
  expected_date date,
  currency text not null default 'USD',
  subtotal numeric(18,4) not null default 0,
  tax_total numeric(18,4) not null default 0,
  total numeric(18,4) not null default 0,
  status text not null default 'draft' check (status in ('draft','open','closed','cancelled')),
  suggested_status text check (suggested_status is null or suggested_status in ('open','closed')),
  current_revision_id uuid,
  revision_number integer not null default 0,
  notes text,
  confirmed_at timestamptz,
  created_by text,
  created_at timestamptz not null default now(),
  updated_by text,
  updated_at timestamptz not null default now(),
  unique (site_id, customer_key, po_number_key)
);

create table if not exists public.purchase_order_revisions (
  id uuid primary key default gen_random_uuid(),
  site_id text not null,
  purchase_order_id uuid references public.purchase_orders(id) on delete cascade,
  revision_number integer not null default 1,
  processing_status text not null default 'processing'
    check (processing_status in ('processing','needs_review','confirmed','failed')),
  original_file_name text not null,
  content_type text not null,
  byte_size bigint not null default 0,
  sha256 text not null,
  storage_bucket text not null default 'purchase-orders',
  storage_path text not null,
  extracted_data jsonb not null default '{}'::jsonb,
  confidence_data jsonb not null default '{}'::jsonb,
  warnings jsonb not null default '[]'::jsonb,
  extraction_model text,
  extraction_error text,
  confirmed_by text,
  confirmed_at timestamptz,
  created_by text,
  created_at timestamptz not null default now(),
  unique (site_id, sha256),
  unique (purchase_order_id, revision_number)
);

create table if not exists public.purchase_order_lines (
  id uuid primary key default gen_random_uuid(),
  site_id text not null,
  purchase_order_id uuid not null references public.purchase_orders(id) on delete cascade,
  revision_id uuid not null references public.purchase_order_revisions(id) on delete cascade,
  line_number integer not null,
  sku text,
  sku_key text,
  description text not null,
  quantity numeric(18,4) not null check (quantity > 0),
  uom text not null,
  unit_rate numeric(18,4) not null default 0,
  tax_amount numeric(18,4) not null default 0,
  line_amount numeric(18,4) not null default 0,
  expected_date date,
  produced_quantity numeric(18,4) not null default 0,
  remaining_quantity numeric(18,4) not null default 0,
  match_status text not null default 'unmatched'
    check (match_status in ('unmatched','matched','partial','fulfilled','overproduced')),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (revision_id, line_number)
);

create table if not exists public.purchase_order_item_mappings (
  id uuid primary key default gen_random_uuid(),
  site_id text not null,
  purchase_order_id uuid not null references public.purchase_orders(id) on delete cascade,
  line_id uuid not null references public.purchase_order_lines(id) on delete cascade,
  production_item_code text not null,
  production_item_key text not null,
  reviewed_by text,
  reviewed_at timestamptz not null default now(),
  unique (line_id)
);

create table if not exists public.purchase_order_events (
  id uuid primary key default gen_random_uuid(),
  site_id text not null,
  purchase_order_id uuid references public.purchase_orders(id) on delete cascade,
  revision_id uuid references public.purchase_order_revisions(id) on delete cascade,
  event_type text not null,
  from_status text,
  to_status text,
  note text,
  metadata jsonb not null default '{}'::jsonb,
  actor text,
  created_at timestamptz not null default now()
);

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

alter table public.purchase_orders
  drop constraint if exists purchase_orders_current_revision_fk;
alter table public.purchase_orders
  add constraint purchase_orders_current_revision_fk
  foreign key (current_revision_id) references public.purchase_order_revisions(id);

create or replace function public.set_purchase_order_updated_at()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_purchase_orders_updated_at on public.purchase_orders;
create trigger trg_purchase_orders_updated_at before update on public.purchase_orders
for each row execute function public.set_purchase_order_updated_at();

create index if not exists idx_purchase_orders_site_status_date
  on public.purchase_orders(site_id, status, po_date desc);
create index if not exists idx_purchase_orders_site_due
  on public.purchase_orders(site_id, expected_date);
create index if not exists idx_purchase_orders_site_identity
  on public.purchase_orders(site_id, customer_key, po_number_key);
create index if not exists idx_purchase_order_lines_site_po
  on public.purchase_order_lines(site_id, purchase_order_id, active);
create index if not exists idx_purchase_order_lines_match
  on public.purchase_order_lines(site_id, sku_key, match_status);
create index if not exists idx_purchase_order_events_po_created
  on public.purchase_order_events(purchase_order_id, created_at desc);
create index if not exists idx_purchase_order_onboarding_documents_po_created
  on public.purchase_order_onboarding_documents(purchase_order_id, created_at desc);

alter table public.purchase_orders enable row level security;
alter table public.purchase_order_revisions enable row level security;
alter table public.purchase_order_lines enable row level security;
alter table public.purchase_order_item_mappings enable row level security;
alter table public.purchase_order_events enable row level security;
alter table public.purchase_order_onboarding_documents enable row level security;
