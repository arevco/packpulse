-- Sync run audit trail for PackPulse data pipeline observability.
create table if not exists public.sync_runs (
  id bigserial primary key,
  site_id text not null,
  source text not null,
  status text not null,
  row_counts jsonb not null default '{}'::jsonb,
  details jsonb not null default '{}'::jsonb,
  started_at timestamptz not null default now(),
  finished_at timestamptz not null default now(),
  updated_by text
);

create index if not exists sync_runs_site_finished_idx
  on public.sync_runs (site_id, finished_at desc);

create index if not exists sync_runs_source_finished_idx
  on public.sync_runs (source, finished_at desc);

alter table public.sync_runs disable row level security;
