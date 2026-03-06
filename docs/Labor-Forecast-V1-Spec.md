# Labor Forecast V1 Spec (March 26 Baseline)

## Scope
- Rebuild the deterministic labor + P&L forecast logic from the `Mar 26` Labor Footprint workbook into PackPulse.
- Use Nulogy work orders as the system of record for demand.
- Start with forecast outputs (no actuals variance in V1).

## Confirmed Decisions
- Baseline model: `Mar 26` sheet logic.
- Demand source: Nulogy work orders.
- Throughput source: derive `cases/min` from work orders.
- Revenue source: external pricing list (to be provided/ingested).
- Labor rates: use rates from workbook role blocks.
- Overhead/COGS/Equipment: global assumptions (editable).
- Primary grain: monthly forecast.
- Secondary grain: daily targets/forecast (when schedule dates are available).
- Mixed products: editable assumptions required.
- Mandatory outputs:
  - labor cost/case
  - labor % sales
  - gross margin
  - net operating income
  - headcount hours

## Deterministic Calculation Model
Per SKU/line forecast row:
- `production_hours = planned_cases / (cases_per_min * 60)`
- `hourly_role_cost = role_headcount * role_hourly_rate`
- `line_hourly_labor_cost = sum(hourly_role_cost for all roles)`
- `line_run_labor_cost = line_hourly_labor_cost * production_hours`
- `revenue = planned_cases * revenue_per_case`
- `gross_profit = revenue - line_run_labor_cost`
- `gross_margin_pct = gross_profit / revenue`

Monthly blended totals:
- `total_cases = sum(planned_cases)`
- `total_revenue = sum(revenue)`
- `total_labor_cost = sum(line_run_labor_cost)`
- `avg_labor_cost_per_case = total_labor_cost / total_cases`
- `avg_revenue_per_case = total_revenue / total_cases`
- `avg_margin_per_case = avg_revenue_per_case - avg_labor_cost_per_case`
- `total_prod_hours = sum(production_hours)`

Monthly P&L layer:
- `gross_profit_after_prod_labor = total_revenue - total_labor_cost`
- `gross_profit_after_cogs = gross_profit_after_prod_labor - cogs_non_labor - equipment_rental`
- `net_operating_income = gross_profit_after_cogs - overhead_global`

## Data Contracts (V1)
### Work Order Input (Nulogy normalized)
- `Work Order Code`
- `Item Code` (SKU)
- `Units Expected` (or equivalent planned cases)
- `Due Date`
- `Work Order Status`
- `Standard Units Per Hour` (used to derive cases/min where available)
- `Planned Start`, `Planned End` (for daily target splits when present)

### Forecast Config Tables
1. `forecast_pricing`
- `sku`
- `revenue_per_case`
- `effective_start`
- `effective_end` (nullable)

2. `forecast_labor_template`
- `template_id`
- `product_family` or `sku` (resolution rule TBD)
- `line_name`
- `role` (general_labor, operator, qa, maintenance, forklift, recycling, temp_* as needed)
- `headcount_assumed`
- `hourly_rate`
- `effective_start`
- `effective_end` (nullable)

3. `forecast_global_assumptions`
- `month_key` (`YYYY-MM`)
- `overhead_global`
- `cogs_non_labor`
- `equipment_rental`

4. `forecast_overrides`
- `month_key`
- `sku`
- `line_name`
- `override_cases_per_min` (nullable)
- `override_headcount_by_role` (nullable JSON)
- `override_hourly_rate_by_role` (nullable JSON)
- `notes`

## PackPulse Implementation Plan
1. Add deterministic forecast engine module (`src/lib/laborForecast.js`).
2. Build a normalization adapter from Nulogy work orders to forecast rows.
3. Add config loading for pricing, labor templates, and monthly assumptions.
4. Add monthly rollup outputs and daily targets.
5. Add UI surface (new Forecast view or section under Operations) with:
   - Month selector
   - Global assumptions editor
   - Mixed-product override controls
   - Mandatory output cards + detail table export

## Open Items (Blocking)
- Pricing file path/format for `revenue_per_case` seed load.
- Mapping rule from Nulogy SKU/work order to `Mar 26` labor template lanes.
- Rule for converting `Units Expected` to `cases` when UOM differs.
- Handling for missing/invalid `Standard Units Per Hour` on work orders.
