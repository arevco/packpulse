import Sentry from "../_sentry.js";
import { getAuthenticatedUser, getSupabaseAdmin, withCors } from "./_common.js";
import { extractRequestedWorkOrders, fetchProductionTotalsForWorkOrders } from "./_production.js";

export default async function handler(req, res) {
  withCors(req, res, ["POST", "OPTIONS"]);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    var user = getAuthenticatedUser(req);
    if (!user) return res.status(401).json({ error: "Unauthorized" });
    var supabase = getSupabaseAdmin();
    var workOrders = req.body && Array.isArray(req.body.workOrders) ? req.body.workOrders : [];
    var requested = extractRequestedWorkOrders(workOrders);
    var totals = await fetchProductionTotalsForWorkOrders(supabase, requested);
    return res.status(200).json({
      status: "ok",
      requestedRows: totals.requestedRows,
      matchedRows: totals.matchedRows,
      byWorkOrder: totals.byWorkOrder,
      bySku: totals.bySku,
      querySource: totals.querySource || "production_events"
    });
  } catch (err) {
    Sentry.captureException(err);
    return res.status(500).json({
      error: "Work order production request failed",
      details: err && err.message ? err.message : "unknown"
    });
  }
}
