# Nulogy Labor Integration Plan

## Goal
Pull actual labor usage from Nulogy and use it in two places:

1. `Operations`: actual labor productivity and cost
2. `Forecast`: calibration and variance against labor assumptions

## Current State
- PackPulse has no first-class Nulogy labor dataset.
- Operations uses `production_events` for actual yield.
- Forecast uses manual labor templates and global role rates.
- Manual shift labor entry exists in `ops_shift_inputs`, but that is not system-of-record labor.

## Recommended Data Model
Do not wire raw labor CSV rows directly into the UI.

Add two layers:

1. `Raw labor rows`
   - preserve exact Nulogy payload for audit/debug
   - one row per source export row

2. `Canonical labor events`
   - normalized keys for joins and calculations
   - preferred grain:
     - `date_et`
     - `shift_label`
     - `line`
     - `job_id`
     - `work_order_code`
     - `item_code`
     - role counts or hours
     - actual labor hours
     - actual labor cost

## Minimum Fields We Need From Nulogy
Best-case schema:

- job id
- work order code
- item code
- line
- shift or timestamps
- labor role or labor bucket
- labor hours or minutes
- headcount/count by role
- date worked

Useful but optional:

- employee/user
- comments
- pay rate
- crew name

If the report has no `job_id` and no `work_order_code`, it can still power Operations, but Forecast variance will be much weaker.

## Operations Layering
Use labor as `actuals`, not assumptions.

### Add to Shift Command / Production Jobs
- actual labor hours by shift
- cases per labor hour by shift
- labor cost by shift
- shift 1 vs shift 2 labor productivity delta

### Add to Production Lines
- cases per labor hour by line
- labor cost per case by line
- actual crew mix by line
- coverage indicator: what percent of visible production has matching labor rows

### Add to Alerts
- labor-heavy lines: high labor cost / case
- under-crewed or over-crewed shifts vs trailing baseline
- low-output / high-labor windows

## Forecast Layering
Use labor actuals to improve forecast defaults and variance reporting.

### What labor actuals should do
- seed headcount defaults by line + SKU or line + pack type
- estimate realistic hours per job from trailing actuals
- show actual vs forecast labor cost variance by work order
- show actual vs forecast cases per labor hour

### What labor actuals should not do
- silently overwrite forecast assumptions
- replace editable scenario planning

Forecast should remain user-editable. Actual labor should calibrate defaults and show variance, not take control of the scenario.

## Recommended Join Strategy
Join priority:

1. `job_id`
2. `work_order_code + date_et + line`
3. `item_code + date_et + shift_label + line`

If the labor report only supports shift-level totals, use it for:
- Operations shift actuals
- line/day labor cost

Do not use shift-level-only labor to back-calculate job-level forecast actuals.

## Proposed Implementation Phases

### Phase 1: Discovery
- probe Nulogy labor report
- capture exact report name and headers
- store sample rows

### Phase 2: Canonical ingest
- add `labor_events` table in Supabase
- normalize timestamps to ET
- map rows to shift / line / job / work order

### Phase 3: Operations actuals
- shift labor cards
- cases per labor hour
- labor cost / case
- coverage diagnostics

### Phase 4: Forecast actuals vs plan
- month actual labor cost
- actual vs forecast by work order
- trailing actual defaults for templates

## Probe Endpoint
Use:

- `/api/nulogy/labor-full`

Returns JSON by default:
- detected report name
- columns used
- row count
- headers
- sample rows
- failed attempts

Use:

- `/api/nulogy/labor-full?format=csv`

to download the CSV if a labor report variant succeeds.
