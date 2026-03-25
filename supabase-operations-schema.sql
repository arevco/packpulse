-- Operations reporting support tables (manual labor + economics assumptions)
-- Safe to run multiple times.

create table if not exists public.ops_shift_inputs (
  id bigserial primary key,
  site_id text not null,
  date_et date not null,
  shift_label text not null,
  line_name text not null,
  labor_count numeric not null default 0,
  fork_count numeric not null default 0,
  qa_count numeric not null default 0,
  maint_count numeric not null default 0,
  recycling_count numeric not null default 0,
  hours_run_override numeric null,
  notes text null,
  updated_by text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ops_shift_inputs_site_shift_line_uniq unique (site_id, date_et, shift_label, line_name)
);

create index if not exists ops_shift_inputs_site_date_idx
  on public.ops_shift_inputs (site_id, date_et desc);

-- Access is intended through PackPulse server routes using the service role.
alter table public.ops_shift_inputs enable row level security;

create table if not exists public.ops_rates (
  id bigserial primary key,
  site_id text not null,
  role text not null,
  effective_from date not null default current_date,
  effective_to date null,
  hourly_rate numeric not null default 0,
  markup_pct numeric not null default 0,
  updated_by text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ops_rates_site_role_effective_uniq unique (site_id, role, effective_from)
);

create index if not exists ops_rates_site_role_idx
  on public.ops_rates (site_id, role, effective_from desc);

-- Access is intended through PackPulse server routes using the service role.
alter table public.ops_rates enable row level security;

create table if not exists public.ops_sku_targets (
  id bigserial primary key,
  site_id text not null,
  item_code text not null,
  customer text null,
  active_from date not null default current_date,
  active_to date null,
  revenue_per_case numeric not null default 0,
  target_cases_per_hour numeric null,
  updated_by text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ops_sku_targets_site_item_active_uniq unique (site_id, item_code, active_from)
);

create index if not exists ops_sku_targets_site_item_idx
  on public.ops_sku_targets (site_id, item_code, active_from desc);

-- Access is intended through PackPulse server routes using the service role.
alter table public.ops_sku_targets enable row level security;
