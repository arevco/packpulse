import Sentry from "../../_sentry.js";
import { CACHE_SITE_ID, getAuthenticatedUser, getSupabaseAdmin, withCors } from "../../ops/_common.js";
import { stageUpload, text } from "../_service.js";

export default async function handler(req, res) {
  withCors(req, res, ["POST", "OPTIONS"]);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  try {
    var user = getAuthenticatedUser(req);
    if (!user) return res.status(401).json({ error: "Unauthorized" });
    var supabase = getSupabaseAdmin();
    var id = text(req.query && req.query.id, 80);
    var po = await supabase.from("purchase_orders").select("id").eq("site_id", CACHE_SITE_ID).eq("id", id).single();
    if (po.error) return res.status(404).json({ error: "Purchase order not found" });
    var staged = await stageUpload(req.body || {}, user);
    if (!staged.duplicate && staged.revision) {
      var linked = await supabase.from("purchase_order_revisions").update({ purchase_order_id: id })
        .eq("site_id", CACHE_SITE_ID).eq("id", staged.revision.id).select("*").single();
      if (linked.error) throw linked.error;
      staged.revision = linked.data;
    }
    return res.status(staged.error ? 422 : 200).json(staged);
  } catch (error) {
    Sentry.captureException(error);
    return res.status(500).json({ error: error.message || "Revision upload failed" });
  }
}
