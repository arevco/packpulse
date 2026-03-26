-- PackPulse operations performance accelerators
-- Run after the base event and ops schema migrations.
-- Safe to rerun.

-- Replace the basic production date index with a covering version
-- so the common date-window reads can stay index-friendly.
drop index if exists public.production_events_site_date_idx;

create index if not exists production_events_site_date_idx
  on public.production_events (site_id, produced_date_et desc)
  include (shift_label, line, job_id, work_order_code, item_code, units_produced, produced_at_utc, source_snapshot_at);

-- Work-order production totals for forecast and attribution queries.
drop materialized view if exists public.ops_work_order_production_totals_mv;

create materialized view public.ops_work_order_production_totals_mv as
select
  site_id,
  work_order_code,
  coalesce(nullif(btrim(item_code), ''), '') as item_code,
  count(*)::bigint as row_count,
  sum(units_produced)::numeric as total_units_produced,
  min(produced_date_et) as first_produced_date_et,
  max(produced_date_et) as last_produced_date_et,
  max(produced_at_utc) as last_produced_at_utc
from public.production_events
where coalesce(nullif(btrim(work_order_code), ''), '') <> ''
group by
  site_id,
  work_order_code,
  coalesce(nullif(btrim(item_code), ''), '');

create unique index if not exists ux_ops_work_order_production_totals_mv
  on public.ops_work_order_production_totals_mv (site_id, work_order_code, item_code);

create index if not exists idx_ops_work_order_production_totals_mv_lookup
  on public.ops_work_order_production_totals_mv (site_id, work_order_code, last_produced_date_et desc);

-- Daily line metrics for faster operations trend and economics reads.
drop materialized view if exists public.ops_daily_line_metrics_mv;

create materialized view public.ops_daily_line_metrics_mv as
with production as (
  select
    site_id,
    produced_date_et as date_et,
    coalesce(nullif(btrim(shift_label), ''), 'Unassigned') as shift_label,
    coalesce(nullif(btrim(line), ''), 'Unknown') as line_name,
    count(*)::bigint as production_rows,
    count(distinct nullif(btrim(job_id), ''))::bigint as production_jobs,
    count(distinct nullif(btrim(work_order_code), ''))::bigint as production_work_orders,
    sum(units_produced)::numeric as produced_units
  from public.production_events
  where produced_date_et is not null
  group by
    site_id,
    produced_date_et,
    coalesce(nullif(btrim(shift_label), ''), 'Unassigned'),
    coalesce(nullif(btrim(line), ''), 'Unknown')
),
labor as (
  select
    site_id,
    worked_date_et as date_et,
    coalesce(nullif(btrim(shift_label), ''), 'Unassigned') as shift_label,
    coalesce(nullif(btrim(line_name), ''), 'Unknown') as line_name,
    count(*)::bigint as labor_rows,
    sum(payable_hours)::numeric(14,4) as payable_hours,
    sum(productive_hours)::numeric(14,4) as productive_hours,
    sum(payable_hours * hourly_rate)::numeric(14,4) as labor_cost
  from public.labor_events
  where worked_date_et is not null
  group by
    site_id,
    worked_date_et,
    coalesce(nullif(btrim(shift_label), ''), 'Unassigned'),
    coalesce(nullif(btrim(line_name), ''), 'Unknown')
)
select
  coalesce(production.site_id, labor.site_id) as site_id,
  coalesce(production.date_et, labor.date_et) as date_et,
  coalesce(production.shift_label, labor.shift_label) as shift_label,
  coalesce(production.line_name, labor.line_name) as line_name,
  coalesce(production.production_rows, 0)::bigint as production_rows,
  coalesce(production.production_jobs, 0)::bigint as production_jobs,
  coalesce(production.production_work_orders, 0)::bigint as production_work_orders,
  coalesce(production.produced_units, 0)::numeric as produced_units,
  coalesce(labor.labor_rows, 0)::bigint as labor_rows,
  coalesce(labor.payable_hours, 0)::numeric(14,4) as payable_hours,
  coalesce(labor.productive_hours, 0)::numeric(14,4) as productive_hours,
  coalesce(labor.labor_cost, 0)::numeric(14,4) as labor_cost
from production
full outer join labor
  on production.site_id = labor.site_id
 and production.date_et = labor.date_et
 and production.shift_label = labor.shift_label
 and production.line_name = labor.line_name;

create unique index if not exists ux_ops_daily_line_metrics_mv
  on public.ops_daily_line_metrics_mv (site_id, date_et, shift_label, line_name);

create index if not exists idx_ops_daily_line_metrics_mv_site_date
  on public.ops_daily_line_metrics_mv (site_id, date_et desc, shift_label, line_name);

-- Best-effort refresh hook for PackPulse sync routes.
create or replace function public.refresh_ops_performance_views()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  refresh materialized view public.ops_work_order_production_totals_mv;
  refresh materialized view public.ops_daily_line_metrics_mv;

  return jsonb_build_object(
    'ok', true,
    'refreshed_at', now()
  );
end;
$$;

comment on materialized view public.ops_work_order_production_totals_mv is
  'Pre-aggregated production totals by site/work order/item for forecast and attribution queries.';

comment on materialized view public.ops_daily_line_metrics_mv is
  'Pre-aggregated production and labor metrics by site/date/shift/line for operations dashboards.';

comment on function public.refresh_ops_performance_views() is
  'Refreshes PackPulse operations performance materialized views after production/labor sync writes.';
