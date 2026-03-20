import Sentry from "../_sentry.js";
import { CACHE_SITE_ID, getAuthenticatedUser, getSupabaseAdmin, toNum, withCors } from "./_common.js";
import { fetchProductionTotalsForWorkOrders } from "./_production.js";
import { runLaborForecast } from "../../src/lib/laborForecast.js";

function sanitizeMonthKey(v) {
  var s = String(v || "").trim();
  return /^\d{4}-\d{2}$/.test(s) ? s : "";
}

function parseMonthKeys(raw) {
  var src = Array.isArray(raw) ? raw.join(",") : String(raw || "");
  var seen = {};
  return src.split(",").map(function(part) {
    return sanitizeMonthKey(part);
  }).filter(function(monthKey) {
    if (!monthKey || seen[monthKey]) return false;
    seen[monthKey] = true;
    return true;
  }).slice(0, 24);
}

function isMissingTableError(tableName, err) {
  var msg = String((err && (err.message || err.details || err.hint)) || "").toLowerCase();
  return msg.indexOf(String(tableName || "").toLowerCase()) !== -1 && (
    msg.indexOf("schema cache") !== -1 ||
    msg.indexOf("could not find the table") !== -1 ||
    msg.indexOf("relation") !== -1
  );
}

async function getSnapshotPayload(supabase) {
  var q = await supabase
    .from("cache_snapshots")
    .select("payload,synced_at")
    .eq("site_id", CACHE_SITE_ID)
    .maybeSingle();
  if (q.error) throw q.error;
  return q.data || null;
}

async function getPricingRows(supabase) {
  var q = await supabase
    .from("ops_sku_targets")
    .select("item_code,revenue_per_case,active_from,active_to")
    .eq("site_id", CACHE_SITE_ID)
    .limit(10000);
  if (q.error) throw q.error;
  return (q.data || []).map(function(r) {
    return {
      sku: r.item_code,
      revenue_per_case: toNum(r.revenue_per_case),
      effective_start: r.active_from || null,
      effective_end: r.active_to || null
    };
  });
}

export default async function handler(req, res) {
  withCors(req, res, ["GET", "OPTIONS"]);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  try {
    var user = getAuthenticatedUser(req);
    if (!user) return res.status(401).json({ error: "Unauthorized" });
    var monthKeys = parseMonthKeys((req.query && (req.query.monthKeys || req.query.monthKey)) || "");
    if (!monthKeys.length) return res.status(400).json({ error: "Missing monthKeys (YYYY-MM[,YYYY-MM])" });

    var supabase = getSupabaseAdmin();
    var plans = {};
    var unresolved = monthKeys.slice();

    var versionsQ = await supabase
      .from("forecast_versions")
      .select("month_key,version_no,published_at,summary,snapshot")
      .eq("site_id", CACHE_SITE_ID)
      .eq("is_active", true)
      .in("month_key", monthKeys);
    if (versionsQ.error && !isMissingTableError("forecast_versions", versionsQ.error)) throw versionsQ.error;
    (Array.isArray(versionsQ.data) ? versionsQ.data : []).forEach(function(row) {
      var summary = row && row.summary && typeof row.summary === "object" ? row.summary : {};
      var snapshot = row && row.snapshot && typeof row.snapshot === "object" ? row.snapshot : {};
      var snapshotSummary = snapshot && snapshot.forecast && snapshot.forecast.summary && typeof snapshot.forecast.summary === "object"
        ? snapshot.forecast.summary
        : {};
      var totalCases = toNum(summary.total_cases);
      if (!(totalCases > 0)) totalCases = toNum(snapshotSummary.total_cases);
      plans[row.month_key] = {
        month_key: row.month_key,
        total_cases: totalCases,
        source: "published_version",
        version_no: row.version_no || null,
        published_at: row.published_at || null
      };
    });
    unresolved = unresolved.filter(function(monthKey) { return !plans[monthKey]; });

    if (unresolved.length) {
      var assumptionsQ = await supabase
        .from("forecast_assumptions")
        .select("month_key,global_assumptions,labor_templates,overrides")
        .eq("site_id", CACHE_SITE_ID)
        .in("month_key", unresolved);
      if (assumptionsQ.error && !isMissingTableError("forecast_assumptions", assumptionsQ.error)) throw assumptionsQ.error;
      var assumptionsByMonth = {};
      (Array.isArray(assumptionsQ.data) ? assumptionsQ.data : []).forEach(function(row) {
        assumptionsByMonth[row.month_key] = row;
      });

      var assumptionsMonths = unresolved.filter(function(monthKey) { return !!assumptionsByMonth[monthKey]; });
      if (assumptionsMonths.length) {
        var snapshot = await getSnapshotPayload(supabase);
        var payload = snapshot && snapshot.payload ? snapshot.payload : {};
        var workOrders = Array.isArray(payload.workOrders) ? payload.workOrders : [];
        var itemMaster = Array.isArray(payload.itemMaster) ? payload.itemMaster : [];
        var productionActuals = await fetchProductionTotalsForWorkOrders(supabase, workOrders);
        var pricing = await getPricingRows(supabase);
        assumptionsMonths.forEach(function(monthKey) {
          var row = assumptionsByMonth[monthKey] || {};
          var forecast = runLaborForecast({
            monthKey: monthKey,
            workOrders: workOrders,
            itemMaster: itemMaster,
            pricing: pricing,
            productionActualsByWorkOrder: productionActuals.byWorkOrder,
            productionActualsBySku: productionActuals.bySku,
            laborTemplates: Array.isArray(row.labor_templates) ? row.labor_templates : [],
            globalAssumptions: row.global_assumptions && typeof row.global_assumptions === "object" ? row.global_assumptions : {},
            overrides: Array.isArray(row.overrides) ? row.overrides : []
          });
          plans[monthKey] = {
            month_key: monthKey,
            total_cases: toNum(forecast && forecast.summary && forecast.summary.total_cases),
            source: "saved_assumptions",
            version_no: null,
            published_at: null
          };
        });
      }
    }

    return res.status(200).json({
      plans: plans,
      requested: monthKeys
    });
  } catch (err) {
    Sentry.captureException(err);
    return res.status(500).json({
      error: "Forecast plan request failed",
      details: err && err.message ? err.message : "unknown"
    });
  }
}
