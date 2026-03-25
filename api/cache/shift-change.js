import { createClient } from "@supabase/supabase-js";
import Sentry from "../_sentry.js";
import { getAuthenticatedUser } from "../_session.js";

const CACHE_SITE_ID = process.env.CACHE_SITE_ID || "default";
const SHIFT_HOURS = Math.max(1, Number(process.env.SHIFT_HOURS || 8));

function getSupabaseAdmin() {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
  if (!url || !key) throw new Error("Missing SUPABASE_URL/VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  return createClient(url, key, { auth: { persistSession: false } });
}

function toNum(v) {
  const n = Number(v || 0);
  return Number.isFinite(n) ? n : 0;
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", req.headers.origin || "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Access-Control-Allow-Credentials", "true");
  if (req.method === "OPTIONS") return res.status(200).end();

  try {
    const user = getAuthenticatedUser(req);
    if (!user) return res.status(401).json({ error: "Unauthorized" });

    const supabase = getSupabaseAdmin();
    const q = await supabase
      .from("cache_snapshot_history")
      .select("captured_at,updated_by,derived_metrics")
      .eq("site_id", CACHE_SITE_ID)
      .order("captured_at", { ascending: false })
      .limit(20);
    if (q.error) {
      var qMsg = String(q.error.message || "").toLowerCase();
      if (qMsg.includes("cache_snapshot_history") && qMsg.includes("schema cache")) {
        // Non-blocking while history table is being provisioned.
        return res.status(200).json({ change: null, historyStatus: "missing_history_table" });
      }
      throw q.error;
    }
    const rows = Array.isArray(q.data) ? q.data : [];
    if (!rows.length) return res.status(200).json({ change: null });

    const current = rows[0];
    const currentTs = new Date(current.captured_at).getTime();
    const shiftAgo = currentTs - (SHIFT_HOURS * 3600000);
    const previousShift = rows.find(function(r) { return new Date(r.captured_at).getTime() <= shiftAgo; }) || null;
    const fallbackPrevious = rows[1] || null;
    let previous = previousShift || fallbackPrevious;
    if (!previous) return res.status(200).json({ change: null });
    const baselineType = previousShift ? "previous_shift" : "last_sync";
    const baselineLabel = previousShift ? ("Previous shift (" + SHIFT_HOURS + "h+)") : "Last sync (fallback)";

    const c = current.derived_metrics || {};
    const p = previous.derived_metrics || {};
    const metrics = [
      ["woActive", "Active WOs"],
      ["woRemainingUnits", "Remaining Units"],
      ["woLate", "Late WOs"],
      ["inventoryRows", "Inventory Rows"],
      ["dockRows", "OpenDock Rows"],
      ["edrRows", "EDR Rows"],
    ].map(function(pair) {
      const key = pair[0];
      const label = pair[1];
      const curr = toNum(c[key]);
      const prev = toNum(p[key]);
      return { key: key, label: label, current: curr, previous: prev, delta: curr - prev };
    });

    return res.status(200).json({
      change: {
        currentAt: current.captured_at,
        previousAt: previous.captured_at,
        currentBy: current.updated_by || "",
        previousBy: previous.updated_by || "",
        baselineType: baselineType,
        baselineLabel: baselineLabel,
        shiftHours: SHIFT_HOURS,
        metrics: metrics,
      }
    });
  } catch (err) {
    Sentry.captureException(err);
    return res.status(500).json({ error: "Shift change request failed", details: err && err.message ? err.message : "unknown" });
  }
}
