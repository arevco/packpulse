-- QuickBooks Online persistence tables for PackPulse invoicing.
-- Run in the Supabase SQL editor before enabling live QuickBooks export.

create table if not exists public.accounting_entity_mappings (
  id uuid primary key default gen_random_uuid(),
  site_id text not null,
  provider text not null default 'qbo',
  entity_type text not null check (entity_type in ('customer', 'item', 'term', 'ship_to')),
  packpulse_key text not null,
  packpulse_value text not null default '',
  external_id text not null,
  external_name text,
  metadata jsonb not null default '{}'::jsonb,
  is_active boolean not null default true,
  created_by text,
  created_at timestamptz not null default now(),
  updated_by text,
  updated_at timestamptz not null default now()
);

create unique index if not exists uq_accounting_entity_mappings_active_key
  on public.accounting_entity_mappings(site_id, provider, entity_type, packpulse_key)
  where is_active;

create index if not exists idx_accounting_entity_mappings_external
  on public.accounting_entity_mappings(site_id, provider, entity_type, external_id);

create table if not exists public.invoice_exports (
  id uuid primary key default gen_random_uuid(),
  site_id text not null,
  provider text not null default 'qbo',
  company_realm_id text,
  export_status text not null default 'previewed' check (export_status in ('previewed', 'queued', 'created', 'failed', 'voided', 'deleted')),
  customer_name text not null default '',
  purchase_order_number text not null default '',
  candidate_count integer not null default 0,
  external_invoice_id text,
  external_doc_number text,
  external_sync_token text,
  exported_at timestamptz,
  request_payload jsonb not null default '{}'::jsonb,
  response_payload jsonb not null default '{}'::jsonb,
  error_payload jsonb not null default '{}'::jsonb,
  created_by text,
  created_at timestamptz not null default now(),
  updated_by text,
  updated_at timestamptz not null default now()
);

create index if not exists idx_invoice_exports_site_status
  on public.invoice_exports(site_id, provider, export_status, created_at desc);

create index if not exists idx_invoice_exports_external
  on public.invoice_exports(site_id, external_invoice_id);

create table if not exists public.invoice_export_lines (
  id uuid primary key default gen_random_uuid(),
  export_id uuid not null references public.invoice_exports(id) on delete cascade,
  site_id text not null,
  provider text not null default 'qbo',
  candidate_key text not null,
  candidate_export_key text not null,
  customer_name text not null default '',
  purchase_order_number text not null default '',
  sku text not null default '',
  lot_code text not null default '',
  billed_quantity numeric not null default 0,
  billed_rate numeric not null default 0,
  billed_amount numeric not null default 0,
  unit_of_measure text,
  work_order_summary text,
  first_produced_date date,
  last_produced_date date,
  export_status text not null default 'created' check (export_status in ('previewed', 'queued', 'created', 'failed', 'voided', 'deleted')),
  is_active boolean not null default true,
  external_invoice_id text,
  external_doc_number text,
  external_line_id text,
  exported_at timestamptz,
  created_at timestamptz not null default now()
);

create unique index if not exists uq_invoice_export_lines_active_candidate
  on public.invoice_export_lines(site_id, provider, candidate_export_key)
  where is_active;

create index if not exists idx_invoice_export_lines_export
  on public.invoice_export_lines(export_id, created_at desc);

create index if not exists idx_invoice_export_lines_customer_po
  on public.invoice_export_lines(site_id, customer_name, purchase_order_number, created_at desc);

-- Access is intended through PackPulse server routes using the service role.
alter table public.accounting_entity_mappings enable row level security;
alter table public.invoice_exports enable row level security;
alter table public.invoice_export_lines enable row level security;
