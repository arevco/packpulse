import Sentry from "../_sentry.js";
import { CACHE_SITE_ID, getAuthenticatedUser, getSupabaseAdmin, withCors } from "./_common.js";

function sanitizeMonthKey(v) {
  var s = String(v || "").trim();
  return /^\d{4}-\d{2}$/.test(s) ? s : "";
}

export default async function handler(req, res) {
  withCors(req, res, ["GET", "POST", "OPTIONS"]);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET" && req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    var user = getAuthenticatedUser(req);
    if (!user) return res.status(401).json({ error: "Unauthorized" });
    var supabase = getSupabaseAdmin();

    if (req.method === "GET") {
      var monthKey = sanitizeMonthKey(req.query && req.query.monthKey);
      if (!monthKey) return res.status(400).json({ error: "Missing or invalid monthKey (YYYY-MM)" });
      var q = await supabase
        .from("forecast_assumptions")
        .select("site_id,month_key,global_assumptions,labor_templates,overrides,updated_by,updated_at")
        .eq("site_id", CACHE_SITE_ID)
        .eq("month_key", monthKey)
        .maybeSingle();
      if (q.error) throw q.error;
      return res.status(200).json({ row: q.data || null });
    }

    var body = req.body || {};
    var monthKeyPost = sanitizeMonthKey(body.monthKey);
    if (!monthKeyPost) return res.status(400).json({ error: "Missing or invalid monthKey (YYYY-MM)" });
    var row = {
      site_id: CACHE_SITE_ID,
      month_key: monthKeyPost,
      global_assumptions: body.globalAssumptions && typeof body.globalAssumptions === "object" ? body.globalAssumptions : {},
      labor_templates: Array.isArray(body.laborTemplates) ? body.laborTemplates : [],
      overrides: Array.isArray(body.overrides) ? body.overrides : [],
      updated_by: user.email
    };
    var up = await supabase
      .from("forecast_assumptions")
      .upsert(row, { onConflict: "site_id,month_key" })
      .select("site_id,month_key,global_assumptions,labor_templates,overrides,updated_by,updated_at")
      .single();
    if (up.error) throw up.error;
    return res.status(200).json({ ok: true, row: up.data });
  } catch (err) {
    Sentry.captureException(err);
    return res.status(500).json({ error: "Forecast assumptions request failed", details: err && err.message ? err.message : "unknown" });
  }
}

