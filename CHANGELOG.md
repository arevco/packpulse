## Unreleased

### Added

- Centralized server-side Supabase client creation and env validation in `api/lib/supabase.js`.
- Added `/api/health` endpoint to validate runtime env connectivity (Supabase + session secret) for deployment checks.

### Changed

- Migrated repeated Supabase bootstrap logic in key server routes to shared helper:
  - `api/ops/_common.js`
  - `api/auth/verify.js`
  - `api/cache/labor-events.js`
  - `api/cache/production-events.js`
  - `api/cache/production-trends.js`
  - `api/cache/shift-change.js`
  - `api/cache/snapshot.js`
- Added shared helper and env summary utility in `api/lib/supabase.js`.
- Added `/api/health` endpoint in `api/health.js`.
- Documented health check flow in `README.md`.
