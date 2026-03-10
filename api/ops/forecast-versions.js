import Sentry from "../_sentry.js";
import { CACHE_SITE_ID, getAuthenticatedUser, getSupabaseAdmin, withCors } from "./_common.js";

function sanitizeMonthKey(v) {
  var s = String(v || "").trim();
  return /^\d{4}-\d{2}$/.test(s) ? s : "";
}

function isMissingTableError(err) {
  var msg = String((err && (err.message || err.details || err.hint)) || "").toLowerCase();
  return msg.indexOf("forecast_versions") !== -1 && (msg.indexOf("schema cache") !== -1 || msg.indexOf("could not find the table") !== -1 || msg.indexOf("relation") !== -1);
}

function sanitizeText(v, maxLen) {
  var s = String(v || "").trim();
  if (!s) return "";
  if (maxLen && s.length > maxLen) return s.slice(0, maxLen);
  return s;
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
        .from("forecast_versions")
        .select("id,site_id,month_key,version_no,label,notes,is_active,summary,created_by,created_at,published_at")
        .eq("site_id", CACHE_SITE_ID)
        .eq("month_key", monthKey)
        .order("version_no", { ascending: false });
      if (q.error) {
        if (isMissingTableError(q.error)) {
          return res.status(200).json({
            versions: [],
            status: "missing_forecast_versions_table",
            message: "Forecast versions table is not set up yet."
          });
        }
        throw q.error;
      }
      return res.status(200).json({ versions: Array.isArray(q.data) ? q.data : [] });
    }

    var body = req.body || {};
    var action = sanitizeText(body.action || "publish", 24).toLowerCase();
    if (action !== "publish") return res.status(400).json({ error: "Unsupported action. Use action=publish" });
    var monthKeyPost = sanitizeMonthKey(body.monthKey);
    if (!monthKeyPost) return res.status(400).json({ error: "Missing or invalid monthKey (YYYY-MM)" });

    var versionsQ = await supabase
      .from("forecast_versions")
      .select("id,version_no")
      .eq("site_id", CACHE_SITE_ID)
      .eq("month_key", monthKeyPost)
      .order("version_no", { ascending: false });
    if (versionsQ.error) {
      if (isMissingTableError(versionsQ.error)) {
        return res.status(200).json({
          ok: false,
          status: "missing_forecast_versions_table",
          message: "Forecast versions table is not set up yet."
        });
      }
      throw versionsQ.error;
    }
    var existing = Array.isArray(versionsQ.data) ? versionsQ.data : [];
    var nextVersionNo = existing.length ? (Number(existing[0].version_no) + 1) : 1;

    var label = sanitizeText(body.label || ("v" + nextVersionNo), 120) || ("v" + nextVersionNo);
    var notes = sanitizeText(body.notes, 1000) || null;
    var snapshot = body.snapshot && typeof body.snapshot === "object" ? body.snapshot : {};
    var summary = body.summary && typeof body.summary === "object" ? body.summary : {};

    var deactivate = await supabase
      .from("forecast_versions")
      .update({ is_active: false })
      .eq("site_id", CACHE_SITE_ID)
      .eq("month_key", monthKeyPost)
      .eq("is_active", true);
    if (deactivate.error && !isMissingTableError(deactivate.error)) throw deactivate.error;

    var insertRow = {
      site_id: CACHE_SITE_ID,
      month_key: monthKeyPost,
      version_no: nextVersionNo,
      label: label,
      notes: notes,
      is_active: true,
      summary: summary,
      snapshot: snapshot,
      created_by: user.email,
      published_at: new Date().toISOString()
    };
    var ins = await supabase
      .from("forecast_versions")
      .insert(insertRow)
      .select("id,site_id,month_key,version_no,label,notes,is_active,summary,created_by,created_at,published_at")
      .single();
    if (ins.error) {
      if (isMissingTableError(ins.error)) {
        return res.status(200).json({
          ok: false,
          status: "missing_forecast_versions_table",
          message: "Forecast versions table is not set up yet."
        });
      }
      throw ins.error;
    }
    return res.status(200).json({ ok: true, row: ins.data });
  } catch (err) {
    Sentry.captureException(err);
    return res.status(500).json({ error: "Forecast versions request failed", details: err && err.message ? err.message : "unknown" });
  }
}

