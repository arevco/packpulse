-- PackPulse RLS hardening for existing Supabase projects.
-- Safe to run multiple times.
--
-- This script enables RLS on PackPulse application tables.
-- PackPulse server routes use the Supabase service role, so no public
-- anon/authenticated policies are added here.
--
-- If you later want browser-direct Supabase access to any of these tables,
-- add explicit policies for that use case instead of disabling RLS.

begin;

alter table if exists public.cache_snapshots enable row level security;
alter table if exists public.cache_snapshot_history enable row level security;
alter table if exists public.production_events enable row level security;
alter table if exists public.labor_events enable row level security;
alter table if exists public.ops_shift_inputs enable row level security;
alter table if exists public.ops_rates enable row level security;
alter table if exists public.ops_sku_targets enable row level security;
alter table if exists public.user_login_events enable row level security;
alter table if exists public.forecast_versions enable row level security;
alter table if exists public.forecast_assumptions enable row level security;
alter table if exists public.sync_runs enable row level security;

commit;

-- Verification:
-- select schemaname, tablename, rowsecurity
-- from pg_tables
-- where schemaname = 'public'
--   and tablename in (
--     'cache_snapshots',
--     'cache_snapshot_history',
--     'production_events',
--     'labor_events',
--     'ops_shift_inputs',
--     'ops_rates',
--     'ops_sku_targets',
--     'user_login_events',
--     'forecast_versions',
--     'forecast_assumptions',
--     'sync_runs'
--   )
-- order by tablename;
