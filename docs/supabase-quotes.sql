-- PackPulse Quotes tab. Run after docs/supabase-purchase-orders.sql.

create extension if not exists pgcrypto;

create table if not exists public.quotes (
  id uuid primary key default gen_random_uuid(),
  site_id text not null,
  customer_name text not null,
  customer_key text not null,
  quote_number text not null,
  quote_number_key text not null,
  quote_date date not null,
  expiration_date date,
  currency text not null default 'USD',
  subtotal numeric(18,4) not null default 0,
  tax_total numeric(18,4) not null default 0,
  total numeric(18,4) not null default 0,
  status text not null default 'draft' check (status in ('draft','sent','accepted','declined','expired')),
  current_revision_id uuid,
  revision_number integer not null default 0,
  created_by text,
  created_at timestamptz not null default now(),
  updated_by text,
  updated_at timestamptz not null default now(),
  unique (site_id, customer_key, quote_number_key)
);

create table if not exists public.quote_revisions (
  id uuid primary key default gen_random_uuid(),
  site_id text not null,
  quote_id uuid references public.quotes(id) on delete cascade,
  revision_number integer not null default 1,
  processing_status text not null default 'needs_review' check (processing_status in ('processing','needs_review','confirmed','failed')),
  original_file_name text not null,
  content_type text not null,
  byte_size bigint not null default 0,
  sha256 text not null,
  storage_bucket text not null default 'purchase-orders',
  storage_path text not null,
  extracted_data jsonb not null default '{}'::jsonb,
  warnings jsonb not null default '[]'::jsonb,
  extraction_model text,
  extraction_error text,
  confirmed_by text,
  confirmed_at timestamptz,
  created_by text,
  created_at timestamptz not null default now(),
  unique (site_id, sha256),
  unique (quote_id, revision_number)
);

create table if not exists public.quote_lines (
  id uuid primary key default gen_random_uuid(),
  site_id text not null,
  quote_id uuid not null references public.quotes(id) on delete cascade,
  revision_id uuid not null references public.quote_revisions(id) on delete cascade,
  line_number integer not null,
  sku text,
  description text not null,
  quantity numeric(18,4) not null check (quantity > 0),
  uom text not null,
  unit_rate numeric(18,4) not null default 0,
  tax_amount numeric(18,4) not null default 0,
  line_amount numeric(18,4) not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (revision_id, line_number)
);

create table if not exists public.purchase_order_quote_links (
  id uuid primary key default gen_random_uuid(),
  site_id text not null,
  quote_id uuid not null references public.quotes(id) on delete cascade,
  purchase_order_id uuid not null references public.purchase_orders(id) on delete cascade,
  linked_by text,
  created_at timestamptz not null default now(),
  unique (quote_id, purchase_order_id)
);

create table if not exists public.quote_events (
  id uuid primary key default gen_random_uuid(),
  site_id text not null,
  quote_id uuid not null references public.quotes(id) on delete cascade,
  revision_id uuid references public.quote_revisions(id) on delete cascade,
  event_type text not null,
  actor text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

alter table public.quotes drop constraint if exists quotes_current_revision_fk;
alter table public.quotes add constraint quotes_current_revision_fk foreign key (current_revision_id) references public.quote_revisions(id);

create or replace function public.set_quote_updated_at()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_quotes_updated_at on public.quotes;
create trigger trg_quotes_updated_at before update on public.quotes
for each row execute function public.set_quote_updated_at();

create index if not exists idx_quotes_site_status_date on public.quotes(site_id, status, quote_date desc);
create index if not exists idx_quotes_site_expiration on public.quotes(site_id, expiration_date);
create index if not exists idx_quote_lines_site_quote on public.quote_lines(site_id, quote_id, active);
create index if not exists idx_quote_links_po on public.purchase_order_quote_links(site_id, purchase_order_id);
create index if not exists idx_quote_events_quote_created on public.quote_events(quote_id, created_at desc);

alter table public.quotes enable row level security;
alter table public.quote_revisions enable row level security;
alter table public.quote_lines enable row level security;
alter table public.purchase_order_quote_links enable row level security;
alter table public.quote_events enable row level security;
