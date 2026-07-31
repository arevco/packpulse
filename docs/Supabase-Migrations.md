# Supabase Migrations

## Purpose
Track SQL setup order and what each script provisions.

## Recommended Execution Order
1. `/Users/aj/Documents/New project/docs/supabase-cache-snapshot.sql`
   - Shared cache snapshot + history tables
2. `/Users/aj/Documents/New project/docs/supabase-warehouse-invoicing-snapshots.sql`
   - Optional dedicated warehouse invoicing snapshots keyed by billing window + mode
   - PackPulse falls back to `cache_snapshot_history` until this table is applied
3. `/Users/aj/Documents/New project/supabase-production-events.sql`
   - Normalized production event table for trend reporting
4. `/Users/aj/Documents/New project/docs/supabase-labor-events.sql`
   - Canonical labor actuals table for shift/line/job reporting
5. `/Users/aj/Documents/New project/supabase-operations-schema.sql`
   - Operations config + labor inputs + related tables
6. `/Users/aj/Documents/New project/supabase-user-login-events.sql`
   - User login analytics table
7. `/Users/aj/Documents/New project/supabase-sync-runs.sql`
   - Sync pipeline audit trail
8. `/Users/aj/Documents/New project/docs/supabase-nulogy-artifacts.sql`
   - Nulogy artifact runs, reports, files, latest-report views, and private artifact storage used by Reporting
9. `/Users/aj/Documents/New project/docs/supabase-forecast-assumptions.sql`
   - Forecast assumptions table
10. `/Users/aj/Documents/New project/docs/supabase-team-board.sql`
   - Lightweight shared team board table
11. `/Users/aj/Documents/New project/docs/supabase-forecast-versions.sql`
   - Forecast version snapshots
12. `/Users/aj/Documents/New project/docs/supabase-ops-performance.sql`
   - Covering production index + operations performance materialized views + refresh function
13. `/Users/aj/Documents/New project/docs/supabase-query-performance.sql`
   - Query diagnostics extensions + latest artifact lookup index
14. `/Users/aj/Documents/New project/docs/supabase-ai-trends-performance.sql`
   - AI/trends follow-up indexes + refresh function `ANALYZE` pass
## Required Environment Variables
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `CACHE_SITE_ID`

## Verification Queries
- Snapshot exists:
  - `select site_id, synced_at from cache_snapshots order by synced_at desc limit 5;`
- Warehouse invoicing snapshots exist:
  - `select site_id, snapshot_mode, start_date, end_date, pending, generated_at from warehouse_invoicing_snapshots order by updated_at desc limit 10;`
- Warehouse invoicing fallback history exists:
  - `select site_id, captured_at, derived_metrics->>'snapshotMode' as snapshot_mode, derived_metrics->>'startDate' as start_date, derived_metrics->>'endDate' as end_date from cache_snapshot_history where derived_metrics->>'cacheFeature' = 'warehouse_invoicing' order by captured_at desc limit 10;`
- Production events loaded:
  - `select count(*) from production_events;`
- Labor events loaded:
  - `select count(*) from labor_events;`
- Ops inputs loaded:
  - `select count(*) from ops_shift_inputs;`
- Login events loaded:
  - `select count(*) from user_login_events;`
- Nulogy artifact store loaded:
  - `select count(*) from nulogy_artifact_runs;`
  - `select count(*) from nulogy_artifact_reports;`
  - `select count(*) from nulogy_artifact_files;`
  - `select report_code, generated_at from nulogy_artifact_latest_reports order by generated_at desc nulls last limit 10;`
- Team board loaded:
  - `select count(*) from team_board_tasks;`
- Performance materialized views loaded:
  - `select count(*) from ops_work_order_production_totals_mv;`
  - `select count(*) from ops_daily_line_metrics_mv;`
- Performance refresh function:
  - `select public.refresh_ops_performance_views();`
- Query diagnostics extensions enabled:
  - `select extname from pg_extension where extname in ('pg_stat_statements','hypopg','index_advisor') order by extname;`
- RLS status:
  - `select schemaname, tablename, rowsecurity from pg_tables where schemaname = 'public' and tablename in ('cache_snapshots','cache_snapshot_history','warehouse_invoicing_snapshots','production_events','labor_events','ops_shift_inputs','ops_rates','ops_sku_targets','user_login_events','team_board_tasks','forecast_versions','forecast_assumptions','sync_runs') order by tablename;`

## Common Issues
- “Could not find table … in schema cache”
  - Run migration SQL in correct project/schema. Warehouse invoicing will fall back to `cache_snapshot_history` until `warehouse_invoicing_snapshots` exists.
- Reporting packet builds but all sections are empty.
  - Confirm `docs/supabase-nulogy-artifacts.sql` was applied and that at least one artifact run was uploaded for the target `site_id`.
- Reporting/artifact routes still fail after the migration ran.
  - Trigger a PostgREST schema reload or redeploy so `nulogy_artifact_*` tables and latest-report views are queryable through Supabase REST.
- Materialized views stay stale after sync writes.
  - Run `select public.refresh_ops_performance_views();` once, or let PackPulse refresh them automatically after future event syncs.
- Env vars set at team scope but not attached to project.
  - Confirm vars are assigned to `packpulse` project.
- API routes still seeing old vars.
  - Redeploy after env var updates.
- Browser clients should not query these tables directly.
  - PackPulse server routes use the Supabase service role, so RLS can stay enabled with no public policies.
