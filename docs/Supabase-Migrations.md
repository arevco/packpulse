# Supabase Migrations

## Purpose
Track SQL setup order and what each script provisions.

## Recommended Execution Order
1. `/Users/aj/Documents/New project/docs/supabase-cache-snapshot.sql`
   - Shared cache snapshot + history tables
2. `/Users/aj/Documents/New project/supabase-production-events.sql`
   - Normalized production event table for trend reporting
3. `/Users/aj/Documents/New project/docs/supabase-labor-events.sql`
   - Canonical labor actuals table for shift/line/job reporting
4. `/Users/aj/Documents/New project/supabase-operations-schema.sql`
   - Operations config + labor inputs + related tables
5. `/Users/aj/Documents/New project/supabase-user-login-events.sql`
   - User login analytics table
6. `/Users/aj/Documents/New project/supabase-sync-runs.sql`
   - Sync pipeline audit trail
7. `/Users/aj/Documents/New project/docs/supabase-forecast-assumptions.sql`
   - Forecast assumptions table
8. `/Users/aj/Documents/New project/docs/supabase-team-board.sql`
   - Lightweight shared team board table
9. `/Users/aj/Documents/New project/docs/supabase-forecast-versions.sql`
   - Forecast version snapshots
10. `/Users/aj/Documents/New project/docs/supabase-ops-performance.sql`
   - Covering production index + operations performance materialized views + refresh function
11. `/Users/aj/Documents/New project/docs/supabase-query-performance.sql`
   - Query diagnostics extensions + latest artifact lookup index
12. `/Users/aj/Documents/New project/docs/supabase-ai-trends-performance.sql`
   - AI/trends follow-up indexes + refresh function `ANALYZE` pass

## Required Environment Variables
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `CACHE_SITE_ID`

## Verification Queries
- Snapshot exists:
  - `select site_id, synced_at from cache_snapshots order by synced_at desc limit 5;`
- Production events loaded:
  - `select count(*) from production_events;`
- Labor events loaded:
  - `select count(*) from labor_events;`
- Ops inputs loaded:
  - `select count(*) from ops_shift_inputs;`
- Login events loaded:
  - `select count(*) from user_login_events;`
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
  - `select schemaname, tablename, rowsecurity from pg_tables where schemaname = 'public' and tablename in ('cache_snapshots','cache_snapshot_history','production_events','labor_events','ops_shift_inputs','ops_rates','ops_sku_targets','user_login_events','team_board_tasks','forecast_versions','forecast_assumptions','sync_runs') order by tablename;`

## Common Issues
- “Could not find table … in schema cache”
  - Run migration SQL in correct project/schema.
- Materialized views stay stale after sync writes.
  - Run `select public.refresh_ops_performance_views();` once, or let PackPulse refresh them automatically after future event syncs.
- Env vars set at team scope but not attached to project.
  - Confirm vars are assigned to `packpulse` project.
- API routes still seeing old vars.
  - Redeploy after env var updates.
- Browser clients should not query these tables directly.
  - PackPulse server routes use the Supabase service role, so RLS can stay enabled with no public policies.
