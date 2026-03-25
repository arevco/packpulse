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
8. `/Users/aj/Documents/New project/docs/supabase-forecast-versions.sql`
   - Forecast version snapshots

## Required Environment Variables
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `CACHE_SITE_ID`

## Verification Queries
- Snapshot exists:
  - `select site_id, synced_at from cache_snapshot order by synced_at desc limit 5;`
- Production events loaded:
  - `select count(*) from production_events;`
- Labor events loaded:
  - `select count(*) from labor_events;`
- Ops inputs loaded:
  - `select count(*) from ops_shift_inputs;`
- Login events loaded:
  - `select count(*) from user_login_events;`
- RLS status:
  - `select schemaname, tablename, rowsecurity from pg_tables where schemaname = 'public' and tablename in ('cache_snapshots','cache_snapshot_history','production_events','labor_events','ops_shift_inputs','ops_rates','ops_sku_targets','user_login_events','forecast_versions','forecast_assumptions','sync_runs') order by tablename;`

## Common Issues
- “Could not find table … in schema cache”
  - Run migration SQL in correct project/schema.
- Env vars set at team scope but not attached to project.
  - Confirm vars are assigned to `packpulse` project.
- API routes still seeing old vars.
  - Redeploy after env var updates.
- Browser clients should not query these tables directly.
  - PackPulse server routes use the Supabase service role, so RLS can stay enabled with no public policies.
