# Gusto Time Off in PackPulse

This repo now includes a first-pass Gusto PTO integration aimed at scheduled absences and call-off visibility.

## What it does

- Syncs Gusto App Integrations time-off requests into Supabase
- Caches upcoming and recent requests in `public.gusto_time_off_requests`
- Exposes cached data through `GET /api/gusto/time-off`
- Lets authenticated users trigger a manual refresh through `POST /api/gusto/sync-time-off`
- Surfaces upcoming PTO in the Calendar view alongside the existing Google Calendar embed

## Why this shape

Gusto's App Integrations docs dated `2026-06-15` expose a read endpoint for company time-off requests:

- `GET /v1/companies/{company_id}/time_off_requests`

That endpoint returns past and present requests, including:

- request `uuid`
- `status`
- `employee`
- `approver`
- `initiator`
- `policy_uuid`
- `policy_type`
- `days` as a date-to-hours map
- employee and employer notes

That makes it a good source for PackPulse visibility, even before a deeper HR workflow exists.

## Setup

1. Run [docs/supabase-gusto-time-off.sql](/Users/aj/Documents/New project/docs/supabase-gusto-time-off.sql).
2. Set these server env vars in Vercel or local server runtime:
   - `GUSTO_ACCESS_TOKEN`
   - `GUSTO_COMPANY_UUID` or `GUSTO_COMPANY_UUIDS`
   - `GUSTO_API_BASE_URL`
   - `GUSTO_API_VERSION`
3. Recommended optional env vars:
   - `GUSTO_TIME_OFF_LOOKBACK_DAYS`
   - `GUSTO_TIME_OFF_LOOKAHEAD_DAYS`

## Environment notes

- During development, Gusto docs say to use `api.gusto-demo.com`.
- After QA approval, production calls move to `api.gusto.com`.
- The helper defaults to `https://api.gusto.com`.
- The helper defaults the API version header to `2026-06-15`.

## Required scopes

Minimum useful scope:

- `time_off_requests:read`

Nice-to-have for future balance views:

- `time_off_policies:read`
- `employee_time_off_activities:read`

## Current behavior

- Sync window defaults to `today - 14 days` through `today + 90 days`
- Rows are upserted by `(site_id, request_uuid)`
- Rows inside the current sync window that are no longer returned by Gusto are deleted as stale
- The integration logs runs to `sync_runs` when that table exists

## Current limitations

- This is cache-first, not webhook-driven
- It assumes requests are recorded in Gusto; off-book call-offs will not appear
- The Calendar view is a visibility panel, not a full scheduler
- PackPulse currently reads cached time off; it does not create or approve requests

## Files

- [api/gusto/_common.js](/Users/aj/Documents/New project/api/gusto/_common.js)
- [api/gusto/time-off.js](/Users/aj/Documents/New project/api/gusto/time-off.js)
- [api/gusto/sync-time-off.js](/Users/aj/Documents/New project/api/gusto/sync-time-off.js)
- [docs/supabase-gusto-time-off.sql](/Users/aj/Documents/New project/docs/supabase-gusto-time-off.sql)
- [src/views/CalendarView.jsx](/Users/aj/Documents/New project/src/views/CalendarView.jsx)
