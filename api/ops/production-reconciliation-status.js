import Sentry from "../_sentry.js";
import { isMissingTableError } from "../_event-window.js";
import { CACHE_SITE_ID, getAuthenticatedUser, getSupabaseAdmin, withCors } from "./_common.js";

export default async function handler(req, res) {
  withCors(req, res, ["GET", "OPTIONS"]);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });
  var user = getAuthenticatedUser(req);
  if (!user) return res.status(401).json({ error: "Unauthorized" });

  try {
    var supabase = getSupabaseAdmin();
    var query = await supabase
      .from("sync_runs")
      .select("source,status,row_counts,details,started_at,finished_at")
      .eq("site_id", CACHE_SITE_ID)
      .in("source", ["nulogy_production", "nulogy_production_scheduled_reconciliation"])
      .order("finished_at", { ascending: false })
      .limit(1);
    if (query.error) {
      if (isMissingTableError("sync_runs", query.error)) {
        return res.status(200).json({ ok: true, healthStatus: "unknown", latest: null });
      }
      throw query.error;
    }
    var latest = Array.isArray(query.data) && query.data.length ? query.data[0] : null;
    return res.status(200).json({
      ok: true,
      healthStatus: !latest ? "unknown" : latest.status === "ok" ? "reconciled" : "mismatch",
      latest: latest
    });
  } catch (error) {
    Sentry.captureException(error);
    return res.status(500).json({ error: "Could not load production reconciliation status" });
  }
}
