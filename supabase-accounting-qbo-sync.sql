-- QuickBooks Online connection + catalog sync tables for PackPulse invoicing.
-- Run in the Supabase SQL editor before enabling QuickBooks OAuth and master-data sync.

create table if not exists public.accounting_connections (
  id uuid primary key default gen_random_uuid(),
  site_id text not null,
  provider text not null default 'qbo',
  status text not null default 'connected' check (status in ('connected', 'reauthorization_required', 'error', 'disconnected')),
  environment text not null default 'production' check (environment in ('sandbox', 'production')),
  realm_id text not null,
  company_name text not null default '',
  access_token_ciphertext text not null,
  refresh_token_ciphertext text not null,
  access_token_expires_at timestamptz,
  refresh_token_expires_at timestamptz,
  scopes jsonb not null default '[]'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  last_synced_at timestamptz,
  last_sync_status text not null default 'never_synced',
  last_sync_summary jsonb not null default '{}'::jsonb,
  created_by text,
  created_at timestamptz not null default now(),
  updated_by text,
  updated_at timestamptz not null default now()
);

create unique index if not exists uq_accounting_connections_site_provider
  on public.accounting_connections(site_id, provider);

create index if not exists idx_accounting_connections_realm
  on public.accounting_connections(provider, realm_id);

create table if not exists public.accounting_catalog_entities (
  id uuid primary key default gen_random_uuid(),
  site_id text not null,
  provider text not null default 'qbo',
  realm_id text not null,
  entity_type text not null check (entity_type in ('customer', 'item', 'term')),
  external_id text not null,
  external_name text not null default '',
  external_code text not null default '',
  fully_qualified_name text not null default '',
  normalized_name text not null default '',
  normalized_code text not null default '',
  active boolean not null default true,
  sync_token text,
  metadata jsonb not null default '{}'::jsonb,
  raw_payload jsonb not null default '{}'::jsonb,
  last_synced_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists uq_accounting_catalog_entities_external
  on public.accounting_catalog_entities(site_id, provider, realm_id, entity_type, external_id);

create index if not exists idx_accounting_catalog_entities_lookup
  on public.accounting_catalog_entities(site_id, provider, realm_id, entity_type, normalized_code, normalized_name);

create index if not exists idx_accounting_catalog_entities_active
  on public.accounting_catalog_entities(site_id, provider, realm_id, entity_type, active, updated_at desc);

alter table public.accounting_connections enable row level security;
alter table public.accounting_catalog_entities enable row level security;
