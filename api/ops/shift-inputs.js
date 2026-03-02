import Sentry from "../_sentry.js";
import { CACHE_SITE_ID, getAuthenticatedUser, getSupabaseAdmin, toDateEt, toNum, withCors } from "./_common.js";

export default async function handler(req, res) {
  withCors(req, res, ["GET", "POST", "OPTIONS"]);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET" && req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const user = getAuthenticatedUser(req);
    if (!user) return res.status(401).json({ error: "Unauthorized" });
    const supabase = getSupabaseAdmin();

    if (req.method === "GET") {
      const days = Math.max(1, Math.min(120, Number(req.query.days || 30)));
      const fromDate = toDateEt(days);
      const q = await supabase
        .from("ops_shift_inputs")
        .select("date_et,shift_label,line_name,labor_count,fork_count,qa_count,maint_count,recycling_count,hours_run_override,notes,updated_by,updated_at")
        .eq("site_id", CACHE_SITE_ID)
        .gte("date_et", fromDate)
        .order("date_et", { ascending: false })
        .order("shift_label", { ascending: true })
        .order("line_name", { ascending: true });
      if (q.error) throw q.error;
      return res.status(200).json({ rows: Array.isArray(q.data) ? q.data : [] });
    }

    const b = req.body || {};
    const row = {
      site_id: CACHE_SITE_ID,
      date_et: String(b.date_et || "").slice(0, 10),
      shift_label: String(b.shift_label || "").trim(),
      line_name: String(b.line_name || "").trim(),
      labor_count: toNum(b.labor_count),
      fork_count: toNum(b.fork_count),
      qa_count: toNum(b.qa_count),
      maint_count: toNum(b.maint_count),
      recycling_count: toNum(b.recycling_count),
      hours_run_override: b.hours_run_override == null || b.hours_run_override === "" ? null : toNum(b.hours_run_override),
      notes: b.notes ? String(b.notes) : null,
      updated_by: user.email
    };
    if (!row.date_et || !row.shift_label || !row.line_name) {
      return res.status(400).json({ error: "Missing required fields: date_et, shift_label, line_name" });
    }

    const up = await supabase
      .from("ops_shift_inputs")
      .upsert(row, { onConflict: "site_id,date_et,shift_label,line_name" })
      .select("date_et,shift_label,line_name,labor_count,fork_count,qa_count,maint_count,recycling_count,hours_run_override,notes,updated_by,updated_at")
      .single();
    if (up.error) throw up.error;

    return res.status(200).json({ ok: true, row: up.data });
  } catch (err) {
    Sentry.captureException(err);
    return res.status(500).json({ error: "Ops shift inputs request failed", details: err && err.message ? err.message : "unknown" });
  }
}

