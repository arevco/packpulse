-- Dedicated production events table for trend reporting.
-- Safe to run multiple times.

create table if not exists public.production_events (
  id bigserial primary key,
  site_id text not null,
  event_key text not null,
  produced_at_utc timestamptz null,
  produced_date_et date null,
  shift_label text not null default 'Unassigned',
  job_id text null,
  work_order_code text null,
  item_code text null,
  line text null,
  units_produced numeric not null default 0,
  source_snapshot_at timestamptz not null default now(),
  updated_by text null,
  raw jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint production_events_site_event_uniq unique (site_id, event_key)
);

create index if not exists production_events_site_date_idx
  on public.production_events (site_id, produced_date_et desc);

create index if not exists production_events_site_shift_idx
  on public.production_events (site_id, shift_label);

create index if not exists production_events_site_wo_idx
  on public.production_events (site_id, work_order_code);

create index if not exists production_events_site_item_idx
  on public.production_events (site_id, item_code);

