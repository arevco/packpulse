import Sentry from "../_sentry.js";
import { CACHE_SITE_ID, getAuthenticatedUser, getSupabaseAdmin, withCors } from "./_common.js";

export default async function handler(req, res) {
  withCors(req, res, ["GET", "OPTIONS"]);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  try {
    const user = getAuthenticatedUser(req);
    if (!user) return res.status(401).json({ error: "Unauthorized" });

    const supabase = getSupabaseAdmin();
    const limit = Math.max(5, Math.min(100, Number(req.query.limit || 25)));

    const q = await supabase
      .from("user_login_events")
      .select("id,user_email,user_name,event_type,auth_provider,source,ip_address,user_agent,created_at")
      .eq("site_id", CACHE_SITE_ID)
      .order("created_at", { ascending: false })
      .limit(limit);

    if (q.error) {
      const msg = String(q.error.message || "").toLowerCase();
      if (msg.includes("user_login_events") && msg.includes("schema cache")) {
        return res.status(200).json({ rows: [], status: "missing_user_login_events_table" });
      }
      throw q.error;
    }

    return res.status(200).json({ rows: Array.isArray(q.data) ? q.data : [] });
  } catch (err) {
    Sentry.captureException(err);
    return res.status(500).json({ error: "Could not load user login events", details: err && err.message ? err.message : "unknown" });
  }
}
