# Supabase Query Performance

Use this after the base schema migrations are installed.

## Enable Diagnostics
Run:

`/Users/aj/Documents/New project/docs/supabase-query-performance.sql`

This enables:
- `pg_stat_statements`
- `HypoPG`
- `index_advisor`

It also adds:
- the `production_events(site_id, source_snapshot_at desc)` index suggested by Query Performance for the latest-snapshot read path
- the latest-artifact lookup index used by [artifact-file.js](/Users/aj/Documents/New project/api/nulogy/artifact-file.js)

## What To Inspect First
Use Supabase Dashboard:
1. Database
2. Query Performance
3. Sort by total time and mean time
4. Open the slowest PackPulse queries and review the Index Advisor tab

Priority PackPulse paths:
- production summary/detail reads behind [production-breakdown.js](/Users/aj/Documents/New project/api/ops/production-breakdown.js)
- labor matching reads behind [labor-actuals.js](/Users/aj/Documents/New project/api/ops/labor-actuals.js)
- latest production snapshot reads behind [production-trends.js](/Users/aj/Documents/New project/api/cache/production-trends.js)
- artifact latest-file reads behind [artifact-file.js](/Users/aj/Documents/New project/api/nulogy/artifact-file.js)

## How To Use The Results
- Add indexes only when they match repeated query shapes.
- Prefer materialized summaries for dashboard cards and trend charts.
- Keep raw row scans for drill-down and export paths only.
- Validate proposed indexes with `HypoPG` or Supabase Index Advisor before adding them permanently.
