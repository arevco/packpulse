import Sentry from "../_sentry.js";
import { CACHE_SITE_ID, getAuthenticatedUser, getSupabaseAdmin, toNum, withCors } from "./_common.js";
import { fetchProductionTotalsForWorkOrders } from "./_production.js";
import { runLaborForecast } from "../../src/lib/laborForecast.js";

function buildTemplatesFromRates(rates, headcountByRole) {
  return (Array.isArray(rates) ? rates : []).map(function(r) {
    var role = String(r.role || "").trim().toLowerCase();
    var hourlyRate = toNum(r.hourly_rate);
    var markup = toNum(r.markup_pct);
    var hc = toNum(headcountByRole && headcountByRole[role]);
    return {
      sku: "",
      line_name: "",
      role: role,
      headcount_assumed: hc > 0 ? hc : 1,
      hourly_rate: hourlyRate * (1 + Math.max(0, markup))
    };
  }).filter(function(r) { return r.role && r.hourly_rate > 0; });
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
    .select("item_code,revenue_per_case,active_from,active_to,updated_at")
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

async function getRates(supabase) {
  var q = await supabase
    .from("ops_rates")
    .select("role,hourly_rate,markup_pct,effective_from,effective_to")
    .eq("site_id", CACHE_SITE_ID)
    .limit(1000);
  if (q.error) throw q.error;
  return q.data || [];
}

export default async function handler(req, res) {
  withCors(req, res, ["GET", "POST", "OPTIONS"]);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET" && req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    var user = getAuthenticatedUser(req);
    if (!user) return res.status(401).json({ error: "Unauthorized" });
    var supabase = getSupabaseAdmin();
    var body = req.method === "POST" ? (req.body || {}) : {};
    var monthKey = String((req.query && req.query.monthKey) || body.monthKey || new Date().toISOString().slice(0, 7)).trim();

    var snapshot = await getSnapshotPayload(supabase);
    var payload = snapshot && snapshot.payload ? snapshot.payload : {};
    var workOrders = Array.isArray(body.workOrders) ? body.workOrders : (Array.isArray(payload.workOrders) ? payload.workOrders : []);
    var itemMaster = Array.isArray(body.itemMaster) ? body.itemMaster : (Array.isArray(payload.itemMaster) ? payload.itemMaster : []);
    var productionActuals = await fetchProductionTotalsForWorkOrders(supabase, workOrders);

    var pricing = Array.isArray(body.pricing) ? body.pricing : await getPricingRows(supabase);
    var laborTemplates = Array.isArray(body.laborTemplates) ? body.laborTemplates : [];
    if (!laborTemplates.length) {
      var rates = await getRates(supabase);
      laborTemplates = buildTemplatesFromRates(rates, body.headcountByRole || {});
    }

    var globalAssumptions = body.globalAssumptions || {};
    var overrides = Array.isArray(body.overrides) ? body.overrides : [];

    var forecast = runLaborForecast({
      monthKey: monthKey,
      workOrders: workOrders,
      itemMaster: itemMaster,
      pricing: pricing,
      productionActualsByWorkOrder: productionActuals.byWorkOrder,
      productionActualsBySku: productionActuals.bySku,
      laborTemplates: laborTemplates,
      globalAssumptions: globalAssumptions,
      overrides: overrides
    });

    return res.status(200).json({
      monthKey: monthKey,
      generatedAt: new Date().toISOString(),
      source: {
        snapshotSyncedAt: snapshot && snapshot.synced_at ? snapshot.synced_at : null,
        workOrders: workOrders.length,
        attributedWorkOrders: Object.keys(productionActuals.byWorkOrder || {}).length,
        productionActualsSource: productionActuals.querySource || "production_events",
        itemMaster: itemMaster.length,
        pricing: pricing.length,
        laborTemplates: laborTemplates.length
      },
      forecast: forecast
    });
  } catch (err) {
    Sentry.captureException(err);
    return res.status(500).json({
      error: "Labor forecast request failed",
      details: err && err.message ? err.message : "unknown"
    });
  }
}
