-- PackPulse Supabase query-performance helpers
-- Safe to rerun.

create extension if not exists pg_stat_statements;
create extension if not exists hypopg;
create extension if not exists index_advisor;

create index if not exists production_events_site_source_snapshot_idx
  on public.production_events(site_id, source_snapshot_at desc);

create index if not exists idx_nulogy_artifact_files_site_type_report_generated
  on public.nulogy_artifact_files(site_id, artifact_type, report_code, generated_at desc, created_at desc);

-- Verification:
-- select extname
-- from pg_extension
-- where extname in ('pg_stat_statements', 'hypopg', 'index_advisor')
-- order by extname;
