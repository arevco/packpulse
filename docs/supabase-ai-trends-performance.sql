-- PackPulse AI + trends performance follow-up
-- Run after the base event, ops, and performance view migrations.
-- Safe to rerun.

create index if not exists production_events_site_wo_cover_idx
  on public.production_events (site_id, work_order_code)
  include (item_code, units_produced, produced_date_et);

create index if not exists ops_sku_targets_site_updated_idx
  on public.ops_sku_targets (site_id, updated_at desc)
  include (item_code, customer, revenue_per_case, target_cases_per_hour, active_from, active_to);

create or replace function public.refresh_ops_performance_views()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  refresh materialized view public.ops_work_order_production_totals_mv;
  refresh materialized view public.ops_daily_line_metrics_mv;

  analyze public.production_events;
  analyze public.labor_events;
  analyze public.ops_work_order_production_totals_mv;
  analyze public.ops_daily_line_metrics_mv;

  return jsonb_build_object(
    'ok', true,
    'refreshed_at', now()
  );
end;
$$;

comment on function public.refresh_ops_performance_views() is
  'Refreshes PackPulse operations performance materialized views after sync writes and updates planner statistics.';
