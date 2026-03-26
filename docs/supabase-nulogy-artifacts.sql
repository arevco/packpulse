-- PackPulse Nulogy artifact store
-- Run in Supabase SQL editor before uploading artifact runs.

create extension if not exists pgcrypto;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'nulogy-artifacts',
  'nulogy-artifacts',
  false,
  104857600,
  array['application/json', 'text/csv', 'text/plain']
)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

create table if not exists public.nulogy_artifact_runs (
  id uuid primary key default gen_random_uuid(),
  site_id text not null,
  run_id text not null,
  generated_at timestamptz,
  mode text,
  proxy_base_url text,
  metadata_path text,
  output_dir text,
  manifest_storage_bucket text not null default 'nulogy-artifacts',
  manifest_storage_path text,
  report_count integer not null default 0,
  succeeded_count integer not null default 0,
  failed_count integer not null default 0,
  manifest_json jsonb not null default '{}'::jsonb,
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (site_id, run_id)
);

create table if not exists public.nulogy_artifact_reports (
  id uuid primary key default gen_random_uuid(),
  site_id text not null,
  run_id text not null,
  generated_at timestamptz,
  report_code text not null,
  report_title text,
  ok boolean not null default false,
  skipped boolean not null default false,
  row_count integer,
  header_count integer,
  headers text[] not null default '{}'::text[],
  requested_columns text[] not null default '{}'::text[],
  maximum_rows integer,
  maximum_rows_text text,
  possible_truncation boolean not null default false,
  request_body jsonb not null default '{}'::jsonb,
  preview_json jsonb not null default '{}'::jsonb,
  summary_json jsonb not null default '{}'::jsonb,
  status_url text,
  download_url text,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (site_id, run_id, report_code),
  constraint nulogy_artifact_reports_run_fk
    foreign key (site_id, run_id)
    references public.nulogy_artifact_runs(site_id, run_id)
    on delete cascade
);

create table if not exists public.nulogy_artifact_files (
  id uuid primary key default gen_random_uuid(),
  site_id text not null,
  run_id text not null,
  generated_at timestamptz,
  report_code text not null default '',
  artifact_type text not null,
  storage_bucket text not null default 'nulogy-artifacts',
  storage_path text not null,
  content_type text,
  byte_size bigint not null default 0,
  sha256 text,
  row_count integer,
  header_count integer,
  created_at timestamptz not null default now(),
  unique (site_id, run_id, report_code, artifact_type),
  constraint nulogy_artifact_files_run_fk
    foreign key (site_id, run_id)
    references public.nulogy_artifact_runs(site_id, run_id)
    on delete cascade
);

create table if not exists public.nulogy_artifact_report_fields (
  id uuid primary key default gen_random_uuid(),
  site_id text not null,
  run_id text not null,
  generated_at timestamptz,
  report_code text not null,
  field_source text not null,
  ordinal integer not null default 0,
  field_name text not null,
  normalized_field_name text not null,
  created_at timestamptz not null default now(),
  unique (site_id, run_id, report_code, field_source, normalized_field_name),
  constraint nulogy_artifact_report_fields_report_fk
    foreign key (site_id, run_id, report_code)
    references public.nulogy_artifact_reports(site_id, run_id, report_code)
    on delete cascade
);

create or replace function public.set_nulogy_artifact_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_nulogy_artifact_runs_updated_at on public.nulogy_artifact_runs;
create trigger trg_nulogy_artifact_runs_updated_at
before update on public.nulogy_artifact_runs
for each row execute function public.set_nulogy_artifact_updated_at();

drop trigger if exists trg_nulogy_artifact_reports_updated_at on public.nulogy_artifact_reports;
create trigger trg_nulogy_artifact_reports_updated_at
before update on public.nulogy_artifact_reports
for each row execute function public.set_nulogy_artifact_updated_at();

create index if not exists idx_nulogy_artifact_runs_site_generated
  on public.nulogy_artifact_runs(site_id, generated_at desc, created_at desc);

create index if not exists idx_nulogy_artifact_reports_site_code_generated
  on public.nulogy_artifact_reports(site_id, report_code, generated_at desc, created_at desc);

create index if not exists idx_nulogy_artifact_reports_site_run
  on public.nulogy_artifact_reports(site_id, run_id);

create index if not exists idx_nulogy_artifact_files_site_run
  on public.nulogy_artifact_files(site_id, run_id, report_code, artifact_type);

create index if not exists idx_nulogy_artifact_files_site_type_report_generated
  on public.nulogy_artifact_files(site_id, artifact_type, report_code, generated_at desc, created_at desc);

create index if not exists idx_nulogy_artifact_fields_site_norm
  on public.nulogy_artifact_report_fields(site_id, normalized_field_name, report_code, generated_at desc);

create or replace view public.nulogy_artifact_latest_reports as
select distinct on (site_id, report_code)
  site_id,
  run_id,
  generated_at,
  report_code,
  report_title,
  ok,
  skipped,
  row_count,
  header_count,
  headers,
  requested_columns,
  maximum_rows,
  maximum_rows_text,
  possible_truncation,
  request_body,
  preview_json,
  summary_json,
  status_url,
  download_url,
  error,
  created_at,
  updated_at
from public.nulogy_artifact_reports
order by site_id, report_code, generated_at desc nulls last, created_at desc;

create or replace view public.nulogy_artifact_latest_successful_reports as
select *
from public.nulogy_artifact_latest_reports
where ok is true and skipped is false;

alter table public.nulogy_artifact_runs enable row level security;
alter table public.nulogy_artifact_reports enable row level security;
alter table public.nulogy_artifact_files enable row level security;
alter table public.nulogy_artifact_report_fields enable row level security;

-- Access is intended through PackPulse server routes using the service role.
