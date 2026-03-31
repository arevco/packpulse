# Labor Hours Matching Explainer

## What PackPulse is doing
PackPulse does **not** take a plant-level labor total and spread it across all jobs. It tries to assign labor to production jobs only when the match is strong enough to be trusted.

That is why PackPulse job-level labor can be **lower than internal reporting**. Internal reports often include broader line, shift, or crew totals. PackPulse is stricter by design so it does not overstate job-level labor.

## Nulogy reports used
PackPulse uses these two Nulogy reports:

1. `production`
2. `labor`

### Key fields from `production`
```json
{
  "job_id": "9154716",
  "work_order_code": "450057137-40",
  "item_code": "114634",
  "line": "RSC",
  "customer_name": "Monster Energy",
  "produced_at": "2026-Mar-11 12:22 PM",
  "units_produced": "78.00000"
}
```

### Key fields from `labor`
```json
{
  "job_id": "9154716",
  "work_order_code": "450057137-40",
  "item_code": "114634",
  "line_name": "RSC",
  "customer_name": "Monster Energy",
  "clock_in_at": "2026-Mar-11 07:00 AM",
  "clock_out_at": "2026-Mar-11 12:30 PM",
  "payable_hours": "5.52",
  "productive_hours": "5.52",
  "badge_type_name": "General Labor Temp",
  "badge_type_rate": "20.10"
}
```

## How the logic works
1. **Normalize both reports into canonical event tables**
   - `production` becomes `production_events`
   - `labor` becomes `labor_events`

2. **Convert labor timestamps into ET reporting buckets**
   - Shift 1 scheduled window = `7:00 AM` to `3:00 PM ET`
   - Shift 2 scheduled window = `3:00 PM` to `11:00 PM ET`
   - Punch-ins are assigned with a `10-minute` grace window around shift start.
   - If a row only spills into the next shift by a small amount, PackPulse keeps the whole row on the primary shift.
   - PackPulse only splits a labor row when cross-shift overlap is greater than `30 minutes`.
   - If labor does not have a complete clock window, PackPulse falls back to the stored date/shift bucket with lower confidence.

3. **Try to match labor to production jobs in priority order**
   - Exact: `job_id + date + shift + line + work_order + item_code`
   - Slim: `job_id + date + shift`
   - Fallback: prorate broader labor buckets by units produced
     - `job_id + date + line + item_code`
     - `job_id + date + line`
     - `job_id + date + item_code`
     - `job_id + date`

4. **Suppress weak job labor**
   - If matched payable labor is less than `0.25` hours, PackPulse treats it as no labor for job detail.
   - For past jobs, PackPulse also hides server-side direct matches if the shift match is not trusted enough.

## Real matched example
From the live March 26, 2026 Nulogy artifact run, job `9154716` exists in both reports:

- `production` rows found: `17`
- `labor` rows found: `11`

For that job:

```json
{
  "job_id": "9154716",
  "date_et": "2026-03-11",
  "shift": "Shift 1 (7a-3p)",
  "line": "RSC",
  "work_order_code": "450057137-40",
  "item_code": "114634",
  "total_units_produced": 1870,
  "matched_payable_hours": 60.52,
  "matched_labor_cost": 1257.43,
  "cases_per_payable_hour": 30.9
}
```

Why it matches well:
- same `job_id`
- same `work_order_code`
- same `item_code`
- same line
- labor punch-in and clock window resolve cleanly to the same ET shift bucket as the production rows

## Real mismatch example
In the exported file [production_jobs_labor_2026-03-23_to_2026-03-27.csv](/Users/aj/Downloads/production_jobs_labor_2026-03-23_to_2026-03-27.csv), all `47` rows were exported with:

- `has_labor = no`
- `allocation_method = unmatched`
- `match_level = unmatched`

Example row:

```json
{
  "date": "2026-03-26",
  "shift": "Shift 1 (7a-3p)",
  "line": "DMM",
  "job_id": "9197561",
  "work_order": "450057137-30",
  "item_code": "120092",
  "units_produced": 8370,
  "labor_payable_hours": 0,
  "labor_cost": 0,
  "labor_source": "none",
  "allocation_method": "unmatched"
}
```

What that means:
- PackPulse did **not** find a trusted labor bucket for that job/date/shift
- or a broader fallback bucket was not available
- or the remaining matched labor was below the `0.25` hour threshold
- or the past-job match existed but was not trusted enough to show in job detail

## Why PackPulse may not match internal reporting
- Internal reporting may include indirect labor, line support, QA, forklift, or other shared hours at a broader level.
- PackPulse job detail only keeps labor when it can tie hours to a job/date/shift with enough confidence.
- Missing `job_id`, missing `work_order_code`, or incomplete clock timestamps reduce match quality.
- Shift-level labor is useful for Operations summary reporting, but it is not always safe to force into job-level detail.

## What to check when hours do not match
- Does the Nulogy labor row have `job_id`?
- Does it also have `work_order_code`, `item_code`, and `line_name`?
- Are `clock_in_at` and `clock_out_at` populated?
- Does the labor row land in the same ET date and shift as production?
- Is the variance caused by indirect/shared labor that internal reporting includes but job-level matching should not force?

## Bottom line
PackPulse is intentionally conservative. It is better at showing **trusted job-level labor** than reproducing a broader plant labor total. If the team wants job-level hours to match internal reporting more closely, the fastest path is usually better Nulogy labor keys and cleaner timestamps, not looser allocation rules.
