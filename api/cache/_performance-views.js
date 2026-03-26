function errorMessage(error) {
  return String((error && (error.message || error.details || error.hint)) || "").toLowerCase();
}

export function isMissingOpsPerformanceRefreshError(error) {
  var msg = errorMessage(error);
  var mentionsRefresh = (
    msg.indexOf("refresh_ops_performance_views") !== -1 ||
    msg.indexOf("ops_work_order_production_totals_mv") !== -1 ||
    msg.indexOf("ops_daily_line_metrics_mv") !== -1
  );
  return mentionsRefresh && (
    msg.indexOf("schema cache") !== -1 ||
    msg.indexOf("could not find the function") !== -1 ||
    msg.indexOf("could not find the table") !== -1 ||
    msg.indexOf("relation") !== -1 ||
    msg.indexOf("does not exist") !== -1
  );
}

export async function refreshOpsPerformanceViews(supabase) {
  var response = await supabase.rpc("refresh_ops_performance_views");
  if (!response.error) {
    return {
      status: "refreshed",
      details: response.data || null
    };
  }
  if (isMissingOpsPerformanceRefreshError(response.error)) {
    return {
      status: "missing_refresh_function",
      details: String(response.error.message || response.error.details || "refresh function is not installed")
    };
  }
  throw response.error;
}
