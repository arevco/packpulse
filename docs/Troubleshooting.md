# Troubleshooting

## Ask AI says fallback: `OPENAI_API_KEY is not configured`
- Cause: server route cannot see API key.
- Fix:
  1. Add `OPENAI_API_KEY` in Vercel project env vars.
  2. Redeploy.
  3. Confirm not using client-side `VITE_` key for server route.

## `/api/ai/chat` returns `Method not allowed`
- Cause: endpoint is POST-only.
- Fix: test from Ask AI panel or send POST request.

## OpenAI usage dashboard shows 0
- Possible causes:
  - deterministic intent path handled request (no model call)
  - viewing wrong OpenAI project
  - usage delay in dashboard
- Fix:
  - test model-intent prompt
  - verify active OpenAI project

## Supabase table missing in API errors
- Error example: table not found in schema cache.
- Fix:
  1. Run required SQL migration.
  2. Ensure correct Supabase project.
  3. Redeploy if env/schema changed.

## Reporting says `Could not build reporting packet`
- Likely causes:
  - `docs/supabase-nulogy-artifacts.sql` was never applied in the active Supabase project
  - PostgREST has not reloaded the new `nulogy_artifact_*` tables/views yet
- Fix:
  1. Run `docs/supabase-nulogy-artifacts.sql` in the active Supabase project.
  2. Trigger a schema reload or redeploy.
  3. Verify `/api/nulogy/artifact-runs` and `/api/nulogy/artifact-reports` return `200`.

## Reporting loads but sections are empty
- Cause:
  - artifact schema exists, but no Nulogy artifact runs have been uploaded for the selected `site_id` / date window
- Fix:
  1. Verify `select count(*) from nulogy_artifact_runs;`
  2. Upload at least one run with `scripts/nulogy/upload-artifacts-to-supabase.mjs`
  3. Recheck the packet using an `As of date` that overlaps the uploaded run

## Vercel deploy healthy but behavior unchanged
- Cause: stale deployment or wrong environment vars.
- Fix:
  1. Redeploy latest commit.
  2. Use “Redeploy without cache” once.
  3. Verify project-level env assignment.

## Production/Operations today shows 0 unexpectedly
- Checks:
  1. Confirm `production_events` has latest ET date rows.
  2. Confirm selected date window includes today ET.
  3. Validate source report pull succeeded.

## Ask AI answers generic “data unavailable”
- Cause: needed metrics missing from context payload.
- Fix:
  1. Sync data.
  2. Confirm snapshot/prod tables have rows.
  3. Add deterministic handler for repeated high-value prompt pattern.
